// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The anchor profiles panel (E-08): make, change and delete the profiles
 * question two is checked against.
 *
 * Everything here is about where to look for a head, never about what one
 * means. The order of sources is the user's, and is shown as they will be
 * asked. A profile is saved whole, or refused whole with the sidecar's
 * reason.
 */

import { useEffect, useId, useState } from "react";

import {
  SOURCE_KINDS,
  cleanSource,
  deleteProfile,
  getKeychain,
  getStore,
  nameProblem,
  pickAnchorPath,
  saveProfile,
  sourceLine,
  sourceProblem,
  storeKeychainHead,
} from "./api/anchors";
import type { AnchorProfile, AnchorSourceSpec, AnchorStore, KeychainStatus } from "./api/generated/types";
import type { Session } from "./api/session";
import { t } from "./i18n";

interface Props {
  session: Session;
  profiles: AnchorProfile[];
  /** Read the list again after a change. */
  reload: () => void;
  /** A profile was saved: offer it in the chooser. */
  onSaved: (name: string) => void;
  /** A profile was deleted: stop offering it. */
  onDeleted: (name: string) => void;
  onClose: () => void;
}

interface Draft {
  /** The name being edited, or null for a new profile. */
  editing: string | null;
  name: string;
  sources: AnchorSourceSpec[];
}

const NEW_SOURCE: AnchorSourceSpec = { kind: "file", path: "" };

