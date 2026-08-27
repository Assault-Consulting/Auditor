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

import { useState } from "react";

import { advisoryGroups, advisoryLine } from "./api/advisory";
import { choiceLine, footnoteFor, panelsFor, rowsFor } from "./api/bootScreen";
import { chainLine, openedOf } from "./api/chainState";
import { backwards, compress, compressionLine, density } from "./api/chronoscope";
import { diagnosisCard } from "./api/diagnosis";
import { provenance, provenanceSummary } from "./api/provenance";
import { useBrowse, useChain, useProbe, useProfiles, useRail } from "./state";

export default function App() {
  const probe = useProbe();
  const profiles = useProfiles(probe);
  const [chosenProfile, setChosenProfile] = useState("none");
  const [chain, choice, pick, verify] = useChain(probe);
  const rail = useRail(probe, chain);
  const { boots, spans } = useBrowse(probe, chain);
  const rows = rowsFor(probe, chain, rail, { boots, spans });
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

            {/* Always present, and at tier A always empty. An absent row
                would read as "not implemented". */}
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
