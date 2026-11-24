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
import { t, tn } from "../i18n";
import { count } from "./plural";
import type { Session } from "./session";

/** Said over the panel, always. */
export const watchNote = (): string => t("watch.note");

/**
 * Each tail event the package names, and its weight. The words are the
 * catalogs' (`watch.kind.<kind>`). Held to the package's `TAIL_EVENT_KINDS`
 * by vocabulary.test.ts: a kind it adds fails a test before it reaches the
 * panel unexplained.
 */
export const TAIL_EVENT_WEIGHT: Record<string, "plain" | "notable" | "alarm"> = {
  record: "plain",
  anchor_seen: "plain",
  pending_tail: "plain",
  shrunk: "notable",
  recovered: "notable",
  diagnosis: "alarm",
};

export const KNOWN_TAIL_KINDS: readonly string[] = Object.keys(TAIL_EVENT_WEIGHT);

export interface EventLine {
  n: number;
  seq: string;
  text: string;
  weight: "plain" | "notable" | "alarm";
}

/** One event as a line. An unknown kind is shown as the package gave it. */
export function eventLine(e: WatchEvent): EventLine {
  const weight = TAIL_EVENT_WEIGHT[e.kind];
  const seq = e.seq === null ? "" : `#${e.seq}`;
  if (e.kind === "record") {
    // The kind name is the package's: shown as it wrote it (L-03).
    const kind = e.record_kind ?? t("watch.record");
    return {
      n: e.n,
      seq,
      text: e.detail ? t("watch.event.record_detail", { kind, detail: e.detail }) : t("watch.event.record", { kind }),
      weight: "plain",
    };
  }
  if (weight === undefined) {
    return { n: e.n, seq, text: e.detail ? t("watch.event.unknown", { kind: e.kind, detail: e.detail }) : e.kind, weight: "notable" };
  }
  const label = t(`watch.kind.${e.kind}`);
  return { n: e.n, seq, text: e.detail ? t("watch.event.with_detail", { label, detail: e.detail }) : label, weight };
}

/** The state line over the events. */
export function stateLine(s: WatchState): { text: string; live: boolean } {
  const checked = tn("watch.state.records", s.records);
  const records = s.last_seq !== null ? t("watch.state.last", { records: checked, seq: s.last_seq }) : checked;
  switch (s.state) {
    case "watching":
      return { text: t("watch.state.watching", { records }), live: true };
    case "limit":
      return { text: t("watch.state.limit", { records, reason: s.reason ?? "" }), live: false };
    case "failed":
      return { text: t("watch.state.failed", { records, reason: s.reason ?? "" }), live: false };
    default:
      return { text: t("watch.state.stopped", { records }), live: false };
  }
}

/** The snapshot in a sentence: the package's batch answer over the verified prefix. */
export function snapshotLine(v: WatchSnapshot): { text: string; finding: boolean } {
  const head = t("watch.snapshot.head", { head: v.chain.head.slice(0, 16) });
  const records = count(v.chain.count, "record");
  const d = v.diagnosis;
  if (!v.chain.chain_ok || d !== null) {
    return {
      // The narrative is the package's, verbatim (L-03).
      text: t("watch.snapshot.finding", { records, finding: d !== null ? d.narrative : t("watch.snapshot.no_link"), head }),
      finding: true,
    };
  }
  const anchored =
    v.completeness.complete_to_anchor === true
      ? t("watch.snapshot.anchor_in")
      : v.completeness.complete_to_anchor === false
        ? t("watch.snapshot.anchor_out")
        : "";
  return { text: t("watch.snapshot.ok", { records, head, anchored }), finding: false };
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
