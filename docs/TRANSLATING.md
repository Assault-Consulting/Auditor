# Translating Auditor (L-05)

Adding a language is two files and no code. How the system works is in
[`I18N.md`](I18N.md); this page is for the person writing a translation.

## The two files

1. **The catalog, `src/i18n/locales/<tag>.json`.** Copy `en.json` and
   translate the values. `<tag>` is a BCP 47 tag (`uk`, `de`, `pt-BR`).
   - Do not change a key, and do not rename, drop or add a placeholder
     (`{records}`, `{seq}`).
   - Set `meta.name` to the language's name in that language
     (`Українська`), and `meta.dir` to `ltr` or `rtl`.
   - Give every plural entry each form your language needs. Ukrainian needs
     `one`, `few`, `many` and `other`; the test names any form that is
     missing or extra.
2. **The word lists, `src/i18n/wording/<tag>.json`.** These are the wording
   audit's rules (D-03) in your language:
   - `intent`: words that say why something happened (tampered, forged,
     attacked);
   - `certifying`: words that certify (verified, valid, compliant, proven);
   - `allowed`: the few sentences that may use a certifying word, each with
     its reason. These are negations, such as "It certifies nothing".

   Write each entry as a stem with the endings your language needs, for
   example `підроб\p{L}*`. The test bounds each one at letters on both sides,
   so a stem never matches inside a longer word. A catalog with no word
   lists fails the test.

Then run `npm test`. The checks name the key that fails:
- `i18n.test.ts`: keys, placeholders and plural forms;
- `wording.test.ts`: the word lists, against every value in your catalog;
- `shell.test.ts`: the native dialogs' labels (`shell.*`), each one short
  line.

The picker in the masthead appears once there are two languages. A user's
system language picks the catalog by itself (`uk-UA` finds `uk`).

## What a translation must not do

- **Change a claim.** "Not checked" is not "failed"; "complete to the head
  held by X" is not "complete". Where English is careful, be careful in the
  same place. If a sentence cannot be said in your language without saying
  more, say less.
- **Translate the package's words.** Kind and type names (`GENESIS`,
  `INCIDENT_CANDIDATE`), codes, `UNSYNCED`, the verifier's narratives and the
  package's notes come from the package. They are shown as it wrote them, even
  inside a translated sentence (L-03). So a Ukrainian screen may show an
  English clause from the package, and that is correct.
- **Touch what is quoted.** Hashes, seq numbers, paths, `sha256sum -c`, the
  search syntax (`kind:`, `@2026-08-06T22:41Z`, `"frame magic"`).

## Placeholders that hold a phrase

Some placeholders hold a whole phrase: `{records}` is "3 records", already
pluralised, and `{from}` is "file — /path/anchor.json". In a language with
cases, the phrase arrives in the nominative, so put it where the nominative
reads well:
- as the subject;
- after a colon;
- in parentheses.

For example, `"Перевірено досі {records}; …"` gives "Перевірено досі 3
записи", and `"над першими записами ({count})"` keeps "3 записи" whole. Do
not build a sentence that needs the phrase in another case: the code cannot
decline it.

`{n}` is a bare number, formatted by the platform for your language (`3,8`
in Ukrainian). Seq numbers (`#{seq}`) are not formatted: they are
identifiers.

## Glossary

These terms are fixed. A term means one thing everywhere it appears, so a
reader who learns it on one panel can rely on it on the next.

| English | Українська | Note |
|---|---|---|
| chain, audit chain | ланцюжок, ланцюжок аудиту | |
| record | запис | |
| boot | запуск | a run of the writer between starts |
| span | спан | a traced operation; not "інтервал", which reads as time |
| segment, segment set | сегмент, набір сегментів | |
| head | голова | the chain's last record hash, as anchored |
| anchor, anchored | якір, заякорений | |
| anchor profile, anchor source | профіль якоря, джерело якоря | |
| witness, witness log | свідок, журнал свідка | |
| verifier | верифікатор | the package's checker; a noun, not a claim |
| check, checked | перевірка, перевірено | "checked" only: a check was run. Never "верифіковано" |
| verification report | звіт про перевірку | |
| consistent / not consistent | узгоджений / не узгоджений | question one |
| complete / not complete | повний / не повний | question two |
| holds / does not hold | тримається / не тримається | a chain or a proof |
| links | з’єднується | each record to the one before it |
| proved, proved order | доведено, порядок доведено | allowed; "доводить" and "доведений" (proves, proven) are not |
| recorded | записано | a claim by the writer, not evidence |
| writer | записувач | the program that writes the chain |
| the writer's clock | годинник записувача | |
| wall clock / monotonic clock | системний годинник / монотонний годинник | |
| digest, body digest | дайджест, дайджест тіла | |
| hash | хеш | |
| header, body | заголовок, тіло | |
| proof, inclusion proof, prefix proof | доказ, доказ включення, доказ префікса | |
| evidence bundle | комплект доказів | "пакет" is the Palimpsests package |
| package | пакет | Palimpsests |
| signed statement, issuer, public key | підписана заява, видавець, відкритий ключ | SCITT |
| acknowledge, acknowledgement (ack) | квитувати, квитування | an operator saw a candidate; "підтвердження" would read as "found true" |
| advisory | довідково, довідковий пункт | never affects the verdict |
| diagnosis | діагноз | |
| truncated tail | обрізаний хвіст | |
| key shred | знищення ключа | |
| watch | стеження | |
| attests / certifies | свідчить / засвідчує | the tool attests; it certifies nothing |
| sidecar | сайдкар | |
