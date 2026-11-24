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

import { t, tn } from "../i18n";
import { type CountNoun, count } from "./plural";
import type { Choice, Listing, Probe } from "../state";
import type { BootRow, SpanRow } from "./browse";
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
export function questions(): Question[] {
  return [
    { index: "01", text: t("verdict.q1.question"), basisLabel: t("boot.q1.basis") },
    { index: "02", text: t("verdict.q2.question"), basisLabel: t("boot.q2.basis") },
    { index: "03", text: t("verdict.q3.question"), basisLabel: t("boot.q3.basis") },
  ];
}

export interface Row {
  name: string;
  state: string;
  live: boolean;
}

/** What a Listing contributes to the status panel, in a word or a count. */
function listingState(listing: Listing<BootRow | SpanRow>, unit: CountNoun): string {
  switch (listing.kind) {
    case "unasked":
      return "wired";
    case "failed":
      // "wired" would be a lie and "0" would be worse — a count of zero
      // reads as an answer about the container rather than as a request
      // that never returned one.
      return t("boot.state.did_not_load");
    case "loaded":
      return count(listing.rows.length, unit);
  }
}

export function rowsFor(
  probe: Probe,
  chain: ChainState,
  rail: Chronoscope | null,
  browse: { boots: Listing<BootRow>; spans: Listing<SpanRow> },
): Row[] {
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
  //
  // Neither habit catches the third way this panel can lie: leaving a
  // component out entirely. The tests check named rows, and a row that was
  // never added has no name to check. That is not a gap to fix in the tests
  // — a list of names is itself a place to forget — so it is written down
  // here, where someone adding a feature is already reading.
  const pending: Row[] = [
    {
      name: t("boot.row.open"),
      state: openedOf(chain) !== null ? t("boot.state.open") : t("boot.state.wired"),
      live: openedOf(chain) !== null,
    },
    {
      name: t("boot.row.triptych"),
      state: chain.kind === "verified" ? t("boot.state.answered") : t("boot.state.wired"),
      live: chain.kind === "verified",
    },
    {
      name: t("boot.row.provenance"),
      state: chain.kind === "verified" ? count(chain.sources.length, "anchor_source") : t("boot.state.wired"),
      live: chain.kind === "verified",
    },
    {
      name: t("boot.row.diagnosis"),
      state:
        chain.kind === "verified" && chain.result.diagnosis !== null
          ? chain.result.diagnosis.pattern
          : t("boot.state.wired"),
      live: chain.kind === "verified" && chain.result.diagnosis !== null,
    },
    {
      name: t("boot.row.advisory"),
      state:
        chain.kind === "verified" ? count(chain.result.advisory.count, "item") : t("boot.state.wired"),
      live: chain.kind === "verified",
    },
    {
      name: t("boot.row.chronoscope"),
      state: rail === null ? t("boot.state.wired") : count(rail.days.length, "day"),
      live: rail !== null,
    },
    {
      name: t("boot.row.browse"),
      state: `${listingState(browse.boots, "boot")}, ${listingState(browse.spans, "span")}`,
      live: browse.boots.kind === "loaded" && browse.spans.kind === "loaded",
    },
    { name: t("boot.row.inspector"), state: "C-06", live: false },
  ];

  switch (probe.kind) {
    case "starting":
      return [{ name: t("boot.row.sidecar"), state: t("boot.state.starting"), live: false }, ...pending];
    case "no-shell":
      return [
        { name: t("boot.row.shell"), state: t("boot.state.not_attached"), live: false },
        ...pending,
      ];
    case "failed":
      return [
        { name: t("boot.row.sidecar"), state: t("boot.state.did_not_start"), live: false },
        ...pending,
      ];
    case "ready":
      return [
        { name: t("boot.row.sidecar"), state: `v${probe.health.version}`, live: true },
        { name: t("boot.row.verifier"), state: probe.health.package, live: true },
        { name: t("boot.row.format"), state: probe.health.spec, live: true },
        {
          name: t("boot.row.token"),
          state: probe.health.authenticated ? t("boot.state.enforced") : t("boot.state.disabled"),
          live: probe.health.authenticated,
        },
        ...pending,
      ];
  }
}

export function footnoteFor(probe: Probe, chain: ChainState): string {
  switch (probe.kind) {
    case "no-shell":
      return t("boot.footnote.no_shell");
    case "failed":
      return t("boot.footnote.failed", { detail: probe.detail });
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
        ? t("boot.footnote.verified")
        : t("boot.footnote.idle");
  }
}

/** Panels for the current state: real answers when there are any, the
 *  standing questions when there are not. */
export function panelsFor(chain: ChainState): { panels: Panel[]; live: boolean } {
  if (chain.kind === "verified") {
    return { panels: triptych(chain.result, chain.opened.subject), live: true };
  }
  return {
    panels: questions().map((q) => ({
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
      return t("boot.choice.cancelled");
    case "no-shell":
      return t("boot.choice.no_shell");
    case "extra-dropped":
      return tn("boot.choice.extra", choice.total);
  }
}
