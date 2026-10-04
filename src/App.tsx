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

import { type FormEvent, useEffect, useState } from "react";

import { advisoryGroups, advisoryLine } from "./api/advisory";
import { choiceLine, footnoteFor, panelsFor, rowsFor } from "./api/bootScreen";
import { chainLine, openedOf } from "./api/chainState";
import { backwards, compress, compressionLine, density } from "./api/chronoscope";
import { diagnosisCard } from "./api/diagnosis";
import { provenance, provenanceSummary } from "./api/provenance";
import { type RecordFilters, resolveChips } from "./api/filters";
import { getNearest, getRecords } from "./api/chain";
import { type NearestLine, nearestLine } from "./api/nearest";
import { type Chip, chipLabel, nextWarning, parseSearch } from "./api/search";
import { safetyGroupKey } from "./api/safety";
import { useBrowse, useChain, useOrigin, useProbe, useProfiles, useRail, useRecord, useRecords, useSafety } from "./state";

// C-11's page size. Well inside the sidecar's own 1000-record ceiling, and
// small enough that a page reads as a page rather than a scroll.
const RECORDS_PAGE_SIZE = 50;

export default function App() {
  const probe = useProbe();
  const profiles = useProfiles(probe);
  const [chosenProfile, setChosenProfile] = useState("none");
  const [chain, choice, pick, verify] = useChain(probe);
  const rail = useRail(probe, chain);
  const { boots, spans } = useBrowse(probe, chain);
  const safety = useSafety(probe, chain);
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
  const { record, select } = useRecord(probe, chain);
  // Kept in lockstep with the record card rather than driven separately —
  // origin is F9's card "on any selected record", and next-warning below
  // reads the same seq for the same reason: both are about whichever
  // record is on screen, not a second selection of their own.
  const selectedSeq = record.kind === "found" ? record.value.seq : null;
  const origin = useOrigin(probe, chain, selectedSeq);
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
    const resolved = resolveChips(outcome.chips, {
      boots: boots.kind === "loaded" ? boots.rows.map((b) => b.boot_id) : null,
      spans: spans.kind === "loaded" ? spans.rows.map((s) => s.span_id) : null,
    });
    if (resolved.kind === "refused") {
      setSearchNote(resolved.reason);
      return;
    }
    setSearchNote(null);
    setActiveChips(outcome.chips);
    setRecordFilters(resolved.filters);
  };

  const clearFilters = () => {
    setActiveChips([]);
    setRecordFilters({});
  };

  // Present only when the verifier produced a diagnosis, which is only when
  // something failed.
  const failure = chain.kind === "verified" ? diagnosisCard(chain.result.diagnosis) : null;

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
          {/* Disabled while opening — not decorative. §19 targets a
              100 MB / ~1M-record chain, and open_chain's own correctness
              check (confirming the file is not empty) has no cheap way
              to answer without walking every record (measured: ~24 s of
              wall time on a chain that size, tracked as U14). A second
              click mid-open would start a second concurrent open rather
              than do anything useful with the wait. */}
          <button
            className="choose-button"
            disabled={chain.kind === "opening"}
            onClick={pick}
            type="button"
          >
            {chain.kind === "opening" ? "Opening…" : "Open a chain…"}
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
              <p className="safety-failed">{safety.detail}</p>
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
                    data-stepped={row.day.stepped}
                    key={row.day.date}
                  >
                    <span className="rail-date">{row.day.date}</span>
                    {/* Zero width for an empty day, deliberately. A visible
                        minimum would make a quiet day read as a busy one. */}
                    <span
                      className="rail-bar"
                      style={{ width: `${(widths.get(row.day.date) ?? 0) * 100}%` }}
                    />
                    {row.day.safety > 0 && (
                      <span className="rail-safety" title={`${row.day.safety} SAFETY`}>
                        ◆
                      </span>
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
                    <>
                      boot {segment.boot_id.slice(0, 8)} · records{" "}
                      {segment.first_seq}–{segment.last_seq}
                    </>
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
              <p className="browse-failed">The boot list did not load: {boots.detail}</p>
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
              <p className="browse-failed">The span list did not load: {spans.detail}</p>
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
              <p className="records-failed">{recordsPage.detail}</p>
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
                  placeholder="#1447  ·  @2026-08-06T22:41Z  ·  kind:INCIDENT_CANDIDATE from:2026-08-06"
                  type="text"
                  value={searchField}
                />
              </label>
              <button type="submit">Go</button>
            </form>
            {searchNote !== null && <p className="search-note">{searchNote}</p>}

            <div className="search-quick">
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
              <p className="record-failed">{record.detail}</p>
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

                {/* F9 — origin, rendered for any selected record. Three
                    states, not the two a bare null used to collapse
                    (C-08b, U11) — "not stated" and "unloaded" now each
                    get their own sentence (see api/origin.ts). */}
                <div className="origin">
                  <p className="origin-title">Origin</p>
                  {origin.kind === "failed" && (
                    <p className="origin-failed">{origin.detail}</p>
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
