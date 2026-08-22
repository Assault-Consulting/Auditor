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

import { useEffect, useRef, useState } from "react";
import { advisoryGroups, advisoryLine } from "./api/advisory";
import { listProfiles } from "./api/chain";
import { type ChainState, chainLine, openPath, openedOf, verifyOpen } from "./api/chainState";
import { diagnosisCard } from "./api/diagnosis";
import type { AnchorProfile } from "./api/generated/types";
import { onChainFilesDropped, pickChainFile } from "./api/openFile";
import { provenance, provenanceSummary } from "./api/provenance";
import { type Health, NoShellError, getHealth, getSession } from "./api/session";
import { type Panel, triptych } from "./api/verdict";

interface Question {
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
const QUESTIONS: Question[] = [
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

interface Row {
  name: string;
  state: string;
  live: boolean;
}

/** What the shell reports, once it has answered — or why it has not. */
type Probe =
  | { kind: "starting" }
  // The session travels with the probe rather than being fetched again when
  // a chain is opened. Asking the shell twice would be two chances to get a
  // different answer, and the token is per launch — there is only one right
  // one.
  | { kind: "ready"; health: Health; session: Awaited<ReturnType<typeof getSession>> }
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
        const session = await getSession();
        const health = await getHealth(session);
        if (!cancelled) setProbe({ kind: "ready", health, session });
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
 * What happened when the user last reached for a file.
 *
 * Separate from {@link ChainState}, which is about the chain itself. A
 * cancelled dialog is an event in the choosing, not a state of any chain,
 * and folding the two together would make "cancelled" compete with "open"
 * for the same slot.
 */
type Choice =
  | { kind: "idle" }
  | { kind: "cancelled" }
  | { kind: "no-shell" }
  /** More than one file was dropped, and only the first was opened. */
  | { kind: "extra-dropped"; total: number };

function rowsFor(probe: Probe, chain: ChainState): Row[] {
  // This panel exists to be honest about what is wired, so it has to be
  // corrected when something becomes wired. It has gone stale twice now —
  // once claiming the typed API client was pending, once claiming provenance
  // was. A status display that is read as current and is not is worse than
  // none at all.
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
    { name: "mutation fixtures", state: "B-11", live: false },
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

function footnoteFor(probe: Probe, chain: ChainState): string {
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
function panelsFor(chain: ChainState): { panels: Panel[]; live: boolean } {
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

/**
 * The anchor profiles this sidecar knows.
 *
 * Fetched once the shell is ready rather than on every verify: the list
 * changes only when someone edits it, and re-fetching per check would put a
 * network round trip in front of an action whose whole point is to be
 * repeatable.
 */
function useProfiles(probe: Probe): AnchorProfile[] {
  const [profiles, setProfiles] = useState<AnchorProfile[]>([]);

  useEffect(() => {
    if (probe.kind !== "ready") return;
    let cancelled = false;
    void listProfiles(probe.session)
      .then((list) => {
        if (!cancelled) setProfiles(list);
      })
      .catch(() => {
        // A sidecar that cannot list profiles can still verify against
        // "none", so this failure narrows the choice rather than blocking
        // the action.
      });
    return () => {
      cancelled = true;
    };
  }, [probe]);

  return profiles;
}

function useChain(
  probe: Probe,
): [ChainState, Choice, () => void, (profile: string, sources: AnchorProfile["sources"]) => void] {
  const [chain, setChain] = useState<ChainState>({ kind: "empty" });
  const [choice, setChoice] = useState<Choice>({ kind: "idle" });

  // The current chain state is read inside callbacks that outlive the render
  // they were created in — the drop listener is registered once. Holding it
  // in a ref as well keeps `openPath` from closing over a stale value and
  // failing to close the session that is actually open.
  const latest = useRef<ChainState>({ kind: "empty" });

  const apply = (next: ChainState) => {
    latest.current = next;
    setChain(next);
  };

  const open = (path: string) => {
    if (probe.kind !== "ready") {
      setChoice({ kind: "no-shell" });
      return;
    }
    setChoice({ kind: "idle" });
    void openPath(probe.session, latest.current, path, apply);
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // Only the first dropped path is opened, and the rest are reported
    // rather than dropped in silence. §22 has not decided what several files
    // mean — a segment sequence, or a mistake — so the screen says what it
    // did instead of pretending one file arrived.
    void onChainFilesDropped((paths) => {
      const first = paths[0];
      if (first === undefined) return;
      open(first);
      if (paths.length > 1) setChoice({ kind: "extra-dropped", total: paths.length });
    })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe.kind]);

  const pick = () => {
    void pickChainFile()
      .then((path) => {
        // null is a cancelled dialog: an ordinary outcome, and not a state of
        // any chain. Whatever was open stays open.
        if (path === null) setChoice({ kind: "cancelled" });
        else open(path);
      })
      .catch((err) => {
        if (err instanceof NoShellError) setChoice({ kind: "no-shell" });
      });
  };

  const verify = (profile: string, sources: AnchorProfile["sources"]) => {
    if (probe.kind !== "ready") return;
    void verifyOpen(probe.session, latest.current, profile, sources, apply);
  };

  return [chain, choice, pick, verify];
}

function choiceLine(choice: Choice): string | null {
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

export default function App() {
  const probe = useProbe();
  const profiles = useProfiles(probe);
  const [chosenProfile, setChosenProfile] = useState("none");
  const [chain, choice, pick, verify] = useChain(probe);
  const rows = rowsFor(probe, chain);
  const choiceNote = choiceLine(choice);
  const { panels, live } = panelsFor(chain);
  const canVerify = openedOf(chain) !== null && chain.kind !== "verifying";

  const sourcesOf = (name: string) =>
    profiles.find((p) => p.name === name)?.sources ?? [];

  // Present only when the verifier produced a diagnosis, which is only when
  // something failed.
  const failure = chain.kind === "verified" ? diagnosisCard(chain.result.diagnosis) : null;

  // Shown after any check, including when it is empty. Hiding the lane when
  // there is nothing in it would be ambiguous between "no advisory items"
  // and "nobody built this" — the same ambiguity the status panel exists to
  // remove.
  const advisory = chain.kind === "verified" ? chain.result.advisory : null;

  // The chain as walked, including the links resolution never reached.
  // Only after a check: before one there is nothing to show, and an empty
  // provenance block would read as "no sources" rather than "not yet asked".
  const links =
    chain.kind === "verified"
      ? provenance(chain.result.anchor_attempts, chain.sources)
      : [];

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

        <ol className="questions" data-live={live}>
          {panels.map((p) => (
            <li className="question" key={p.index} data-standing={p.standing}>
              <span className="question-index" aria-hidden="true">
                {p.index}
              </span>
              <div>
                <p className="question-text">{p.question}</p>
                {p.answer !== "" && <p className="question-answer">{p.answer}</p>}
                {/* The verifier's own sentence, set apart and never rewritten.
                    A localised line may sit beside it; never instead of it. */}
                {p.narrative !== undefined && (
                  <p className="question-narrative">{p.narrative}</p>
                )}
                <p className="question-basis">{p.basis}</p>
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
          <button
            className="choose-button"
            disabled={!canVerify}
            onClick={() => verify(chosenProfile, sourcesOf(chosenProfile))}
            type="button"
          >
            {chain.kind === "verifying" ? "Checking…" : "Verify"}
          </button>
          {/* "none" stays in the list rather than being filtered out. It is a
              real profile — it asks question one and leaves question two not
              checked — and hiding it would make verifying without an anchor
              look unavailable rather than default. */}
          <label className="choose-profile">
            <span className="choose-hint">against</span>
            <select
              disabled={!canVerify}
              onChange={(e) => setChosenProfile(e.target.value)}
              value={chosenProfile}
            >
              {(profiles.length > 0 ? profiles : [{ name: "none", sources: [] }]).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name === "none"
                    ? "no anchor — question two stays unchecked"
                    : `${p.name} (${p.sources.length} ${p.sources.length === 1 ? "source" : "sources"})`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {failure !== null && (
          <section className="diagnosis" aria-labelledby="diagnosis-title">
            <h2 className="diagnosis-title" id="diagnosis-title">
              {failure.title}
            </h2>

            {/* The verifier's own sentence is NOT repeated here. It is
                already under question one, where it answers "why not"; a
                second copy would read as emphasis, and emphasis is a claim.
                This card carries what the panel does not: the location, the
                expectation, and where to look. */}
            <dl className="diagnosis-facts">
              <div>
                <dt>Pattern</dt>
                <dd>
                  <code>{failure.pattern}</code>
                </dd>
              </div>
              {failure.atSeq !== null && (
                <div>
                  <dt>At record</dt>
                  <dd>#{failure.atSeq}</dd>
                </div>
              )}
              {failure.expected !== null && (
                <div>
                  <dt>Expected</dt>
                  <dd>{failure.expected}</dd>
                </div>
              )}
            </dl>

            <p className="diagnosis-lead">
              {failure.unrecognised
                ? "This build has no guidance for this pattern."
                : "Where to look — questions, not conclusions:"}
            </p>
            {/* Ordered: the guidance is written cheapest-and-likeliest
                first, and an unordered list would turn a deliberate sequence
                into three equally weighted suggestions. */}
            <ol className="diagnosis-where">
              {failure.whereToLook.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </section>
        )}

        {advisory !== null && (
          <section className="advisory" aria-labelledby="advisory-title">
            <h2 className="advisory-title" id="advisory-title">
              Advisory
            </h2>

            {/* The payload's own sentence, quoted. The API put it in the
                response so a UI could not soften it or leave it out. */}
            <p className="advisory-line">{advisoryLine(advisory)}</p>

            {advisoryGroups(advisory).map((g) => (
              <details className="advisory-group" data-weight={g.weight} key={g.code}>
                <summary>
                  <span className="advisory-count">{g.count}</span>
                  <span className="advisory-heading">{g.title}</span>
                  <code className="advisory-code">{g.code}</code>
                </summary>
                <p className="advisory-note">{g.note}</p>
                <ul className="advisory-items">
                  {g.items.map((item, i) => (
                    <li key={`${g.code}-${item.at_seq ?? "x"}-${i}`}>
                      {item.at_seq !== null && <span>record #{item.at_seq}</span>}
                      {item.boot_id !== null && <span>boot {item.boot_id.slice(0, 8)}</span>}
                      {/* The package's own description of this item. */}
                      {item.detail !== null && <span className="advisory-detail">{item.detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        )}

        {links.length > 0 && (
          <section className="provenance" aria-labelledby="provenance-title">
            <h2 className="provenance-title" id="provenance-title">
              Anchor provenance
            </h2>
            <ol className="provenance-list">
              {links.map((l) => (
                <li className="provenance-link" data-outcome={l.outcome} key={l.order}>
                  <span className="provenance-order" aria-hidden="true">
                    {l.order}
                  </span>
                  <div>
                    <p className="provenance-source">
                      {l.kind} — {l.detail}
                    </p>
                    <p className="provenance-note">{l.note}</p>
                    {/* The sidecar's own words, never rewritten. */}
                    {l.error !== undefined && (
                      <p className="provenance-error">{l.error}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p className="provenance-summary">{provenanceSummary(links)}</p>
          </section>
        )}

        <p className="footnote">{chainLine(chain)}</p>
        {choiceNote !== null && <p className="footnote">{choiceNote}</p>}
        <p className="footnote">{footnoteFor(probe, chain)}</p>
      </div>
    </main>
  );
}