export function AnchorProfiles({ session, profiles, reload, onSaved, onDeleted, onClose }: Props) {
  const [store, setStore] = useState<AnchorStore | null>(null);
  const [keychain, setKeychain] = useState<KeychainStatus | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getStore(session)
      .then((s) => !cancelled && setStore(s))
      .catch(() => undefined);
    void getKeychain(session)
      .then((k) => !cancelled && setKeychain(k))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);

  const own = profiles.filter((p) => p.name !== "none");
  const locked = store?.problem != null;

  const save = () => {
    if (draft === null) return;
    const name = draft.name.trim();
    const problem =
      nameProblem(name, own.map((p) => p.name), draft.editing) ??
      (draft.sources.length === 0 ? t("anchors.need.source") : null) ??
      draft.sources.map(sourceProblem).find((p) => p !== null) ??
      null;
    if (problem !== null) {
      setMessage({ text: problem, failed: true });
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        await saveProfile(session, name, draft.sources.map(cleanSource));
        // Renamed: the old name goes, so one profile does not become two.
        if (draft.editing !== null && draft.editing !== name) await deleteProfile(session, draft.editing);
        setDraft(null);
        setMessage({ text: t("anchors.saved", { name }), failed: false });
        reload();
        onSaved(name);
      } catch (e) {
        setMessage({ text: t("anchors.not_saved", { reason: (e as Error).message }), failed: true });
      } finally {
        setBusy(false);
      }
    })();
  };

  const remove = (name: string) => {
    setBusy(true);
    void deleteProfile(session, name)
      .then(() => {
        setMessage({ text: t("anchors.deleted", { name }), failed: false });
        reload();
        onDeleted(name);
        if (draft?.editing === name) setDraft(null);
      })
      .catch((e: Error) => setMessage({ text: t("anchors.not_deleted", { reason: e.message }), failed: true }))
      .finally(() => setBusy(false));
  };

  return (
    <section className="anchors" aria-labelledby="anchors-title">
      <h2 className="witness-title" id="anchors-title">
        {t("anchors.title")}
      </h2>
      <p className="witness-note">{t("anchors.note")}</p>
      {store !== null && store.path !== null && (
        <p className="witness-path">
          {t("anchors.kept_at")} <code>{store.path}</code>
        </p>
      )}
      {locked && (
        <p className="report-failed" role="alert">
          {store!.problem}
        </p>
      )}
      {message !== null && (
        <p className={message.failed ? "report-failed" : "report-saved"} role={message.failed ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {own.length === 0 ? (
        <p className="witness-note">{t("anchors.none_yet")}</p>
      ) : (
        <ul className="anchors-list">
          {own.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong>
              <ol className="anchors-sources">
                {p.sources.map((s, i) => (
                  <li key={i}>
                    {sourceLine(s)}
                    {s.detail ? ` — ${s.detail}` : ""}
                  </li>
                ))}
              </ol>
              <button
                className="choose-button"
                disabled={busy || locked}
                onClick={() => {
                  setMessage(null);
                  setDraft({ editing: p.name, name: p.name, sources: p.sources.map((s) => ({ ...s })) });
                }}
                type="button"
              >
                {t("anchors.edit")}
              </button>{" "}
              <button
                className="choose-button"
                disabled={busy || locked}
                onClick={() => remove(p.name)}
                type="button"
                aria-label={t("anchors.delete_label", { name: p.name })}
              >
                {t("anchors.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft === null ? (
        <p className="anchors-actions">
          <button
            className="choose-button"
            disabled={busy || locked}
            onClick={() => {
              setMessage(null);
              setDraft({ editing: null, name: "", sources: [{ ...NEW_SOURCE }] });
            }}
            type="button"
          >
            {t("anchors.new")}
          </button>{" "}
          <button className="choose-button" onClick={onClose} type="button">
            {t("app.close")}
          </button>
        </p>
      ) : (
        <Editor
          busy={busy}
          draft={draft}
          keychain={keychain}
          onCancel={() => {
            setDraft(null);
            setMessage(null);
          }}
          onChange={setDraft}
          onSave={save}
          onStored={(text, failed) => setMessage({ text, failed })}
          session={session}
        />
      )}
    </section>
  );
}

interface EditorProps {
  session: Session;
  draft: Draft;
  keychain: KeychainStatus | null;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onStored: (text: string, failed: boolean) => void;
}

function Editor({ session, draft, keychain, busy, onChange, onSave, onCancel, onStored }: EditorProps) {
  const id = useId();
  const setSource = (i: number, patch: Partial<AnchorSourceSpec>) =>
    onChange({ ...draft, sources: draft.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...draft.sources];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    onChange({ ...draft, sources: next });
  };

  return (
    <form
      className="anchors-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <h3 className="health-sub">{draft.editing === null ? t("anchors.new_title") : t("anchors.edit_title", { name: draft.editing })}</h3>
      <label className="anchors-field">
        <span>{t("anchors.name")}</span>
        <input
          maxLength={64}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          required
          value={draft.name}
        />
      </label>
      <p className="witness-note">{t("anchors.order")}</p>
      <ol className="anchors-sources">
        {draft.sources.map((s, i) => (
          <li className="anchors-source" key={i}>
            <fieldset>
              <legend>{t("anchors.source_n", { n: i + 1 })}</legend>
              <label className="anchors-field">
                <span>{t("anchors.kind")}</span>
                <select onChange={(e) => setSource(i, { kind: e.target.value })} value={s.kind}>
                  {SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`anchors.kind.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="witness-note">{t(`anchors.kind.${s.kind}.note`)}</p>
              {s.kind === "file" && (
                <PathField
                  label={t("anchors.field.path")}
                  onChange={(path) => setSource(i, { path })}
                  pick={() => pickAnchorPath("file")}
                  value={s.path ?? ""}
                />
              )}
              {s.kind === "keychain" && (
                <>
                  <TextField label={t("anchors.field.account")} onChange={(account) => setSource(i, { account })} value={s.account ?? ""} />
                  {keychain !== null && (
                    <p className={keychain.available ? "witness-note" : "report-failed"}>
                      {keychain.available ? t("anchors.keychain.available") : keychain.detail}
                    </p>
                  )}
                  {keychain?.available && <KeychainSeed account={s.account ?? ""} onStored={onStored} session={session} />}
                </>
              )}
              {s.kind === "manual" && (
                <TextField
                  label={t("anchors.field.head")}
                  mono
                  onChange={(head) => setSource(i, { head })}
                  value={s.head ?? ""}
                />
              )}
              {s.kind === "pkcs11" && (
                <>
                  <PathField
                    label={t("anchors.field.module")}
                    onChange={(module_path) => setSource(i, { module_path })}
                    pick={() => pickAnchorPath("pkcs11")}
                    value={s.module_path ?? ""}
                  />
                  <TextField label={t("anchors.field.token")} onChange={(token_label) => setSource(i, { token_label })} value={s.token_label ?? ""} />
                  <TextField
                    label={t("anchors.field.object")}
                    onChange={(object_label) => setSource(i, { object_label })}
                    placeholder="pala-anchor-head"
                    value={s.object_label ?? ""}
                  />
                  <TextField label={t("anchors.field.pin_account")} onChange={(pin_account) => setSource(i, { pin_account })} value={s.pin_account ?? ""} />
                </>
              )}
              <TextField label={t("anchors.field.detail")} onChange={(detail) => setSource(i, { detail })} value={s.detail ?? ""} />
              <p className="anchors-actions">
                <button className="choose-button" disabled={i === 0} onClick={() => move(i, -1)} type="button" aria-label={t("anchors.up_label", { n: i + 1 })}>
                  ↑
                </button>{" "}
                <button
                  className="choose-button"
                  disabled={i === draft.sources.length - 1}
                  onClick={() => move(i, 1)}
                  type="button"
                  aria-label={t("anchors.down_label", { n: i + 1 })}
                >
                  ↓
                </button>{" "}
                <button
                  className="choose-button"
                  onClick={() => onChange({ ...draft, sources: draft.sources.filter((_, j) => j !== i) })}
                  type="button"
                  aria-label={t("anchors.remove_label", { n: i + 1 })}
                >
                  {t("anchors.remove")}
                </button>
              </p>
            </fieldset>
          </li>
        ))}
      </ol>
      <p className="anchors-actions" id={`${id}-actions`}>
        <button
          className="choose-button"
          onClick={() => onChange({ ...draft, sources: [...draft.sources, { ...NEW_SOURCE }] })}
          type="button"
        >
          {t("anchors.add_source")}
        </button>{" "}
        <button className="choose-button" disabled={busy} type="submit">
          {busy ? t("app.saving") : t("anchors.save")}
        </button>{" "}
        <button className="choose-button" onClick={onCancel} type="button">
          {t("anchors.cancel")}
        </button>
      </p>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="anchors-field">
      <span>{label}</span>
      <input
        className={mono ? "anchors-mono" : undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
      />
    </label>
  );
}

function PathField({
  label,
  value,
  onChange,
  pick,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  pick: () => Promise<string | null>;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <label className="anchors-field">
        <span>{label}</span>
        <input className="anchors-mono" onChange={(e) => onChange(e.target.value)} spellCheck={false} value={value} />
      </label>
      <button
        className="choose-button"
        onClick={() => {
          setProblem(null);
          void pick()
            .then((path) => path !== null && onChange(path))
            .catch(() => setProblem(t("state.no_shell")));
        }}
        type="button"
      >
        {t("anchors.choose")}
      </button>
      {problem !== null && <p className="report-failed">{problem}</p>}
    </>
  );
}

/** Put a head into this machine's secret store, under the source's account. */
function KeychainSeed({
  session,
  account,
  onStored,
}: {
  session: Session;
  account: string;
  onStored: (text: string, failed: boolean) => void;
}) {
  const [head, setHead] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="anchors-seed">
      <p className="witness-note">{t("anchors.keychain.seed_note")}</p>
      <TextField label={t("anchors.field.head")} mono onChange={setHead} value={head} />
      <button
        className="choose-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void storeKeychainHead(session, account, head)
            .then(() => {
              setHead("");
              onStored(t("anchors.keychain.stored", { account: account.trim() }), false);
            })
            .catch((e: Error) => onStored(t("anchors.keychain.not_stored", { reason: e.message }), true))
            .finally(() => setBusy(false));
        }}
        type="button"
      >
        {t("anchors.keychain.store")}
      </button>
    </div>
  );
}
