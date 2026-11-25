<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Usability and accessibility review — 16 November 2026

A heuristic evaluation (Nielsen's ten) and a WCAG 2.2 AA check of the
screen as built at `main` @ `a85b656`, and what was changed for it.

## Method

The frontend ran in headless Chromium against a live sidecar (palimpsests
0.14.1), Tauri IPC stubbed, at 1300×900 — about the shell's default
1280-pixel window. Two files: the published inference vectors (21 records)
and a chain with one body altered after writing. At each step — start, a
chain open, checked — axe-core 4.10 ran the `wcag2a`, `wcag2aa`,
`wcag21aa`, `wcag22aa` and `best-practice` rules; sixty Tab presses were
recorded with the focus ring; every target's size, every text's size, and
reflow at narrow widths were measured.

**Not covered:** a real screen reader (NVDA, VoiceOver), the shell's
native windows (file and print dialogs), and users.

Severity: 4 catastrophe, 3 major, 2 minor, 1 cosmetic.

## Found, and what was done

| Where | Finding | Sev. | Now |
|---|---|---|---|
| H1 | **Open a chain…** began at y = 1014 in a 900-pixel window: the first action below the fold | 3 | The masthead holds the actions; the button is at y = 122 |
| H1 | A click on a record row opened the card below the viewport, and the row showed no selection | 3 | Master and detail side by side from 1100 px, the card sticky; the row carries `aria-current` and a rule |
| H1 | A long open or check said "Checking…" and nothing more | 2 | The button counts seconds after two; no fraction is claimed, the sidecar gives none |
| H8 | "What is wired", a build panel, stood above the first action; one 62ch column used under half of a 1280 window; ~3,500 px of scroll | 3 | Folded into the footer; the page uses the window, prose keeps a 78ch measure |
| H2 | `Checked against "none"`, `1 boots`, `0 configured` | 2 | "Checked without an anchor", counts in the singular, "1 anchor source" |
| H4 | Search and the record card sat below the list they act on; the advisory lane had no frame | 2 | Both in the detail column; advisory framed like its neighbours |
| H5 | The export range was refused only after the button | 2 | Read as typed: `aria-invalid`, the reason under the fields, the button disabled |
| H6, H10 | The search syntax was a truncated placeholder | 2 | "search syntax and keys" under the bar, every form listed; a test parses each |
| H7 | No keys | 2 | `/` search, `j` / `k` next and previous row, `n` next warning, `b` back — never in a field, never with a modifier |
| H3 | No way back to the record read before | 2 | **← back to #n**, twenty deep, cleared with the file |
| 1.4.3 | `--unchecked` #6b7683: 4.03:1 on the page, 3.73:1 on panels — 83 elements, the colour of "not checked" | 3 | #838e9b: 5.59:1 and 5.19:1 |
| 4.1.3 | No live region: neither the answers, "Opening…", "Saved" nor an error reached a screen reader | 3 | The file line is `role="status"`, the questions `aria-live="polite"`, every failure `role="alert"`, saves and notes `role="status"` |
| 4.1.2 | The selected record was not exposed | 2 | `aria-current="true"` |
| 2.5.8 | SAFETY rows 19 px tall | 2 | Every target of its own ≥ 24 px; the frequent ones 28 px |
| 2.1.1 | The bytes view's field highlight followed the mouse only; names only in `title` | 2 | The field list is buttons: focus or click lights the bytes; the table is labelled and points at the list |
| 1.4.10 | 690 px of content at 320 px | 2 | No horizontal page scroll at 480 px (the 960-px window at 200 %); wide tables scroll in their panel |
| 1.4.4 | Labels at 11.2–11.8 px | 1 | 12 px floor |

## Re-checked after

axe-core: **0 violations** at all three steps (was 18, 80, 83). No target
under 24 px, no text under 12 px, no horizontal scroll at 480 or 960 px.
In the browser: the card stays in view after a row is clicked; `j`, `j`,
`b` steps to #6 and back to #5.

## Left open

- **A real screen reader pass** — the live regions are in place; how they
  read is for NVDA and VoiceOver to say.
- ~~**H7, the Chronoscope.**~~ Done 18 Nov 2026: a day, a range (Shift), a
  SAFETY mark and a boot are buttons that narrow the list through the bar's
  own chips; no dragging, so WCAG 2.5.7 has nothing to ask.
- ~~**H3, closing a file**~~ Done 25 Nov 2026: **Close the chain** beside
  **Verify** closes the session and returns to the empty screen. It is not
  offered while an open or a check is in flight, which would overwrite it.
- **H2, the package's names** — `GENESIS`, `UNSYNCED`, `INCIDENT_CANDIDATE` —
  stay as the package spells them, by design: a translated name could drift
  from what the verifier said (§19).
- ~~**1.3.1**~~ Done 25 Nov 2026: panels have `h2`, their parts `h3`
  (record health's groups, the export's bundle, proof and statement, the
  diagnosis card's "where to look"), and record health's recurring details
  an `h4`.
