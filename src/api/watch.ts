// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Watch mode (F15): a file read as it is written.
 *
 * The package's `TailingReader` (channel 9 — provisional in 0.15, R17) does
 * the watching and names what happens at the tail; the sidecar runs it and
 * keeps the latest events with a cursor. This module asks for them and says
 * each in words. It decides nothing: the one alarm the package raises — the
 * file cut below what was verified — is said as the package says it.
 *
 * A watch is not a session. A session is pinned to the bytes it opened; a
 * watched file grows. To read it whole — boots, spans, the report — stop
 * and open the file.
 */

import type { WatchEvent, WatchEvents, WatchSnapshot, WatchStarted, WatchState } from "./generated/types";
import { count } from "./plural";
import type { Session } from "./session";

/** Said over the panel, always. */
export const WATCH_NOTE =
  "Reads the file as it is written: each record is checked as it lands, and what happens at the tail is said as the verifier names it. A watch holds every record it checked in memory and stops itself at its limit; it never writes the file. To read the file whole — boots, spans, the report — stop and open it.";

/**
 * Each tail event the package names, in words. Held to the package's
 * `TAIL_EVENT_KINDS` by vocabulary.test.ts: a kind it adds fails a test
 * before it reaches the panel unexplained.
 */
export const TAIL_EVENT_WORDING: Record<string, { label: string; weight: "plain" | "notable" | "alarm" }> = {
  record: { label: "checked", weight: "plain" },
  anchor_seen: { label: "anchor in the chain", weight: "plain" },
  pending_tail: {
    label: "a record still being written",
    weight: "plain",
  },
  shrunk: {
    label: "the unfinished tail was cut — a writer resuming after a crash does this; waiting for its recovery records",
    weight: "notable",
  },
  recovered: {
    label: "the writer resumed and recorded the cut tail",
    weight: "notable",
  },
  diagnosis: { label: "the verifier's finding", weight: "alarm" },
};

export const KNOWN_TAIL_KINDS: readonly string[] = Object.keys(TAIL_EVENT_WORDING);

export interface EventLine {
  n: number;
  seq: string;
  text: string;
  weight: "plain" | "notable" | "alarm";
}

/** One event as a line. An unknown kind is shown as the package gave it. */
export function eventLine(e: WatchEvent): EventLine {
  const w = TAIL_EVENT_WORDING[e.kind];
  const seq = e.seq === null ? "" : `#${e.seq}`;
  if (e.kind === "record") {
    return {
      n: e.n,
      seq,
      text: `${e.record_kind ?? "record"} checked` + (e.detail ? ` — “${e.detail}”` : ""),
      weight: "plain",
    };
  }
  if (w === undefined) {
    return { n: e.n, seq, text: `${e.kind}${e.detail ? `: ${e.detail}` : ""}`, weight: "notable" };
  }
  return { n: e.n, seq, text: e.detail ? `${w.label}: ${e.detail}` : w.label, weight: w.weight };
}

/** The state line over the events. */
export function stateLine(s: WatchState): { text: string; live: boolean } {
  const rec = `${count(s.records, "record")} checked` + (s.last_seq !== null ? `, last #${s.last_seq}` : "");
  switch (s.state) {
    case "watching":
      return { text: `Watching — ${rec}.`, live: true };
    case "limit":
      return { text: `Stopped — ${rec}. ${s.reason ?? ""}.`, live: false };
    case "failed":
      return { text: `The watch failed — ${rec}. ${s.reason ?? ""}`, live: false };
    default:
      return { text: `Stopped — ${rec}.`, live: false };
  }
}

/** The snapshot in a sentence: the package's batch answer over the verified prefix. */
export function snapshotLine(v: WatchSnapshot): { text: string; finding: boolean } {
  const head = `head ${v.chain.head.slice(0, 16)}…`;
  const d = v.diagnosis;
  if (!v.chain.chain_ok || d !== null) {
    return {
      text:
        `Over the ${count(v.chain.count, "record")} checked so far: ` +
        (d !== null ? d.narrative : "the header chain does not link") +
        `. ${head}.`,
      finding: true,
    };
  }
  const anchored =
    v.completeness.complete_to_anchor === true
      ? " The anchor's head is in it."
      : v.completeness.complete_to_anchor === false
        ? " The anchor's head is not reached."
        : "";
  return {
    text: `Over the ${count(v.chain.count, "record")} checked so far, each links to the one before it; ${head}.${anchored} Bodies are not walked here — open the file for that.`,
    finding: false,
  };
}

/** Most event lines kept in the panel. */
export const PANEL_EVENTS = 200;

function base(session: Session, path: string): string {
  return `http://127.0.0.1:${session.port}${path}`;
}

function headers(session: Session): HeadersInit {
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

async function ok<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const body = (await r.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* the status says it */
    }
    throw new Error(detail);
  }
  return (await r.json()) as T;
}

export async function startWatch(session: Session, path: string, profile: string): Promise<WatchStarted> {
  return ok(
    await fetch(base(session, "/watch"), {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ path, profile }),
    }),
  );
}

export async function watchEvents(
  session: Session,
  watchId: string,
  after: number,
  wait: number,
  signal?: AbortSignal,
): Promise<WatchEvents> {
  return ok(
    await fetch(base(session, `/watch/${watchId}/events?after=${after}&wait=${wait}`), {
      headers: headers(session),
      signal,
    }),
  );
}

export async function watchSnapshot(session: Session, watchId: string): Promise<WatchSnapshot> {
  return ok(await fetch(base(session, `/watch/${watchId}/snapshot`), { headers: headers(session) }));
}

export async function stopWatch(session: Session, watchId: string): Promise<void> {
  const r = await fetch(base(session, `/watch/${watchId}`), { method: "DELETE", headers: headers(session) });
  if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
}
