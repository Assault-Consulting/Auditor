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

import { chainBoots, chainSpans, chainTimeline, getOrigin, getRecord, getRecords, listProfiles } from "./api/chain";
import { type BootRow, type SpanRow, bootRows, spanRows } from "./api/browse";
import { type ChainState, openPath, openedOf, verifyOpen } from "./api/chainState";
import { type Chronoscope, chronoscope } from "./api/chronoscope";
import type { AnchorProfile } from "./api/generated/types";
import { onChainFilesDropped, pickChainFile } from "./api/openFile";
import { type OriginCard, originCard } from "./api/origin";
import { type RecordCard, recordCard } from "./api/record";
import { nextOffset, recordsPage, type RecordsPage } from "./api/records";
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
 * A list that has been asked for, or has not, or could not be got.
 *
 * Three states rather than an array, because an empty array answers two
 * different questions the same way: "this container has none" and "the
 * request failed". That is the distinction the anchor sources keep as
 * absent-versus-error and the verdict keeps as false-versus-null, and a
 * browse list has no more right to collapse it than they do.
 *
 * The failure carries the sidecar's own sentence, so a screen can say what
 * went wrong rather than that something did.
 */
export type Listing<T> =
  | { kind: "unasked" }
  | { kind: "loaded"; rows: T[] }
  | { kind: "failed"; detail: string };

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
): { boots: Listing<BootRow>; spans: Listing<SpanRow> } {
  const [boots, setBoots] = useState<Listing<BootRow>>({ kind: "unasked" });
  const [spans, setSpans] = useState<Listing<SpanRow>>({ kind: "unasked" });
  const opened = openedOf(chain);

  useEffect(() => {
    if (probe.kind !== "ready" || opened === null) {
      setBoots({ kind: "unasked" });
      setSpans({ kind: "unasked" });
      return;
    }
    let cancelled = false;
    const detailOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

    void chainBoots(probe.session, opened.session_id)
      .then((list) => {
        if (!cancelled) setBoots({ kind: "loaded", rows: bootRows(list) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setBoots({ kind: "failed", detail: detailOf(e) });
      });
    void chainSpans(probe.session, opened.session_id)
      .then((list) => {
        if (!cancelled) setSpans({ kind: "loaded", rows: spanRows(list) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setSpans({ kind: "failed", detail: detailOf(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [probe, opened]);

  return { boots, spans };
}

/**
 * One thing that was asked for, or was not, or could not be got —
 * {@link Listing}'s three states without the array `Listing` assumes. A
 * record card is one thing, not a list of one, and `rows: [card]` would
 * have said otherwise to whoever read this next.
 */
export type Fetch<T> =
  | { kind: "unasked" }
  | { kind: "found"; value: T }
  | { kind: "failed"; detail: string };

/**
 * The record last asked for by sequence number, and a way to ask for
 * another.
 *
 * F9 renders the origin card "on any selected record" — this is that
 * selection. There is no seq-jump UI yet (F10, C-09); `select` is the whole
 * of the mechanism today, and a caller supplies the number however it has
 * one until a search bar exists to supply it.
 *
 * Opening a different chain drops whatever was selected in the last one: a
 * card left on screen after its container closed would go on naming a seq
 * that container's replacement may not have, or worse, one it has and means
 * something else.
 */
export function useRecord(
  probe: Probe,
  chain: ChainState,
): { record: Fetch<RecordCard>; select: (seq: number) => void } {
  const [record, setRecord] = useState<Fetch<RecordCard>>({ kind: "unasked" });
  const opened = openedOf(chain);

  useEffect(() => {
    setRecord({ kind: "unasked" });
  }, [opened?.session_id]);

  const select = (seq: number) => {
    if (probe.kind !== "ready" || opened === null) return;
    void getRecord(probe.session, opened.session_id, seq)
      .then((view) => setRecord({ kind: "found", value: recordCard(view) }))
      .catch((e: unknown) => {
        setRecord({
          kind: "failed",
          detail: e instanceof Error ? e.message : String(e),
        });
      });
  };

  return { record, select };
}

/**
 * What was declared active for the record `useRecord` currently has
 * open — F9's origin card, "rendered … on any selected record."
 *
 * Keyed off the selected record's own `seq` rather than driven by a
 * second `select` call: origin changes along the chain (the endpoint
 * requires `seq` explicitly for exactly that reason), so this hook exists
 * to keep the two fetches in lockstep with the same selection, not to add
 * a second one the caller has to drive.
 */
export function useOrigin(
  probe: Probe,
  chain: ChainState,
  seq: number | null,
): Fetch<OriginCard | null> {
  const [origin, setOrigin] = useState<Fetch<OriginCard | null>>({ kind: "unasked" });
  const opened = openedOf(chain);

  useEffect(() => {
    if (probe.kind !== "ready" || opened === null || seq === null) {
      setOrigin({ kind: "unasked" });
      return;
    }
    let cancelled = false;
    void getOrigin(probe.session, opened.session_id, seq)
      .then((model) => {
        if (!cancelled) setOrigin({ kind: "found", value: originCard(model) });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setOrigin({
            kind: "failed",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [probe, opened, seq]);

  return origin;
}

/**
 * The records list, paged — C-11.
 *
 * "Next page" asks for one past the last row's own seq, never
 * `offset + limit` — see `nextOffset` in `api/records.ts` for why the two
 * are not the same number. "Previous page" has no backward equivalent to
 * derive: the endpoint's `offset` is forward-only ("seq >= offset"), so
 * going back means remembering where this page came from, and the history
 * stack here is exactly that memory, nothing more.
 */
export function useRecords(
  probe: Probe,
  chain: ChainState,
  limit: number,
): { page: Fetch<RecordsPage>; next: () => void; prev: () => void; canGoBack: boolean } {
  const [page, setPage] = useState<Fetch<RecordsPage>>({ kind: "unasked" });
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const opened = openedOf(chain);

  useEffect(() => {
    setOffset(0);
    setHistory([]);
  }, [opened?.session_id]);

  useEffect(() => {
    if (probe.kind !== "ready" || opened === null) {
      setPage({ kind: "unasked" });
      return;
    }
    let cancelled = false;
    void getRecords(probe.session, opened.session_id, { offset, limit })
      .then((result) => {
        if (!cancelled) setPage({ kind: "found", value: recordsPage(result) });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPage({
            kind: "failed",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [probe, opened, offset, limit]);

  const next = () => {
    if (page.kind !== "found") return;
    const at = nextOffset(page.value);
    if (at === null) return;
    setHistory((h) => [...h, offset]);
    setOffset(at);
  };

  const prev = () => {
    setHistory((h) => {
      const previous = h.at(-1);
      if (previous === undefined) return h;
      setOffset(previous);
      return h.slice(0, -1);
    });
  };

  return { page, next, prev, canGoBack: history.length > 0 };
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
