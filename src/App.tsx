// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The boot screen.
 *
 * States the product's three questions, and reports what the sidecar says
 * about itself — including which verifier it is linked against, because a
 * verification result is only meaningful next to the verifier that produced
 * it.
 *
 * Every reachable state says what it is. "Starting" is not shown as a spinner
 * over nothing, a refused token is not shown as a network error, and running
 * in a plain browser without the shell is not shown as a failure — it is a
 * normal way to work on the frontend and says so.
 */

import { useEffect, useState } from "react";
import { onChainFilesDropped, pickChainFile } from "./api/openFile";
import { type Health, NoShellError, getHealth, getSession } from "./api/session";

type Basis = "proved" | "recorded" | "unchecked";

interface Question {
  index: string;
  text: string;
  basis: Basis;
  basisLabel: string;
}

/**
 * The three verification questions, in the order they can be answered.
 * The order is information: you cannot ask whether you hold all of a chain
 * until you know that what you hold is internally consistent, and evidence
 * that a history existed at a given time means little without both.
 */
const QUESTIONS: Question[] = [
  {
    index: "01",
    text: "Is what I hold internally consistent?",
    basis: "proved",
    basisLabel: "Proved — hash chain, no key required",
  },
  {
    index: "02",
    text: "Is what I hold all of it?",
    basis: "unchecked",
    basisLabel: "Not checked without an anchor",
  },
  {
    index: "03",
    text: "Did this history exist at time T?",
    basis: "recorded",
    basisLabel: "Recorded — the writer's clock, until a witness says otherwise",
  },
];

interface Row {
  name: string;
  state: string;
  live: boolean;
}

/** What the shell reports, once it has answered — or why it has not. */
type Probe =
  | { kind: "starting" }
  | { kind: "ready"; health: Health }
  | { kind: "no-shell" }
  | { kind: "failed"; detail: string };

function useProbe(): Probe {
  const [probe, setProbe] = useState<Probe>({ kind: "starting" });

  useEffect(() => {
    let cancelled = false;

    // The shell spawns the sidecar before the window exists, but uvicorn takes
    // a moment to bind. Poll rather than fail on the first refused connection:
    // a boot screen that gives up after 40 ms would report a working install
    // as broken.
    const deadline = Date.now() + 15_000;

    async function attempt(): Promise<void> {
      try {
        const health = await getHealth(await getSession());
        if (!cancelled) setProbe({ kind: "ready", health });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NoShellError) {
          setProbe({ kind: "no-shell" });
          return;
        }
        if (Date.now() < deadline) {
          window.setTimeout(() => void attempt(), 300);
          return;
        }
        setProbe({
          kind: "failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    void attempt();
    return () => {
      cancelled = true;
    };
  }, []);

  return probe;
}

/**
 * The chain the user has chosen, if any.
 *
 * Only the path, deliberately. Opening it is B-06b; this block exists to
 * prove the two routes in — dialog and drop — reach the application at all,
 * and to make the shape of what crosses the boundary visible: a string.
 */
type Chosen =
  | { kind: "none" }
  | { kind: "picked"; paths: string[] }
  | { kind: "cancelled" }
  | { kind: "no-shell" };

function rowsFor(probe: Probe, chosen: Chosen): Row[] {
  // This panel exists to be honest about what is wired, so it has to be
  // corrected when something becomes wired. It still claimed the typed API
  // client was pending under A-07, which shipped several changes ago — a
  // status display that goes stale is worse than none, because it is read as
  // current.
  const pending: Row[] = [
    {
      name: "choose a chain",
      state: chosen.kind === "no-shell" ? "needs the shell" : "wired",
      live: chosen.kind !== "no-shell",
    },
    { name: "open and verify", state: "B-06b", live: false },
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

function footnoteFor(probe: Probe): string {
  switch (probe.kind) {
    case "no-shell":
      return "Running in a browser without the desktop shell, so there is no session token and no sidecar. Use `pnpm tauri dev` to run the whole application.";
    case "failed":
      return `The sidecar did not answer: ${probe.detail}. Check that Python is on PATH and that the sidecar package is installed.`;
    default:
      return "No chain can be opened yet. Nothing on this screen is a verification result.";
  }
}

function useChosenFile(): [Chosen, () => void] {
  const [chosen, setChosen] = useState<Chosen>({ kind: "none" });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void onChainFilesDropped((paths) => setChosen({ kind: "picked", paths }))
      .then((off) => {
        // The component may have unmounted while the listener was being
        // registered. Without this the unlisten function is lost and the
        // handler keeps firing into state that no longer exists.
        if (cancelled) off();
        else unlisten = off;
      })
      .catch(() => {
        /* no shell: drag and drop is simply unavailable, not broken */
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const pick = () => {
    void pickChainFile()
      .then((path) =>
        // null is a cancelled dialog. An ordinary outcome, and a separate
        // state from "nothing chosen yet" so the screen can acknowledge the
        // action without claiming something went wrong.
        setChosen(
          path === null ? { kind: "cancelled" } : { kind: "picked", paths: [path] },
        ),
      )
      .catch((err) =>
        setChosen(
          err instanceof NoShellError ? { kind: "no-shell" } : { kind: "cancelled" },
        ),
      );
  };

  return [chosen, pick];
}

function chosenLine(chosen: Chosen): string {
  switch (chosen.kind) {
    case "none":
      return "No chain chosen yet. Nothing on this screen is a verification result.";
    case "cancelled":
      return "Dialog cancelled — nothing was opened.";
    case "no-shell":
      return "Choosing a file needs the desktop shell. Run `pnpm tauri dev`.";
    case "picked":
      return chosen.paths.length === 1
        ? `Chosen: ${chosen.paths[0]}`
        : `Chosen ${chosen.paths.length} files: ${chosen.paths.join(", ")}`;
  }
}

export default function App() {
  const probe = useProbe();
  const [chosen, pick] = useChosenFile();
  const rows = rowsFor(probe, chosen);

  return (
    <main className="shell">
      <div className="plate">
        <p className="eyebrow">Reader for PALA-1 audit chains</p>

        <h1 className="wordmark">
          Palimpsests <em>Auditor</em>
        </h1>

        <p className="thesis">
          Opens an audit chain and answers three separate questions about it.
          It attests that a check was run against a named file, with a named
          anchor, at a stated time. It certifies nothing.
        </p>

        <ol className="questions">
          {QUESTIONS.map((q) => (
            <li className="question" key={q.index}>
              <span className="question-index" aria-hidden="true">
                {q.index}
              </span>
              <div>
                <p className="question-text">{q.text}</p>
                <p className={`question-basis basis-${q.basis}`}>
                  {q.basisLabel}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <section className="status" aria-labelledby="status-title">
          <h2 className="status-title" id="status-title">
            What is wired
          </h2>
          <ul className="status-list">
            {rows.map((r) => (
              <li className="status-row" key={r.name}>
                <span>{r.name}</span>
                <span className="status-state" data-live={r.live}>
                  {r.state}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="choose">
          <button className="choose-button" onClick={pick} type="button">
            Open a chain…
          </button>
          <span className="choose-hint">or drop a file on this window</span>
        </div>

        <p className="footnote">{chosenLine(chosen)}</p>
        <p className="footnote">{footnoteFor(probe)}</p>
      </div>
    </main>
  );
}
