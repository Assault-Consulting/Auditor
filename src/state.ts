// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The application's live state: what the shell reports, which chain is open,
 * which profiles exist, and the rail for the open chain.
 *
 * Split out of App.tsx when that file reached 738 lines, and the seam is not
 * arbitrary: everything here *has* to run inside React, and everything in
 * `api/bootScreen.ts` is a pure function of what these return.
 *
 * That line is what makes the other half testable — and the two pieces of
 * this application that have gone wrong most often, the wired-status panel
 * and the footnote, were on the untestable side of it purely because of
 * where they sat in a file.
 */

import { useEffect, useRef, useState } from "react";

import { chainBoots, chainSpans, chainTimeline, listProfiles } from "./api/chain";
import { type BootRow, type SpanRow, bootRows, spanRows } from "./api/browse";
import { type ChainState, openPath, openedOf, verifyOpen } from "./api/chainState";
import { type Chronoscope, chronoscope } from "./api/chronoscope";
import type { AnchorProfile } from "./api/generated/types";
import { onChainFilesDropped, pickChainFile } from "./api/openFile";
import { type Health, NoShellError, getHealth, getSession } from "./api/session";

/** What the shell reports, once it has answered — or why it has not. */
export type Probe =
  | { kind: "starting" }
  // The session travels with the probe rather than being fetched again when
  // a chain is opened. Asking the shell twice would be two chances to get a
  // different answer, and the token is per launch — there is only one right
  // one.
  | { kind: "ready"; health: Health; session: Awaited<ReturnType<typeof getSession>> }
  | { kind: "no-shell" }
  | { kind: "failed"; detail: string };

export function useProbe(): Probe {
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
export type Choice =
  | { kind: "idle" }
  | { kind: "cancelled" }
  | { kind: "no-shell" }
  /** More than one file was dropped, and only the first was opened. */
  | { kind: "extra-dropped"; total: number };

/**
 * The date rail for an open chain, or null until one is open.
 *
 * Fetched with `align: "day"` because a rail labels rows with dates, and a
 * uniform bucket of roughly a day straddles midnight — a record just after
 * one would be shown under the previous date.
 *
 * A failure here leaves the rail absent rather than blocking anything: the
 * verdict, the records and the diagnosis are all independent of it, and a
 * screen that refused to open a chain because its density chart failed
 * would be trading the whole tool for one panel.
 */
export function useRail(probe: Probe, chain: ChainState): Chronoscope | null {
  const [rail, setRail] = useState<Chronoscope | null>(null);
  const opened = openedOf(chain);

  useEffect(() => {
    if (probe.kind !== "ready" || opened === null) {
      setRail(null);
      return;
    }
    let cancelled = false;
    void chainTimeline(probe.session, opened.session_id, {
      axis: "wall",
      align: "day",
      // Generous: the ceiling is a refusal, not a truncation, so the number
      // only has to be larger than any chain a desk will open. A rail that
      // silently dropped its last week would look like a chain that ended
      // early.
      buckets: 2000,
    })
      .then((timeline) => {
        if (!cancelled) setRail(chronoscope(timeline));
      })
      .catch(() => {
        if (!cancelled) setRail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [probe, opened]);

  return rail;
}

/**
 * The boots and spans of the open chain, or empty until one is open.
 *
 * Fetched together and held together because they are read together — the
 * boot list and the span list are one screen — but requested separately so
 * a sidecar that can answer one and not the other still answers one.
 *
 * A failure leaves the lists empty rather than blocking anything else, for
 * the same reason the rail does: the verdict, the diagnosis and the records
 * are all independent of this, and a screen that refused to open a chain
 * because its span list failed would trade the whole tool for one panel.
 */
export function useBrowse(
  probe: Probe,
  chain: ChainState,
): { boots: BootRow[]; spans: SpanRow[] } {
  const [boots, setBoots] = useState<BootRow[]>([]);
  const [spans, setSpans] = useState<SpanRow[]>([]);
  const opened = openedOf(chain);

  useEffect(() => {
    if (probe.kind !== "ready" || opened === null) {
      setBoots([]);
      setSpans([]);
      return;
    }
    let cancelled = false;
    void chainBoots(probe.session, opened.session_id)
      .then((list) => {
        if (!cancelled) setBoots(bootRows(list));
      })
      .catch(() => {
        if (!cancelled) setBoots([]);
      });
    void chainSpans(probe.session, opened.session_id)
      .then((list) => {
        if (!cancelled) setSpans(spanRows(list));
      })
      .catch(() => {
        if (!cancelled) setSpans([]);
      });
    return () => {
      cancelled = true;
    };
  }, [probe, opened]);

  return { boots, spans };
}

/**
 * The anchor profiles this sidecar knows.
 *
 * Fetched once the shell is ready rather than on every verify: the list
 * changes only when someone edits it, and re-fetching per check would put a
 * network round trip in front of an action whose whole point is to be
 * repeatable.
 */
export function useProfiles(probe: Probe): AnchorProfile[] {
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

export function useChain(
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
