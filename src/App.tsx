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
 *
 * What is left here is markup and the decisions that live in markup. The
 * state is in `state.ts`, the wording is in `api/bootScreen.ts`, and the
 * split is what let the wording acquire tests.
 */

import { type FormEvent, useEffect, useRef, useState } from "react";

import { advisoryGroups, advisoryLine } from "./api/advisory";
import { choiceLine, footnoteFor, panelsFor, rowsFor } from "./api/bootScreen";
import { chainLine, openedOf } from "./api/chainState";
import { backwards, bootChips, compress, compressionLine, daySelected, density, railChips, selectedDays } from "./api/chronoscope";
import { diagnosisCard } from "./api/diagnosis";
import { manifestLine } from "./api/manifest";
import { provenance, provenanceSummary } from "./api/provenance";
import { type RecordFilters, resolveChips } from "./api/filters";
import { getNearest, getRecords, getReport } from "./api/chain";
import { type NearestLine, nearestLine } from "./api/nearest";
import { type Chip, chipLabel, nextWarning, parseSearch, SEARCH_HELP } from "./api/search";
import { safetyGroupKey } from "./api/safety";
import { unsearchedLine } from "./api/records";
import { ATTESTATION, type ReportView, reportView } from "./api/report";
import {
  EXPORT_NOTE,
  exportFileName,
  exportRecords,
  parseRange,
  type SummaryLine,
  summaryLine,
} from "./api/exportFile";
import { PRINT_OPENED, printReport, reportFileName, saveArtifact, savedLine } from "./api/saveFile";
import { useBrowse, useChain, useOrigin, useProbe, useProfiles, useRail, useRecord, useRecordBytes, useRecordHealth, useRecords, useSafety, useSegmentSet, useWitness } from "./state";
import { offsetLabel } from "./api/hexView";
import { segmentState, setAnswers } from "./api/segmentSet";
import { BASIS_LABEL, HEALTH_NOTE } from "./api/health";
import { WITNESS_LIMITS, witnessLine, witnessRows, witnessStatus } from "./api/witness";

// C-11's page size. Well inside the sidecar's own 1000-record ceiling, and
// small enough that a page reads as a page rather than a scroll.
const RECORDS_PAGE_SIZE = 50;

