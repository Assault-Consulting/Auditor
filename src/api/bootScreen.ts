// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * What the boot screen says, as pure functions of the application's state.
 *
 * Every one of these was inside App.tsx and therefore untested — not because
 * anyone decided they did not need tests, but because a 738-line component
 * file is where testable code goes to stop being tested.
 *
 * Two of them have been wrong in production wording, twice each, and their
 * own comments say so: the wired-status panel claimed a component was
 * pending after it shipped, and the footnote claimed nothing on screen was a
 * result after real panels appeared. Both are exactly what a test catches
 * and a type does not — the value was always a valid string.
 */

import type { Choice, Probe } from "../state";
import { type ChainState, openedOf } from "./chainState";
import type { Chronoscope } from "./chronoscope";
import { type Panel, triptych } from "./verdict";

export interface Question {
  index: string;
  text: string;
  basisLabel: string;
}

/**
 * The three questions with no chain open — the questions themselves, not
 * answers to them.
 *
 * Shown before anything is verified so the screen states what the tool asks
 * rather than sitting blank. Once a chain has been checked these are
 * replaced by real panels; until then nothing here is a result, and the
 * basis line on each says which kind of claim an answer would be.
 */
export const QUESTIONS: Question[] = [
  {
    index: "01",
    text: "Is what I hold internally consistent?",
    basisLabel: "Proved — hash chain, no key required",
  },
  {
    index: "02",
    text: "Is what I hold all of it?",
    basisLabel: "Not checked without an anchor",
  },
  {
    index: "03",
    text: "Did this history exist at time T?",
    basisLabel: "Recorded — the writer's clock, until a witness says otherwise",
  },
];

export interface Row {
  name: string;
  state: string;
  live: boolean;
}

export function rowsFor(probe: Probe, chain: ChainState, rail: Chronoscope | null): Row[] {
  // This panel exists to be honest about what is wired, so it has to be
  // corrected when something becomes wired. It has gone stale twice now —
  // once claiming the typed API client was pending, once claiming provenance
  // was. A status display that is read as current and is not is worse than
  // none at all.
  //
  // Two habits keep it honest, and both are now pinned by tests. Every row
  // derives from state rather than from a constant; and where a row can
  // report a quantity — sources configured, advisory items, days on the rail
  // — it does, because a number cannot go stale the way a word can.
  const pending: Row[] = [
    {
      name: "open a chain",
      state: openedOf(chain) !== null ? "open" : "wired",
      live: openedOf(chain) !== null,
    },
    {
      name: "verdict triptych",
      state: chain.kind === "verified" ? "answered" : "wired",
      live: chain.kind === "verified",
    },
    {
      name: "anchor provenance",
      state: chain.kind === "verified" ? `${chain.sources.length} configured` : "wired",
      live: chain.kind === "verified",
    },
    {
      name: "diagnosis card",
      state:
        chain.kind === "verified" && chain.result.diagnosis !== null
          ? chain.result.diagnosis.pattern
          : "wired",
      live: chain.kind === "verified" && chain.result.diagnosis !== null,
    },
    {
      name: "advisory lane",
      state:
        chain.kind === "verified" ? `${chain.result.advisory.count} items` : "wired",
      live: chain.kind === "verified",
    },
    {
      name: "chronoscope",
      state: rail === null ? "wired" : `${rail.days.length} days`,
      live: rail !== null,
    },
    { name: "record inspector", state: "C-06", live: false },
  ];

  switch (probe.kind) {
    case "starting":
      return [{ name: "sidecar", state: "starting", live: false }, ...pending];
    case "no-shell":
      return [
        { name: "desktop shell", state: "not attached", live: false },
        ...pending,
      ];
    case "failed":
      return [
        { name: "sidecar", state: "did not start", live: false },
        ...pending,
      ];
    case "ready":
      return [
        { name: "sidecar", state: `v${probe.health.version}`, live: true },
        { name: "verifier", state: probe.health.package, live: true },
        { name: "format", state: probe.health.spec, live: true },
        {
          name: "session token",
          state: probe.health.authenticated ? "enforced" : "DISABLED",
          live: probe.health.authenticated,
        },
        ...pending,
      ];
  }
}

export function footnoteFor(probe: Probe, chain: ChainState): string {
  switch (probe.kind) {
    case "no-shell":
      return "Running in a browser without the desktop shell, so there is no session token and no sidecar. Use `pnpm tauri dev` to run the whole application.";
    case "failed":
      return `The sidecar did not answer: ${probe.detail}. Check that Python is on PATH and that the sidecar package is installed.`;
    default:
      // This line has now been wrong twice by going stale — it claimed no
      // chain could be opened after opening worked, and it would claim
      // nothing on screen is a result now that the panels carry one. So it
      // follows the state rather than describing a fixed moment.
      //
      // What it must never stop doing is refusing the overclaim. Once a
      // verdict is on screen the risk is not that someone misses it; it is
      // that they read it as certification.
      return chain.kind === "verified"
        ? "The panels above attest that this check was run against this file, with this anchor profile, at this time. They certify nothing."
        : "Opening a chain reports what it is. Nothing on this screen is a verification result.";
  }
}

/** Panels for the current state: real answers when there are any, the
 *  standing questions when there are not. */
export function panelsFor(chain: ChainState): { panels: Panel[]; live: boolean } {
  if (chain.kind === "verified") {
    return { panels: triptych(chain.result, chain.opened.subject), live: true };
  }
  return {
    panels: QUESTIONS.map((q) => ({
      index: q.index as Panel["index"],
      question: q.text,
      // Not "not-checked": nothing was asked at all, and borrowing the
      // standing that means "asked and unanswerable" would put a real
      // verification state on a screen that has not run one.
      standing: "unavailable" as const,
      answer: "",
      basis: q.basisLabel,
    })),
    live: false,
  };
}

export function choiceLine(choice: Choice): string | null {
  switch (choice.kind) {
    case "idle":
      return null;
    case "cancelled":
      return "Dialog cancelled — nothing was opened.";
    case "no-shell":
      return "Choosing a file needs the desktop shell. Run `pnpm tauri dev`.";
    case "extra-dropped":
      return `${choice.total} files were dropped; only the first was opened. Several files as one chain is not supported yet.`;
  }
}
