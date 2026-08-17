// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The boot screen.
 *
 * Deliberately static. It does NOT call the sidecar yet: the frontend has no
 * way to obtain the per-launch session token until the shell hands it over
 * (A-06), and the cross-origin question — a webview on `tauri://localhost`
 * calling `http://127.0.0.1:8771` — is a security decision that belongs in
 * that pull request rather than being settled here by adding a permissive
 * CORS policy to get a status dot to turn green.
 *
 * So the screen states the product's three questions and reports honestly
 * which parts of the application are wired. An empty screen is an invitation
 * to act; a spinner over nothing is a lie with a loading indicator.
 */

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

interface Component {
  name: string;
  state: string;
  live: boolean;
}

const COMPONENTS: Component[] = [
  { name: "verifier seam", state: "wired", live: true },
  { name: "sidecar service", state: "wired", live: true },
  { name: "desktop shell", state: "wired", live: true },
  { name: "sidecar lifecycle", state: "A-06", live: false },
  { name: "typed api client", state: "A-07", live: false },
  { name: "open and verify", state: "phase 1", live: false },
];

export default function App() {
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
            {COMPONENTS.map((c) => (
              <li className="status-row" key={c.name}>
                <span>{c.name}</span>
                <span className="status-state" data-live={c.live}>
                  {c.state}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="footnote">
          No chain can be opened yet. Nothing on this screen is a verification
          result.
        </p>
      </div>
    </main>
  );
}