export default function App() {
  const probe = useProbe();
  const profiles = useProfiles(probe);
  const [chosenProfile, setChosenProfile] = useState("none");
  // §22.1. Declared before the chain so a dropped manifest can reach it.
  const segmentSet = useSegmentSet(probe);
  const [chain, choice, pick, verify, openPathInShell] = useChain(probe, segmentSet.check);
  const rail = useRail(probe, chain);
  const { boots, spans } = useBrowse(probe, chain);
  // H1: a long open or check says how long it has run. The sidecar gives
  // no progress, so this counts time, never claims a fraction done.
  const busy = chain.kind === "opening" || chain.kind === "verifying";
  const [busyFor, setBusyFor] = useState(0);
  useEffect(() => {
    setBusyFor(0);
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setBusyFor(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const elapsed = busyFor >= 2 ? ` ${busyFor} s` : "";
  const safety = useSafety(probe, chain);
  const health = useRecordHealth(probe, chain);
  // C-09b: the chips the list is currently narrowed by, and the query they
  // resolved to. Kept together so the heading can always say which chips
  // produced the rows under it.
  const [activeChips, setActiveChips] = useState<Chip[]>([]);
  const [recordFilters, setRecordFilters] = useState<RecordFilters>({});
  const { page: recordsPage, next: recordsNext, prev: recordsPrev, canGoBack: recordsCanGoBack } =
    useRecords(probe, chain, RECORDS_PAGE_SIZE, recordFilters);
  // Chips belong to the file they were typed against. A boot id resolved
  // in one container names nothing in the next, and carried over it would
  // show the new file as "no records match these filters" — a statement
  // about a question nobody asked of it.
  const openedSessionId = openedOf(chain)?.session_id;
  useEffect(() => {
    setActiveChips([]);
    setRecordFilters({});
  }, [openedSessionId]);
  const { record, select: selectRecord } = useRecord(probe, chain);
  // Kept in lockstep with the record card rather than driven separately —
  // origin is F9's card "on any selected record", and next-warning below
  // reads the same seq for the same reason: both are about whichever
  // record is on screen, not a second selection of their own.
  const selectedSeq = record.kind === "found" ? record.value.seq : null;
  // H3: a way back. Every jump — a row, a quick button, a link inside a
  // card — goes through here, so "back" returns to the record read before,
  // the way a browser's does. Twenty deep; cleared with the file.
  const [visited, setVisited] = useState<number[]>([]);
  const select = (seq: number) => {
    if (selectedSeq !== null && selectedSeq !== seq) {
      setVisited((v) => [...v.slice(-19), selectedSeq]);
    }
    selectRecord(seq);
  };
  const back = () => {
    const prev = visited[visited.length - 1];
    if (prev === undefined) return;
    setVisited((v) => v.slice(0, -1));
    selectRecord(prev);
  };
  useEffect(() => {
    setVisited([]);
    setRailAnchor(null);
  }, [openedSessionId]);
  const origin = useOrigin(probe, chain, selectedSeq);
  // C-06d: the raw view stays open from one record to the next once asked
  // for, so stepping through records keeps showing their bytes.
  const [showBytes, setShowBytes] = useState(false);
  const [hotSegment, setHotSegment] = useState<number | null>(null);
  const bytes = useRecordBytes(probe, chain, selectedSeq, showBytes);
  // E-05. The latest check's entry, so the panel asks again once it is written.
  const thisCheck = chain.kind === "verified" ? witnessLine(chain.result.witness) : null;
  const witness = useWitness(
    probe,
    chain.kind === "verified" ? (chain.result.witness?.hash ?? chain.result.witness?.error ?? null) : null,
  );
  const rows = rowsFor(probe, chain, rail, { boots, spans });
  const choiceNote = choiceLine(choice);
  const { panels, live } = panelsFor(chain);
  const canVerify = openedOf(chain) !== null && chain.kind !== "verifying";

  const sourcesOf = (name: string) =>
    profiles.find((p) => p.name === name)?.sources ?? [];

  // F10's own syntax, and only the slice of it this application can
  // answer honestly today — see api/search.ts for what the rest needs
  // and why it is not here yet.
  const [searchField, setSearchField] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
  // C-09c: what a time jump found, with every qualifier the sidecar sent.
  // Cleared by any other search, so a stale answer never sits beside a
  // record it was not about.
  const [jump, setJump] = useState<NearestLine | null>(null);
  const opened = openedOf(chain);
  const sessionOf = () =>
    probe.kind === "ready" && opened !== null
      ? { session: probe.session, id: opened.session_id }
      : null;

  const runSearch = (e: FormEvent) => {
    e.preventDefault();
    const outcome = parseSearch(searchField);
    if (outcome === null) return;
    setJump(null);
    if (outcome.kind === "time") {
      const s = sessionOf();
      if (s === null) return;
      setSearchNote(null);
      void getNearest(s.session, s.id, outcome.ns)
        .then((n) => {
          // The instant is printed back as UTC, by name: a bare
          // "@2026-08-06T22:41" was read as UTC, and the line says so.
          setJump(nearestLine(n, outcome.iso.replace(".000Z", " UTC").replace("T", " ")));
          select(n.seq);
        })
        .catch((err: unknown) => setSearchNote(err instanceof Error ? err.message : String(err)));
      return;
    }
    if (outcome.kind === "seq") {
      setSearchNote(null);
      select(outcome.seq);
      return;
    }
    if (outcome.kind === "unsupported") {
      // Named plainly rather than silently ignored — and the list is left
      // as it was, not half-filtered by whatever part of the input parsed.
      setSearchNote(outcome.reason);
      return;
    }
    applyChips(outcome.chips);
  };

  // One way in for every filter: the bar, a click on the rail. Returns
  // whether it took, so a caller knows whether the list now answers to it.
  const applyChips = (chips: Chip[]): boolean => {
    const resolved = resolveChips(chips, {
      boots: boots.kind === "loaded" ? boots.rows.map((b) => b.boot_id) : null,
      spans: spans.kind === "loaded" ? spans.rows.map((s) => s.span_id) : null,
    });
    if (resolved.kind === "refused") {
      setSearchNote(resolved.reason);
      return false;
    }
    setSearchNote(null);
    setActiveChips(chips);
    setRecordFilters(resolved.filters);
    return true;
  };

  // F6 — the rail and the strip as ways in. A day narrows the list to that
  // day; Shift with a second day, to the range between; a SAFETY mark, to
  // that day's SAFETY records; a boot, to that boot, opening its first
  // record. The query lands in the bar too, so it can be read and edited,
  // and the list is brought into view — the click's answer is there.
  const [railAnchor, setRailAnchor] = useState<string | null>(null);
  const showRecords = () => {
    const heading = document.getElementById("records-title");
    heading?.scrollIntoView({ block: "start" });
  };
  const narrowTo = (chips: Chip[]) => {
    if (applyChips(chips)) {
      setSearchField(chips.map(chipLabel).join(" "));
      showRecords();
    }
  };
  const pickDay = (date: string, extend: boolean, safetyOnly = false) => {
    const from = extend && railAnchor !== null ? railAnchor : date;
    if (!extend) setRailAnchor(date);
    narrowTo(railChips(from, date, safetyOnly));
  };
  const pickBoot = (bootId: string, firstSeq: number) => {
    narrowTo(bootChips(bootId));
    select(firstSeq);
  };
  const railRange = selectedDays(activeChips);

  const clearFilters = () => {
    setActiveChips([]);
    setRecordFilters({});
  };

  // D-01 — the package's report, built on request for the chosen profile.
  // Belongs to the file it was built for: opening another clears it.
  type ReportState =
    | { kind: "idle" }
    | { kind: "building" }
    | { kind: "ready"; view: ReportView; profile: string; fileName: string; htmlFileName: string }
    | { kind: "failed"; detail: string };
  const [report, setReport] = useState<ReportState>({ kind: "idle" });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // D-01b: the package's HTML page, shown only when asked for.
  const [showHtml, setShowHtml] = useState(false);
  // D-07. Cancelling the dialog is not a failure, and leaves nothing to say.
  type SaveState =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; line: string }
    | { kind: "failed"; detail: string };
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  // D-02. The print window is the shell's; this only says it opened, or why not.
  type PrintState = { kind: "idle" } | { kind: "opened" } | { kind: "failed"; detail: string };
  const [printState, setPrintState] = useState<PrintState>({ kind: "idle" });
  // D-06. The range as typed, and what the last export did.
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  type ExportState =
    | { kind: "idle" }
    | { kind: "exporting" }
    | { kind: "saved"; line: string; summary: SummaryLine }
    | { kind: "failed"; detail: string };
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  useEffect(() => {
    setReport({ kind: "idle" });
    setCopyState("idle");
    setSaveState({ kind: "idle" });
    setPrintState({ kind: "idle" });
    setShowHtml(false);
    setExportFrom("");
    setExportTo("");
    setExportState({ kind: "idle" });
  }, [openedSessionId]);
  // H5: the range is read as it is typed, and the reason it would be
  // refused is shown before the button is pressed, which stays disabled.
  const typedRange = parseRange(exportFrom, exportTo);
  const runExport = () => {
    const opened = openedOf(chain);
    if (opened === null) return;
    const range = parseRange(exportFrom, exportTo);
    if (range.kind === "refused") {
      setExportState({ kind: "failed", detail: range.reason });
      return;
    }
    setExportState({ kind: "exporting" });
    void exportRecords(opened.session_id, range, exportFileName(opened.subject.filename))
      .then((saved) =>
        setExportState(
          saved === null
            ? { kind: "idle" }
            : { kind: "saved", line: savedLine(saved), summary: summaryLine(saved.summary) },
        ),
      )
      .catch((err: unknown) =>
        setExportState({ kind: "failed", detail: err instanceof Error ? err.message : String(err) }),
      );
  };
  const buildReport = () => {
    const s = sessionOf();
    if (s === null) return;
    const profile = chosenProfile;
    setReport({ kind: "building" });
    setCopyState("idle");
    setSaveState({ kind: "idle" });
    setPrintState({ kind: "idle" });
    setShowHtml(false);
    void getReport(s.session, s.id, profile)
      .then((r) =>
        setReport({
          kind: "ready",
          view: reportView(r),
          profile,
          fileName: reportFileName(r.report),
          htmlFileName: reportFileName(r.report, "html"),
        }),
      )
      .catch((err: unknown) =>
        setReport({ kind: "failed", detail: err instanceof Error ? err.message : String(err) }),
      );
  };
  const saveReport = (fileName: string, text: string) => {
    setSaveState({ kind: "saving" });
    void saveArtifact(fileName, text)
      .then((saved) =>
        setSaveState(saved === null ? { kind: "idle" } : { kind: "saved", line: savedLine(saved) }),
      )
      .catch((err: unknown) =>
        setSaveState({ kind: "failed", detail: err instanceof Error ? err.message : String(err) }),
      );
  };
  const printPage = (html: string) => {
    void printReport(html)
      .then(() => setPrintState({ kind: "opened" }))
      .catch((err: unknown) =>
        setPrintState({ kind: "failed", detail: err instanceof Error ? err.message : String(err) }),
      );
  };
  const copyReport = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"));
  };

  // Present only when the verifier produced a diagnosis, which is only when
  // something failed.
  const failure = chain.kind === "verified" ? diagnosisCard(chain.result.diagnosis) : null;
  // The second file the verdict rests on, when there is one (C-13). Null for
  // every verdict that consulted no segments manifest.
  const manifest = chain.kind === "verified" ? manifestLine(chain.result.manifest) : null;

  // Shown after any check, including when it is empty. Hiding the lane when
  // there is nothing in it would be ambiguous between "no advisory items"
  // and "nobody built this" — the same ambiguity the status panel exists to
  // remove.
  const advisory = chain.kind === "verified" ? chain.result.advisory : null;

  // F10's three quick buttons. The anchor button (C-09c) finds the record
  // whose own hash is the verified anchor's head — and when no record in
  // this file has it, says so. It never falls back to the last record:
  // "the anchor names nothing here" is the finding question two reports
  // as replaced_or_rolled_back or unanchored_tail, and a button that
  // jumped somewhere anyway would hide it.
  const firstSeq = openedOf(chain)?.subject.first_seq ?? null;
  const anchoredHead =
    chain.kind === "verified" && chain.result.anchor !== null ? chain.result.anchor.head : null;
  const jumpToAnchor = () => {
    const s = sessionOf();
    if (s === null || anchoredHead === null) return;
    setJump(null);
    void getRecords(s.session, s.id, { recordHash: anchoredHead, limit: 1 })
      .then((page) => {
        const found = page.records[0];
        if (found === undefined) {
          setSearchNote(
            `The anchored head ${anchoredHead.slice(0, 8)} names no record in this file — see question two.`,
          );
        } else {
          setSearchNote(null);
          select(found.seq);
        }
      })
      .catch((err: unknown) => setSearchNote(err instanceof Error ? err.message : String(err)));
  };
  const nextWarningSeq = advisory !== null ? nextWarning(advisory.items, selectedSeq) : null;

  // H7: the keys a reader at a desk reaches for. "/" to search, j / k to
  // step through the list shown, n for the next warning, Backspace-free
  // "b" for back. Never while typing in a field, and never with a
  // modifier, so no key the system or a screen reader owns is taken.
  const searchInput = useRef<HTMLInputElement>(null);
  const keyed = useRef<(e: KeyboardEvent) => void>(() => {});
  keyed.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t !== null && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))) {
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      searchInput.current?.focus();
      return;
    }
    if (e.key === "n" && nextWarningSeq !== null) {
      select(nextWarningSeq);
      return;
    }
    if (e.key === "b") {
      back();
      return;
    }
    if ((e.key === "j" || e.key === "k") && recordsPage.kind === "found") {
      const rows = recordsPage.value.rows;
      if (rows.length === 0) return;
      const at = rows.findIndex((r) => r.seq === selectedSeq);
      const to = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)));
      select(rows[to]!.seq);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyed.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bar widths, computed once and keyed by date.
  //
  // Two quadratic shapes avoided, and the second only because the first had
  // already happened here. Calling density() inside the row map rebuilds the
  // whole array per row; looking a day up with `days.indexOf(day)` searches
  // per row. Once empty stretches fold, the rendered rows are no longer the
  // days one-to-one, so a positional lookup would have had to search — and
  // the date is the row's key anyway.
  //
  // The scale is computed over ALL the days rather than the surviving rows:
  // a bar's width means "against the busiest day in this chain", and
  // rescaling to what survived compression would make a quiet day look busy
  // the moment its quieter neighbours were folded away.
  const widths = new Map<string, number>(
    rail === null ? [] : density(rail.days).map((w, i) => [rail.days[i]!.date, w]),
  );

  // Empty stretches collapse into marks that state their own extent (§C-03,
  // "never silent compression").
  const railRows = rail === null ? [] : compress(rail.days, rail.segments);

  // The chain as walked, including the links resolution never reached.
  // Only after a check: before one there is nothing to show, and an empty
  // provenance block would read as "no sources" rather than "not yet asked".
  const links =
    chain.kind === "verified"
      ? provenance(chain.result.anchor_attempts, chain.sources)
      : [];

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-title">
        <p className="eyebrow">Reader for PALA-1 audit chains</p>

        <h1 className="wordmark">
          Palimpsests <em>Auditor</em>
        </h1>
        </div>
        <p className="thesis">
          Opens an audit chain and answers three separate questions about it.
          It attests that a check was run against a named file, with a named
          anchor, at a stated time. It certifies nothing.
        </p>

        <div className="choose">
          {/* Disabled while opening — not decorative. §19 targets a
              100 MB / ~1M-record chain, and opening one still takes
              seconds: the sidecar reads every record's header once to
              describe the file (measured at 1M records: under a second to
              open the container, about five more for the header index —
              C-10b; it was 21.6 s and 2 GB before). A second click
              mid-open would start a second concurrent open rather than do
              anything useful with the wait. */}
          <button
            className="choose-button"
            disabled={chain.kind === "opening"}
            onClick={pick}
            type="button"
          >
            {chain.kind === "opening" ? `Opening…${elapsed}` : "Open a chain…"}
          </button>
          <button
            className="choose-button"
            disabled={segmentSet.set.kind === "checking"}
            onClick={segmentSet.pick}
            type="button"
          >
            {segmentSet.set.kind === "checking" ? "Checking the set…" : "Open a segment set…"}
          </button>
          <button
            className="choose-button"
            disabled={!canVerify}
            onClick={() => verify(chosenProfile, sourcesOf(chosenProfile))}
            type="button"
          >
            {chain.kind === "verifying" ? `Checking…${elapsed}` : "Verify"}
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
        {/* C-13. A rotated chain arrives as numbered files (chain.pala.00001),
            whose extension the dialog's PALA-1 filter does not match. Said
            here rather than by widening the filter: a filter on "anything
            ending in digits" would offer files that are not chains. */}
        <p className="choose-hint segment-hint">
          Segments of a rotated chain end in a number (<code>chain.pala.00001</code>) — in the
          open dialog they are listed under “All files”.
        </p>
        {/* The file line doubles as the live region: a screen reader hears
            "Opening…", the file and what it was checked against as each
            arrives (WCAG 4.1.3). The answers themselves are announced by
            the questions list below. */}
        <p className="chain-line" role="status">
          {chainLine(chain)}
        </p>
        {choiceNote !== null && <p className="footnote">{choiceNote}</p>}
      </header>

      {/* §22.1 — a segmented chain as one set. Above the three questions
          because it answers the first two for the set; each segment then
          opens as a chain of its own, to be asked them again. */}
      {segmentSet.set.kind !== "idle" && (
        <section aria-labelledby="set-title" className="segment-set">
          <h2 className="segment-set-title" id="set-title">
            Segment set
          </h2>
          {segmentSet.set.kind === "checking" && (
            <p className="segment-set-note" role="status">
              Checking every segment of {segmentSet.set.path}…
            </p>
          )}
          {segmentSet.set.kind === "failed" && (
            <p className="report-failed" role="alert">
              {segmentSet.set.detail}
            </p>
          )}
          {segmentSet.set.kind === "found" && (() => {
            const v = segmentSet.set.value;
            const answers = setAnswers(v);
            return (
              <>
                <p className="segment-set-note">
                  manifest <code>{v.manifest_path}</code> · SHA-256 <code>{v.manifest_sha256.slice(0, 16)}…</code>
                </p>
                <p className={answers.consistent.failed ? "report-failed" : "segment-answer"} role="status">
                  {answers.consistent.text}
                </p>
                <p className={answers.complete.failed ? "report-failed" : "segment-answer"}>{answers.complete.text}</p>
                <div className="scroll-x">
                  <table className="segment-table">
                    <thead>
                      <tr>
                        <th scope="col">segment</th>
                        <th scope="col">what the package found</th>
                        <th scope="col">
                          <span className="sr-only">open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.segments.map((seg) => {
                        const st = segmentState(seg);
                        return (
                          <tr data-failed={st.failed ? "" : undefined} key={seg.file}>
                            <td>
                              <code>{seg.file}</code>
                            </td>
                            <td>
                              {st.text}
                              {seg.detail !== null && <span className="segment-detail"> — {seg.detail}</span>}
                            </td>
                            <td>
                              {seg.path !== null && (
                                <button
                                  aria-label={`open ${seg.file} as a chain`}
                                  className="choose-button"
                                  onClick={() => openPathInShell(seg.path!)}
                                  type="button"
                                >
                                  Open
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {v.head !== null && (
                  <p className="segment-set-note">
                    head of the last segment that holds <code>{v.head}</code>
                  </p>
                )}
              </>
            );
          })()}
          <div className="segment-set-actions">
            {(segmentSet.set.kind === "found" || segmentSet.set.kind === "failed") &&
              segmentSet.set.path !== null && (
                <button
                  className="choose-button"
                  onClick={() => {
                    const s = segmentSet.set;
                    if ((s.kind === "found" || s.kind === "failed") && s.path !== null) segmentSet.check(s.path);
                  }}
                  type="button"
                >
                  Check again
                </button>
              )}
            <button className="choose-button" onClick={segmentSet.close} type="button">
              Close the set
            </button>
          </div>
        </section>
      )}

      <div className="verdict">
        <ol aria-live="polite" className="questions" data-live={live}>
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
              {/* U24 (0.14): the violation's code, the field a reader can
                  search for and compare — beside the reason, never in place
                  of it. */}
              {failure.code !== null && (
                <div>
                  <dt>Code</dt>
                  <dd>
                    <code>{failure.code}</code>
                  </dd>
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

            {/* C-13, U17. When the verdict also read a segments manifest, the
                file is named with the digest of the bytes the verifier
                judged — half the evidence's identity. The session stops
                answering if it changes, so the line says that too. */}
            {manifest !== null && (
              <div className="diagnosis-manifest" data-unrecognised={manifest.unrecognised}>
                <p>{manifest.text}</p>
                {manifest.detail !== null && (
                  <p className="diagnosis-manifest-detail">{manifest.detail}</p>
                )}
                {manifest.sha256 !== null && (
                  <p className="diagnosis-manifest-digest">
                    sha256 <code>{manifest.sha256}</code> — this session stops answering if that
                    file changes.
                  </p>
                )}
              </div>
            )}
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
      </div>

      {/* Master and detail side by side on a wide window: the list on the
          left, the selected record on the right, kept in view while the
          list scrolls. On a narrow one they stack, the record after the
          list it was chosen from. */}
      <div className="workspace">
        <div className="workspace-main">
        {/* F8: "SAFETY is a first-class list, not a filter — it is what
            an auditor reads first." Placed ahead of the Chronoscope for
            that reason. The oversight loop is on in full (C-07c): which
            ack, and the ack's own operator and disposition, on the card.
            Detail text and its recurrence count too (C-07b, U12). Grouped
            by kind, on what a SAFETY record already resolves. */}
        {openedOf(chain) !== null && (
          <section className="safety" aria-labelledby="safety-title">
            <h2 className="safety-title" id="safety-title">
              SAFETY
            </h2>

            {safety.kind === "failed" && (
              <p className="safety-failed" role="alert">{safety.detail}</p>
            )}
            {safety.kind === "found" && safety.value.length === 0 && (
              <p className="safety-empty">No SAFETY records in this container.</p>
            )}
            {safety.kind === "found" && safety.value.length > 0 && (
              <>
                <p className="safety-note">
                  Grouped by kind, with detail text and its recurrence
                  count. Open a record for its acknowledgement: which ack,
                  the operator and disposition it recorded, and how long
                  after — by the writer's clock.
                </p>
                <ol className="safety-groups">
                  {safety.value.map((g) => (
                    <li className="safety-group" key={safetyGroupKey(g.kindLabel)}>
                      <p className="safety-group-head">
                        <span className="safety-group-kind">
                          {g.kindLabel.has
                            ? g.kindLabel.named
                              ? g.kindLabel.name
                              : `kind ${g.kindLabel.raw}, unknown`
                            : "no kind"}
                        </span>
                        <span className="safety-group-count">{g.records.length}</span>
                      </p>
                      <ol className="safety-record-list">
                        {g.records.map((r) => (
                          <li key={r.seq}>
                            <button
                              aria-current={r.seq === selectedSeq ? "true" : undefined}
                              className="safety-record"
                              onClick={() => select(r.seq)}
                              type="button"
                            >
                              #{r.seq} · {r.bootId.slice(0, 8)}
                              {r.acknowledged !== null && (
                                <span
                                  className="safety-ack-state"
                                  data-acknowledged={r.acknowledged}
                                >
                                  {r.acknowledged
                                    ? `acknowledged by #${r.acknowledgedBy}`
                                    : "not yet acknowledged"}
                                </span>
                              )}
                              {r.detail !== null && (
                                <span className="safety-detail">
                                  {r.detail}
                                  {r.recurrenceCount !== null && r.recurrenceCount > 1 && (
                                    <span className="safety-recurrence">
                                      ×{r.recurrenceCount}
                                    </span>
                                  )}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        )}

        {rail !== null && (
          <section className="rail" aria-labelledby="rail-title">
            <h2 className="rail-title" id="rail-title">
              Chronoscope
            </h2>

            {/* Permanent, not conditional on the axis toggle. Dates exist
                only in the writer's clock, so there is no proved-order
                version of this view to switch to. */}
            <p className="rail-watermark">
              {rail.basis} · {rail.watermark}
            </p>

            {/* Pinned caps, visible before any interaction (§C-03). Read
                from their own fields rather than from the ends of the list,
                so an empty rail still says what its range is. */}
            <div className="rail-caps">
              <span>{rail.first_date ?? "—"}</span>
              <span>{rail.last_date ?? "—"}</span>
            </div>

            <ol className="rail-days">
              {railRows.map((row) =>
                row.kind === "day" ? (
                  <li
                    className="rail-day"
                    data-empty={row.day.empty}
                    data-selected={daySelected(row.day.date, railRange) ? "" : undefined}
                    data-stepped={row.day.stepped}
                    key={row.day.date}
                  >
                    {/* A day with records is a button: Enter or a click
                        lists that day, Shift adds the range from the last
                        day picked — no dragging needed (WCAG 2.5.7). An
                        empty day stays text: there is nothing to list. */}
                    {row.day.empty ? (
                      <span className="rail-date">{row.day.date}</span>
                    ) : (
                      <button
                        aria-label={`${row.day.date}: ${row.day.count} records by the writer's clock — list them`}
                        aria-pressed={daySelected(row.day.date, railRange)}
                        className="rail-date rail-pick"
                        onClick={(e) => pickDay(row.day.date, e.shiftKey)}
                        type="button"
                      >
                        {row.day.date}
                      </button>
                    )}
                    {/* Zero width for an empty day, deliberately. A visible
                        minimum would make a quiet day read as a busy one. */}
                    <span
                      className="rail-bar"
                      style={{ width: `${(widths.get(row.day.date) ?? 0) * 100}%` }}
                    />
                    {row.day.safety > 0 && (
                      <button
                        aria-label={`${row.day.date}: ${row.day.safety} SAFETY ${row.day.safety === 1 ? "record" : "records"} — list them`}
                        className="rail-safety"
                        onClick={() => pickDay(row.day.date, false, true)}
                        title={`${row.day.safety} SAFETY`}
                        type="button"
                      >
                        ◆
                      </button>
                    )}
                  </li>
                ) : (
                  /* The compression mark. It says how many days it stands in
                     for and which, so a reader knows what was hidden without
                     expanding anything — that is what makes the compression
                     honest rather than merely reversible. */
                  <li className="rail-fold" data-down={row.down} key={`fold-${row.from}`}>
                    {compressionLine(row)}
                  </li>
                ),
              )}
            </ol>

            <ol className="rail-strip">
              {rail.segments.map((segment) => (
                <li
                  className="rail-segment"
                  data-kind={segment.kind}
                  data-backwards={backwards(segment)}
                  key={`${segment.kind}-${segment.from_ns}`}
                >
                  {segment.kind === "boot" ? (
                    <button
                      aria-label={`boot ${segment.boot_id.slice(0, 8)}, records ${segment.first_seq} to ${segment.last_seq} — list them and open the first`}
                      className="rail-pick"
                      onClick={() => pickBoot(segment.boot_id, segment.first_seq)}
                      type="button"
                    >
                      boot {segment.boot_id.slice(0, 8)} · records {segment.first_seq}–{segment.last_seq}
                    </button>
                  ) : (
                    /* No ruler inside a gap: the clock is unverifiable while
                       the writer is down. A negative duration is shown as
                       what it is rather than clamped, because clamping would
                       erase the only evidence the clock went backwards. */
                    <>
                      no ruler · the writer was down
                      {backwards(segment)
                        ? " · the clock moved backwards across this boundary"
                        : ""}
                    </>
                  )}
                </li>
              ))}
            </ol>

            {/* Always present, and empty until pins are read from a file
                (E-06). An absent row would read as "not implemented". */}
            <p className="rail-pins">{rail.pins_note}</p>
            <p className="rail-hint">
              A day lists its records; Shift with a second day, the days between. ◆ lists that day's
              SAFETY records; a boot lists its records and opens the first. Dates are the writer's
              clock.
            </p>
          </section>
        )}

        {/* Shown whenever a chain is open, not when a list happens to be
            non-empty. Hiding the section on an empty list would make "this
            container has no boots" and "the request failed" look identical
            — the distinction useBrowse exists to keep. */}
        {openedOf(chain) !== null && (
          <section className="browse" aria-labelledby="browse-title">
            <h2 className="browse-title" id="browse-title">
              Boots and spans
            </h2>

            {boots.kind === "failed" && (
              /* The sidecar's own sentence. A screen that said only "could
                 not load" would leave a reader unable to tell a refused
                 token from a file that moved. */
              <p className="browse-failed" role="alert">The boot list did not load: {boots.detail}</p>
            )}
            {boots.kind === "loaded" && boots.rows.length === 0 && (
              <p className="browse-empty">No boots in this container.</p>
            )}
            {boots.kind === "loaded" && (
              <ol className="boot-list">
                {boots.rows.map((b) => (
                  <li className="boot" data-recovered={b.recovered_at !== null} key={b.boot_id}>
                    <p className="boot-head">
                      <span className="boot-id">{b.boot_id.slice(0, 8)}</span>
                      <span className="boot-range">
                        records {b.first_seq}–{b.last_seq} · {b.record_count}
                      </span>
                      <span className="boot-clock" data-changed={b.clock_changed}>
                        {b.clocks.join(" → ")}
                      </span>
                    </p>
                    {/* Facts about what happened, never a severity. A
                        recovered tail is the honest marker of a
                        crash-recovered chain, and a chain that recorded its
                        own recovery is behaving better than one that did
                        not. */}
                    {b.notes.map((note) => (
                      <p className="boot-note" key={note}>
                        {note}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            )}

            {spans.kind === "failed" && (
              <p className="browse-failed" role="alert">The span list did not load: {spans.detail}</p>
            )}
            {spans.kind === "loaded" && spans.rows.length === 0 && (
              <p className="browse-empty">No spans in this container.</p>
            )}
            {spans.kind === "loaded" && spans.rows.length > 0 && (
              <ol className="span-list">
                {spans.rows.map((s) => (
                  <li
                    className="span"
                    data-extent={s.extent}
                    data-placement={s.placement.kind}
                    key={s.span_id}
                    style={{ paddingLeft: `calc(var(--step) * ${1 + s.depth * 2})` }}
                  >
                    <p className="span-head">
                      <span className="span-id">{s.span_id.slice(0, 8)}</span>
                      <span className="span-range">
                        {s.start_seq ?? "…"}–{s.end_seq ?? "…"} · {s.record_count} records
                      </span>
                    </p>
                    {/* §F7's wording, carried rather than paraphrased. An
                        unclosed span is an unclosed bracket, not an error. */}
                    <p className="span-note">{s.note}</p>
                    {s.placement.kind === "orphan" && (
                      /* Not a root. Rendering it as one would claim this file
                         holds the whole nesting when it holds a slice, so the
                         absent parent is named for someone to go and find. */
                      <p className="span-orphan">
                        nested inside {s.placement.parent.slice(0, 8)}, which is
                        not in this file
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {/* E-03 — record health (F12): the record as an artefact, never
            its content. Every block names its time basis; nothing here is
            a finding and nothing draws a threshold. */}
        {health.kind !== "unasked" && (
          <section className="health" aria-labelledby="health-title">
            <h2 className="health-title" id="health-title">
              Record health
            </h2>
            <p className="health-note">{HEALTH_NOTE}</p>
            {health.kind === "failed" && (
              <p className="browse-failed" role="alert">
                {health.detail}
              </p>
            )}
            {health.kind === "found" && (
              <>
                <h3 className="health-sub">
                  Boots <span className="health-basis">{BASIS_LABEL.monotonic}</span>
                </h3>
                <ul className="health-list">
                  {health.value.boots.map((b) => (
                    <li key={b.boot}>
                      <code>{b.boot}</code> · {b.records} · {b.uptime}
                      <br />
                      clock: <span data-changed={b.clockChanged ? "" : undefined}>{b.clock}</span>
                      {b.clockChanged && " — changed during the boot"}
                      <br />
                      {b.anchors}
                      <br />
                      {b.spans}
                    </li>
                  ))}
                </ul>
                {health.value.cadence !== null && <p className="health-line">{health.value.cadence}</p>}

                <h3 className="health-sub">
                  The writer's clock <span className="health-basis">{BASIS_LABEL.recorded}</span>
                </h3>
                {health.value.steps.length === 0 && health.value.gaps.length === 0 && (
                  <p className="health-line">No step, regression or slew detected, and no gap between boots.</p>
                )}
                {health.value.steps.length > 0 && (
                  <ul className="health-list">
                    {health.value.steps.map((st) => (
                      <li key={`${st.boot}-${st.seq}`}>
                        <button className="health-jump" onClick={() => select(st.seq)} type="button">
                          #{st.seq}
                        </button>{" "}
                        boot <code>{st.boot}</code>: {st.text}
                      </li>
                    ))}
                  </ul>
                )}
                {health.value.gaps.map((g) => (
                  <p className="health-line" key={g}>
                    {g}
                  </p>
                ))}
                <p className="health-line">{health.value.drift}</p>

                <h3 className="health-sub">
                  Warnings <span className="health-basis">{BASIS_LABEL.proved}</span>
                </h3>
                {health.value.safetyTotal === 0 ? (
                  <p className="health-line">No SAFETY record in this file.</p>
                ) : (
                  <ul className="health-list">
                    {health.value.kinds.map((k) => (
                      <li key={k.kind}>
                        <code>{k.kind}</code> — {k.total} · per boot {k.perBoot}
                      </li>
                    ))}
                  </ul>
                )}
                {health.value.recurring.length > 0 && (
                  <>
                    <p className="health-line">The same detail, more than once — a pattern rather than an episode:</p>
                    <ul className="health-list">
                      {health.value.recurring.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* C-11 — the records list, narrowed by the bar's filter chips
            (C-09b). C-10 chose paging over virtual scroll for it; neither
            could mean anything until a list existed. Rows are
            clickable and drive the same `select` the search bar and the
            origin card's jump already use — one selection mechanism,
            not a second. */}
        {openedOf(chain) !== null && (
          <section className="records" aria-labelledby="records-title">
            <h2 className="records-title" id="records-title">
              Records
            </h2>

            {/* The chips the rows below answer to, always on screen while
                they apply — a filtered list that did not say so would read
                as the whole file. */}
            {activeChips.length > 0 && (
              <div className="records-filters">
                <span className="records-filters-label">filtered by</span>
                {activeChips.map((chip) => (
                  <code className="records-chip" key={chip.key}>
                    {chipLabel(chip)}
                  </code>
                ))}
                <button onClick={clearFilters} type="button">
                  clear
                </button>
              </div>
            )}

            {recordsPage.kind === "failed" && (
              <p className="records-failed" role="alert">{recordsPage.detail}</p>
            )}

            {/* C-09d. Encrypted bodies cannot be searched; the list says how
                many were left unsearched rather than letting "no match"
                stand for "could not look". */}
            {recordsPage.kind === "found" && unsearchedLine(recordsPage.value) !== null && (
              <p className="records-unsearched">{unsearchedLine(recordsPage.value)}</p>
            )}

            {recordsPage.kind === "found" && recordsPage.value.rows.length === 0 && (
              <p className="records-empty">
                {activeChips.length > 0
                  ? "No records in this file match these filters."
                  : "No records match this window."}
              </p>
            )}

            {recordsPage.kind === "found" && recordsPage.value.rows.length > 0 && (
              <>
                <ol className="records-list">
                  {recordsPage.value.rows.map((r) => (
                    <li key={r.seq}>
                      <button
                        aria-current={r.seq === selectedSeq ? "true" : undefined}
                        className="records-row"
                        onClick={() => select(r.seq)}
                        type="button"
                      >
                        <span className="records-seq">#{r.seq}</span>
                        <span className="records-type">
                          {r.typeLabel.named ? r.typeLabel.name : `type ${r.recordType}`}
                        </span>
                        {r.kindLabel.has && (
                          <span className="records-kind">
                            {r.kindLabel.named ? r.kindLabel.name : `kind ${r.kindLabel.raw}`}
                          </span>
                        )}
                        {/* C-12. Marked on the row, not only on the card: a
                            reader skimming the list must not take a call a
                            client reported for one the serve observed.
                            Only the two non-default marks are shown —
                            parsed-from-wire is the profile's baseline, and
                            marking every observed call would bury the one
                            that matters. */}
                        {r.source !== null && r.source.kind !== "wire" && (
                          <span className="records-source" data-source={r.source.kind}>
                            {r.source.kind === "reported" ? "reported" : `source ${r.source.value}?`}
                          </span>
                        )}
                        {/* C-14. Every outcome but ok is marked on the row,
                            for the reason C-12 marks a reported call: ok is
                            the baseline, and a list that marked every
                            return would bury the result that did not
                            return cleanly — or that nobody could see. */}
                        {r.outcome !== null && r.outcome.flagged && (
                          <span className="records-outcome" data-outcome={r.outcome.name ?? "unknown"}>
                            {r.outcome.name ?? `outcome ${r.outcome.value}?`}
                          </span>
                        )}
                        <span className="records-boot">{r.bootId.slice(0, 8)}</span>
                        {/* Ochre — a Recorded claim, the same reason the
                            record card's own Clock line is (L3). */}
                        <span className="records-clock">{r.wallClockIso}</span>
                      </button>
                    </li>
                  ))}
                </ol>

                <div className="records-nav">
                  <button disabled={!recordsCanGoBack} onClick={recordsPrev} type="button">
                    ← previous
                  </button>
                  <span className="records-count">
                    {recordsPage.value.rows.length} of {recordsPage.value.total}
                  </span>
                  <button
                    disabled={!recordsPage.value.hasMore}
                    onClick={recordsNext}
                    type="button"
                  >
                    next →
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        </div>
        <aside className="workspace-detail" aria-label="Selected record">
        {/* The first slice of F9's inspector (C-06). Shown whenever a chain
            is open: looking up a record answers no question about the
            verdict, the same reason browsing does not wait on one either. */}
        {openedOf(chain) !== null && (
          <section className="record" aria-labelledby="record-title">
            <h2 className="record-title" id="record-title">
              Record
            </h2>

            <form className="search-bar" onSubmit={runSearch}>
              <label>
                <span className="search-hint">search</span>
                <input
                  onChange={(e) => setSearchField(e.target.value)}
                  placeholder='#1447  ·  @2026-08-06T22:41Z  ·  kind:INCIDENT_CANDIDATE "frame magic"'
                  ref={searchInput}
                  type="text"
                  value={searchField}
                />
              </label>
              <button type="submit">Go</button>
            </form>
            {searchNote !== null && <p className="search-note" role="status">{searchNote}</p>}
            {/* H6 / H10: the syntax on the screen, not in a reader's memory. */}
            <details className="search-help">
              <summary>search syntax and keys</summary>
              <dl>
                {SEARCH_HELP.map(([form, meaning]) => (
                  <div key={form}>
                    <dt>
                      <code>{form}</code>
                    </dt>
                    <dd>{meaning}</dd>
                  </div>
                ))}
              </dl>
            </details>

            <div className="search-quick">
              <button disabled={visited.length === 0} onClick={back} type="button">
                {visited.length === 0 ? "← back" : `← back to #${visited[visited.length - 1]}`}
              </button>
              <button
                disabled={firstSeq === null}
                onClick={() => firstSeq !== null && select(firstSeq)}
                type="button"
              >
                first record
              </button>
              <button
                disabled={nextWarningSeq === null}
                onClick={() => nextWarningSeq !== null && select(nextWarningSeq)}
                type="button"
              >
                next warning
              </button>
              {/* Dimmed until an anchor answered a verification: before
                  that there is no head to look for. */}
              <button
                disabled={anchoredHead === null}
                onClick={jumpToAnchor}
                title={anchoredHead === null ? "verify against an anchor first" : undefined}
                type="button"
              >
                anchor
              </button>
            </div>

            {/* C-09c. The jump's answer, in ochre — a Recorded statement
                about the writer's clock — with every qualifier beneath it.
                Not a footnote: a caution dropped here is the overclaim. */}
            {jump !== null && (
              <div className="jump-result">
                <p className="jump-line">{jump.text}</p>
                {jump.cautions.map((c) => (
                  <p className="jump-caution" key={c}>
                    {c}
                  </p>
                ))}
              </div>
            )}

            {record.kind === "failed" && (
              /* The sidecar's own sentence — a 404 here means this segment
                 holds no such seq, which is a fact about the file's range,
                 not a broken lookup. */
              <p className="record-failed" role="alert">{record.detail}</p>
            )}

            {record.kind === "found" && (
              <div className="record-card">
                <p className="record-head">
                  <span className="record-seq">#{record.value.seq}</span>
                  {/* Index and seq diverge on a rotated chain (C-06b) —
                      shown side by side rather than picking one, so neither
                      reads as the other. */}
                  <span className="record-index">file position {record.value.index}</span>
                  <span className="record-type">
                    {record.value.typeLabel.named
                      ? record.value.typeLabel.name
                      : `type ${record.value.recordType}, unknown`}
                  </span>
                  {record.value.kindLabel.has && (
                    <span className="record-kind">
                      {record.value.kindLabel.named
                        ? record.value.kindLabel.name
                        : `kind ${record.value.kindLabel.raw}, unknown`}
                    </span>
                  )}
                </p>

                {/* F7's own sentence for a type this build cannot name.
                    Visible, never dropped — an unrecognised record is still
                    chain-checked. */}
                {record.value.note !== null && (
                  <p className="record-note">{record.value.note}</p>
                )}

                <dl className="record-facts">
                  <div>
                    <dt>Boot</dt>
                    <dd>{record.value.bootId.slice(0, 8)}</dd>
                  </div>
                  <div>
                    <dt>Span</dt>
                    <dd>
                      {record.value.spanId === null
                        ? "none"
                        : record.value.spanId.slice(0, 8)}
                    </dd>
                  </div>
                  <div>
                    <dt>Hash</dt>
                    {/* This record's own hash (C-06c, U10) — what a
                        reader jumping in via another record's prevSeq
                        link would compare against. */}
                    <dd>{record.value.recordHash.slice(0, 8)}</dd>
                  </div>
                  <div>
                    <dt>Prev</dt>
                    {/* Three states, not two. null prevHash: GENESIS's
                        own declared zero predecessor. A hash with a null
                        prevSeq: real, but naming something outside this
                        file (a segment boundary) — nothing here to jump
                        to, so still a fact. Both present: prevSeq is
                        already resolved by file position, not seq - 1
                        (see api/record.ts's own module docstring), so
                        the jump reuses the same select(seq) every other
                        jump in this app already uses. */}
                    <dd>
                      {(() => {
                        const { prevHash, prevSeq } = record.value;
                        if (prevHash === null) return "none — GENESIS";
                        if (prevSeq === null) return prevHash.slice(0, 8);
                        return (
                          <button
                            type="button"
                            className="record-jump-link"
                            onClick={() => select(prevSeq)}
                          >
                            {prevHash.slice(0, 8)} → #{prevSeq}
                          </button>
                        );
                      })()}
                    </dd>
                  </div>
                  {record.value.acknowledged !== null && (
                    <div>
                      <dt>Ack</dt>
                      {/* C-07c. The ack is a jump; the latency beside it is
                          the writer's clock subtracted — ochre, Recorded —
                          and withheld across a boot rather than guessed. */}
                      <dd data-acknowledged={record.value.acknowledged}>
                        {(() => {
                          const { acknowledgedBy, ackLatency } = record.value;
                          if (acknowledgedBy === null) return "not yet acknowledged";
                          return (
                            <>
                              <button
                                type="button"
                                className="record-jump-link"
                                onClick={() => select(acknowledgedBy)}
                              >
                                by #{acknowledgedBy}
                              </button>
                              {ackLatency !== null && (
                                <span className="record-ack-latency" data-kind={ackLatency.kind}>
                                  {" "}
                                  · {ackLatency.text}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </dd>
                    </div>
                  )}
                  {record.value.kindLabel.has &&
                    record.value.kindLabel.named &&
                    record.value.kindLabel.name === "OVERSIGHT_ACK" && (
                      <div>
                        <dt>Acknowledges</dt>
                        {/* The package's hash-verified resolution read
                            backwards. An ack whose reference does not
                            verify acknowledges nothing, and says so — the
                            advisory lane names why. */}
                        <dd>
                          {(() => {
                            const target = record.value.acknowledges;
                            if (target === null)
                              return "no candidate it verifiably names — see the advisory lane";
                            return (
                              <button
                                type="button"
                                className="record-jump-link"
                                onClick={() => select(target)}
                              >
                                #{target}
                              </button>
                            );
                          })()}
                        </dd>
                      </div>
                    )}
                  {record.value.operatorId !== null && (
                    <div>
                      <dt>Operator</dt>
                      {/* Pseudonymous by design, and Recorded: the writer
                          chose these bytes. Never resolved to a person. */}
                      <dd className="record-recorded">
                        {record.value.operatorId.slice(0, 16)}… (pseudonymous)
                      </dd>
                    </div>
                  )}
                  {record.value.disposition !== null && (
                    <div>
                      <dt>Disposition</dt>
                      <dd className="record-recorded">
                        {record.value.disposition.name ??
                          `value ${record.value.disposition.value}, unknown`}
                      </dd>
                    </div>
                  )}
                  {record.value.source !== null && (
                    <div>
                      <dt>Source</dt>
                      {/* C-12. The label, then the inference profile's own
                          sentence for it, quoted — what a reader may claim
                          from this record is the profile's statement, and
                          rewording it would make a second, weaker one. */}
                      <dd className="record-source" data-source={record.value.source.kind}>
                        {record.value.source.label}
                        <span className="record-source-note">{record.value.source.note}</span>
                      </dd>
                    </div>
                  )}
                  {record.value.outcome !== null && (
                    <div>
                      <dt>Outcome</dt>
                      {/* C-14. The writer's value, then the profile's
                          sentence for it where it gives one — for ok,
                          that it is a return and never a confirmed
                          effect (note 5). */}
                      <dd className="record-source" data-outcome={record.value.outcome.name ?? "unknown"}>
                        {record.value.outcome.label}
                        {record.value.outcome.note !== null && (
                          <span className="record-source-note">{record.value.outcome.note}</span>
                        )}
                      </dd>
                    </div>
                  )}
                  {record.value.continuation !== null && (
                    <div>
                      <dt>Continues</dt>
                      {/* C-13, r6. What the writer declared at the cut, then
                          the profile's framing of it: a declaration, never
                          evidence of the records it describes. */}
                      <dd className="record-continuation">
                        segment {record.value.continuation.segmentIndex}, retention floor{" "}
                        {record.value.continuation.retention}
                        <span className="record-continuation-field">
                          predecessor head <code>{record.value.continuation.predecessorHead}</code>
                        </span>
                        <span className="record-continuation-field">
                          prior root <code>{record.value.continuation.priorRoot}</code>
                        </span>
                        <span className="record-source-note">{record.value.continuation.note}</span>
                      </dd>
                    </div>
                  )}
                  {(() => {
                    const shredder = record.value.shredded;
                    if (shredder === null) return null;
                    return (
                      <div>
                        <dt>Shredded</dt>
                        <dd>
                          <button
                            type="button"
                            className="record-jump-link"
                            onClick={() => select(shredder)}
                          >
                            by #{shredder}
                          </button>
                        </dd>
                      </div>
                    );
                  })()}
                  {record.value.detail !== null && (
                    <div>
                      <dt>Detail</dt>
                      {/* EVT_DETAIL, decoded generically (C-07b, U12).
                          The recurrence count is F8's own SAFETY-list
                          feature — null outside that scope, so it is
                          shown only when the sidecar actually sent one. */}
                      <dd>
                        {record.value.detail}
                        {record.value.recurrenceCount !== null &&
                          record.value.recurrenceCount > 1 && (
                            <span className="record-recurrence">
                              {" "}
                              ×{record.value.recurrenceCount}
                            </span>
                          )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Tier</dt>
                    <dd>{record.value.assuranceTier.name ?? record.value.assuranceTier.value}</dd>
                  </div>
                  <div>
                    <dt>Clock</dt>
                    {/* Ochre, not verdigris: wall time is a Recorded claim
                        here regardless of what this record's own tier
                        says about the chain as a whole (L3). */}
                    <dd className="record-recorded">
                      {record.value.timeTrust.name ?? record.value.timeTrust.value} ·{" "}
                      {record.value.wallClockIso}
                    </dd>
                  </div>
                </dl>

                {/* Body state, in the four RecordView can actually support.
                    No decoded values yet — that is the hex-view half of
                    C-06 this slice does not build (see api/record.ts). */}
                <p className="record-body" data-state={record.value.body.state}>
                  {record.value.body.state === "none" && "no body"}
                  {record.value.body.state === "opaque" && "body present, opaque — encrypted"}
                  {record.value.body.state === "undecoded" &&
                    "body present, not interpretable by this verifier version"}
                  {record.value.body.state === "cleartext" &&
                    (record.value.body.tlvTypes.length === 0
                      ? "body present, decoded, empty"
                      : `body present, decoded — TLV types ${record.value.body.tlvTypes.join(", ")}`)}
                </p>

                {/* C-06d — the record as the file holds it. Every name and
                    boundary is the package's (api/hexView.ts); a byte no
                    span covers is shown unnamed, never guessed at. */}
                <div className="hex">
                  <button
                    aria-expanded={showBytes}
                    className="hex-toggle"
                    onClick={() => setShowBytes(!showBytes)}
                    type="button"
                  >
                    {showBytes ? "hide bytes" : "bytes"}
                  </button>
                  {showBytes && bytes.kind === "failed" && (
                    <p className="hex-failed" role="alert">{bytes.detail}</p>
                  )}
                  {showBytes && bytes.kind === "found" && (
                    <div className="hex-body" onMouseLeave={() => setHotSegment(null)}>
                      <p className="hex-head">
                        at file offset {bytes.value.fileOffset} · header {bytes.value.headerLen}{" "}
                        bytes, body after it
                      </p>
                      <div className="scroll-x">
                      <table
                        aria-label="The record's bytes in hexadecimal, sixteen to a row; the list after the table names each field and where it starts"
                        className="hex-table"
                      >
                        <tbody>
                          {bytes.value.rows.map((row) => (
                            <tr key={row.at}>
                              <th scope="row">{offsetLabel(row.at)}</th>
                              {row.cells.map((cell) => {
                                const seg =
                                  cell.segment === null ? null : bytes.value.segments[cell.segment];
                                return (
                                  <td
                                    data-body={cell.inBody ? "" : undefined}
                                    data-opens={cell.opens ? "" : undefined}
                                    data-hot={
                                      cell.segment !== null && cell.segment === hotSegment
                                        ? ""
                                        : undefined
                                    }
                                    data-zone={seg?.zone ?? "none"}
                                    key={cell.at}
                                    onMouseEnter={() => setHotSegment(cell.segment)}
                                    title={seg?.label}
                                  >
                                    {cell.hex}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                      {bytes.value.segments.length > 0 && (
                        <ol className="hex-segments">
                          {bytes.value.segments.map((seg) => (
                            <li data-zone={seg.zone} key={seg.id}>
                              {/* A button so the highlight follows the
                                  keyboard as well as the mouse (WCAG 2.1.1);
                                  pressed while its bytes are lit. */}
                              <button
                                aria-pressed={seg.id === hotSegment}
                                data-hot={seg.id === hotSegment ? "" : undefined}
                                onClick={() => setHotSegment(seg.id === hotSegment ? null : seg.id)}
                                onFocus={() => setHotSegment(seg.id)}
                                onMouseEnter={() => setHotSegment(seg.id)}
                                type="button"
                              >
                                <span className="hex-at">{offsetLabel(seg.start)}</span>
                                <span className="hex-len">{seg.end - seg.start} B</span>
                                <span className="hex-name">{seg.label}</span>
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                      {bytes.value.notes.map((n) => (
                        <p className="hex-note" key={n}>
                          {n}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* F9 — origin, rendered for any selected record. Three
                    states, not the two a bare null used to collapse
                    (C-08b, U11) — "not stated" and "unloaded" now each
                    get their own sentence (see api/origin.ts). */}
                <div className="origin">
                  <p className="origin-title">Origin</p>
                  {origin.kind === "failed" && (
                    <p className="origin-failed" role="alert">{origin.detail}</p>
                  )}
                  {origin.kind === "found" && origin.value.state === "not_stated" && (
                    <p className="origin-none">not stated in this file</p>
                  )}
                  {origin.kind === "found" && origin.value.state === "unloaded" && (
                    <p className="origin-none">no model active</p>
                  )}
                  {origin.kind === "found" && origin.value.state === "active" && (
                    <dl className="origin-facts">
                      <div>
                        <dt>Role</dt>
                        <dd>{origin.value.role}</dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        {/* Recorded — OriginModel's own docstring: every
                            field here is the writer's claim, never a proof
                            of what actually ran (L3). */}
                        <dd className="record-recorded">
                          {origin.value.modelDigest.slice(0, 12)}…
                        </dd>
                      </div>
                      <div>
                        <dt>Config</dt>
                        <dd className="record-recorded">
                          {origin.value.configDigest.slice(0, 12)}…
                        </dd>
                      </div>
                      <div>
                        <dt>Since</dt>
                        <dd>
                          {/* The MODEL_LOAD that made this origin active —
                              the same record-jump-link the record card's
                              own prev-hash link uses (C-06c), so the two
                              read as one kind of action. Local const
                              before the closure: TypeScript's narrowing
                              on origin.value's discriminant does not
                              survive into onClick otherwise (confirmed —
                              tried the direct access first). */}
                          {(() => {
                            const sinceSeq = origin.value.sinceSeq;
                            return (
                              <button
                                className="record-jump-link"
                                onClick={() => select(sinceSeq)}
                                type="button"
                              >
                                #{sinceSeq}
                              </button>
                            );
                          })()}
                        </dd>
                      </div>
                      {origin.value.detail !== null && (
                        <div>
                          <dt>Detail</dt>
                          <dd>{origin.value.detail}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
        </aside>
      </div>

      <div className="artifacts">
        <div className="artifacts-stack">
        {/* D-01 — the package's verification report, never rebuilt here.
            Its verdict is the package's derive_verdict, shown with the
            package's own sentence for it; the text is the package's own
            serialisation. Saving to a file is D-07. */}
        {openedOf(chain) !== null && (
          <section className="report" aria-labelledby="report-title">
            <h2 className="report-title" id="report-title">
              Report
            </h2>
            <p className="report-attestation">{ATTESTATION}</p>
            <div className="report-actions">
              <button
                className="choose-button"
                disabled={report.kind === "building"}
                onClick={buildReport}
                type="button"
              >
                {report.kind === "building" ? "Building…" : "Build report"}
              </button>
              <span className="choose-hint">
                against {chosenProfile === "none" ? "no anchor" : `profile ${chosenProfile}`}
              </span>
            </div>

            {report.kind === "failed" && <p className="report-failed" role="alert">{report.detail}</p>}

            {report.kind === "ready" && (
              <div className="report-body" data-verdict={report.view.verdict}>
                <p className="report-verdict">
                  <code>{report.view.verdict}</code> — {report.view.meaning}
                </p>
                <p className="report-meta">
                  {report.view.format}
                  {report.view.checkedAtIso !== null && (
                    <>
                      {" "}
                      · built {report.view.checkedAtIso}
                      {report.view.checkedAtNote !== null && ` (${report.view.checkedAtNote})`}
                    </>
                  )}{" "}
                  · {report.profile === "none" ? "no anchor" : `profile ${report.profile}`}
                </p>
                <details className="report-json">
                  <summary>The report as the package wrote it</summary>
                  <pre>{report.view.jsonText}</pre>
                </details>
                <div className="report-actions">
                  <button
                    className="choose-button"
                    onClick={() => copyReport(report.view.jsonText)}
                    type="button"
                  >
                    {copyState === "copied" ? "Copied" : "Copy JSON"}
                  </button>
                  {copyState === "failed" && (
                    <span className="choose-hint">
                      copying was refused — open the report above and select the text
                    </span>
                  )}
                  <button
                    className="choose-button"
                    disabled={saveState.kind === "saving"}
                    onClick={() => saveReport(report.fileName, report.view.jsonText)}
                    type="button"
                  >
                    {saveState.kind === "saving" ? "Saving…" : "Save JSON…"}
                  </button>
                </div>
                {/* D-01b — the package's own HTML page for the same report,
                    never rebuilt here. Shown in a sandboxed frame with no
                    permissions at all: the page has no script and reaches
                    nothing, and the frame would not let it if it did. */}
                <div className="report-actions">
                  <button
                    className="choose-button"
                    onClick={() => setShowHtml((v) => !v)}
                    type="button"
                  >
                    {showHtml ? "Hide HTML" : "Show HTML"}
                  </button>
                  <button
                    className="choose-button"
                    disabled={saveState.kind === "saving"}
                    onClick={() => saveReport(report.htmlFileName, report.view.htmlText)}
                    type="button"
                  >
                    Save HTML…
                  </button>
                  <button
                    className="choose-button"
                    onClick={() => printPage(report.view.htmlText)}
                    type="button"
                  >
                    Print…
                  </button>
                </div>
                {printState.kind === "opened" && <p className="report-saved" role="status">{PRINT_OPENED}</p>}
                {printState.kind === "failed" && <p className="report-failed" role="alert">{printState.detail}</p>}
                {showHtml && (
                  <iframe
                    className="report-html"
                    sandbox=""
                    srcDoc={report.view.htmlText}
                    title="The report as the package rendered it"
                  />
                )}
                {/* D-07. Where it went and its digest, written beside it —
                    the shell chose the place with the user, never this page. */}
                {saveState.kind === "saved" && <p className="report-saved" role="status">{saveState.line}</p>}
                {saveState.kind === "failed" && <p className="report-failed" role="alert">{saveState.detail}</p>}
              </div>
            )}
          </section>
        )}

        {/* D-06 — the package's record export, streamed by the shell
            straight into the file the user chooses: it never passes through
            this page, which only names the session and the range. */}
        {openedOf(chain) !== null && (
          <section className="export" aria-labelledby="export-title">
            <h2 className="export-title" id="export-title">
              Export
            </h2>
            <p className="export-note">{EXPORT_NOTE}</p>
            <div className="export-range">
              <label>
                <span className="choose-hint">from #</span>
                <input
                  aria-describedby={typedRange.kind === "refused" ? "export-range-note" : undefined}
                  aria-invalid={typedRange.kind === "refused"}
                  inputMode="numeric"
                  onChange={(e) => setExportFrom(e.target.value)}
                  placeholder="first"
                  type="text"
                  value={exportFrom}
                />
              </label>
              <label>
                <span className="choose-hint">to #</span>
                <input
                  aria-describedby={typedRange.kind === "refused" ? "export-range-note" : undefined}
                  aria-invalid={typedRange.kind === "refused"}
                  inputMode="numeric"
                  onChange={(e) => setExportTo(e.target.value)}
                  placeholder="last"
                  type="text"
                  value={exportTo}
                />
              </label>
              <button
                className="choose-button"
                disabled={exportState.kind === "exporting" || typedRange.kind === "refused"}
                onClick={runExport}
                type="button"
              >
                {exportState.kind === "exporting" ? "Exporting…" : "Export JSONL…"}
              </button>
            </div>
            {typedRange.kind === "refused" && (
              <p className="export-range-note" id="export-range-note">
                Not exported as typed: {typedRange.reason}.
              </p>
            )}
            {exportState.kind === "saved" && (
              <>
                <p className="report-saved">{exportState.line}</p>
                {/* T3. What the export's own summary says about the file. A
                    file that is not consistent is ruled in ochre, the colour
                    of a finding about evidence — never red, and never a
                    refusal: the export was saved. */}
                <p
                  className={exportState.summary.consistent === false ? "report-failed" : "report-saved"}
                  data-consistent={String(exportState.summary.consistent)}
                >
                  {exportState.summary.text}
                </p>
              </>
            )}
            {exportState.kind === "failed" && <p className="report-failed" role="alert">{exportState.detail}</p>}
          </section>
        )}
        </div>

        {/* E-05 — this desk's own record of the checks it ran. Not a
            PALA-1 chain and not about any one file (ADR-0003); what it
            shows and what it does not are said together, always. */}
        {witness.kind !== "unasked" && (
          <section className="witness" aria-labelledby="witness-title">
            <h2 className="witness-title" id="witness-title">
              Witness log
            </h2>
            {thisCheck !== null && (
              <p className={thisCheck.failed ? "report-failed" : "report-saved"} role="status">
                {thisCheck.text}
              </p>
            )}
            {witness.kind === "failed" && <p className="report-failed" role="alert">{witness.detail}</p>}
            {witness.kind === "found" && (() => {
              const status = witnessStatus(witness.value);
              const rows = witnessRows(witness.value.tail);
              return (
                <>
                  <p className={status.failed ? "report-failed" : "witness-status"}>{status.text}</p>
                  {witness.value.head !== null && (
                    <p className="witness-head">
                      head <code>{witness.value.head}</code>
                    </p>
                  )}
                  <p className="witness-path">
                    kept at <code>{witness.value.path}</code> ({witness.value.format})
                  </p>
                  {rows.length > 0 && (
                    <div className="scroll-x">
                    <table className="witness-table">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">when (this machine's clock)</th>
                          <th scope="col">file</th>
                          <th scope="col">head seen</th>
                          <th scope="col">against</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.n}>
                            <td>{r.n}</td>
                            <td>{r.when}</td>
                            <td>{r.file}</td>
                            <td>
                              <code>{r.head}</code>
                            </td>
                            <td>{r.against}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </>
              );
            })()}
            <p className="witness-note">{WITNESS_LIMITS}</p>
          </section>
        )}
      </div>

      <footer className="colophon">
        <p className="footnote">{footnoteFor(probe, chain)}</p>
        {/* For whoever runs the build, not for the audit: what is wired to
            what. Folded away so it no longer stands between the reader and
            the first thing they came to do. */}
        <details className="status-details">
          <summary>What is wired</summary>
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
        </details>
      </footer>
    </main>
  );
}
