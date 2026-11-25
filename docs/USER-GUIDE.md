# Palimpsests Auditor — user guide

This guide is for people who are not cryptography specialists. Each step
says what to do, why it is needed, and what it gives you.

Version: November 2026 (Auditor on Palimpsests 0.15). The screen names
below are the English ones; in another language, the buttons are in the
same places.

---

## Contents

1. [What this program is](#1-what-this-program-is)
2. [A few words worth knowing](#2-a-few-words-worth-knowing)
3. [Installing](#3-installing)
4. [First start](#4-first-start)
5. [Opening a log](#5-opening-a-log)
6. [Verifying: three questions](#6-verifying-three-questions)
7. [When something is wrong: the diagnosis card](#7-when-something-is-wrong-the-diagnosis-card)
8. [What else the screen shows](#8-what-else-the-screen-shows)
9. [Records, search and one record up close](#9-records-search-and-one-record-up-close)
10. [The report](#10-the-report)
11. [Exporting records](#11-exporting-records)
12. [Evidence bundle: handing an excerpt to someone else](#12-evidence-bundle-handing-an-excerpt-to-someone-else)
13. [Prefix proof: showing the beginning has not changed](#13-prefix-proof-showing-the-beginning-has-not-changed)
14. [Signed statement: checking someone else's confirmation](#14-signed-statement-checking-someone-elses-confirmation)
15. [Witness log](#15-witness-log)
16. [Segment set: a log in several files](#16-segment-set-a-log-in-several-files)
17. [Watching a file that is still being written](#17-watching-a-file-that-is-still-being-written)
18. [Closing a log](#18-closing-a-log)
19. [What the program does not do](#19-what-the-program-does-not-do)
20. [Frequently asked questions](#20-frequently-asked-questions)

---

## 1. What this program is

Some AI systems keep an **audit log** in the PALA-1 format. The log is a
file where the system records what happened. For example, that it started,
loaded a model, called a tool, or noticed a possible incident.

Auditor **reads** such a log and answers three separate questions:

1. **Is the file whole?** No record inside it was changed, inserted or
   removed.
2. **Is this the whole log?** Its end has not been cut off.
3. **Did this history exist at a given moment?**

Three things to know from the start:

- Auditor **changes nothing** in the file. It only reads it.
- Auditor **does not pass judgement**. It says what was checked, how, and
  what could not be checked. The conclusions are yours.
- Auditor **certifies nothing**. Its report is a statement that a check
  was run on a given file at a given time. It is not a seal saying
  "everything is fine".

---

## 2. A few words worth knowing

These words come up throughout the program. The explanations are everyday
ones, with no mathematics.

| Word | In plain terms |
|---|---|
| **Record** | One event in the log. Each has a number, e.g. `#1447`. |
| **Chain** | The log itself. Each record carries a "fingerprint" of the one before it, so the records are linked like the links of a chain. |
| **Hash** | A fingerprint of some data: a long string of letters and digits, e.g. `7ec53d89…`. Change one letter in the data and the fingerprint becomes completely different. That is why comparing fingerprints tells you the data is the same. |
| **Digest** | The same as a hash, for a record's content (its "body"). |
| **Head** | The fingerprint of the chain's last record. One line that "sums up" the whole log up to that point. |
| **Anchor** | A head kept **apart** from the log: on another computer, in a protected store, or in a paper record. If someone cuts off the end of the log, the head stops matching the anchor. |
| **Witness** | Someone independent who noted that they saw a given head. It shows the log existed no later than a given moment. |
| **Boot** | The stretch from the start of the program that writes the log to its stop. A restart begins a new boot. |
| **Span** | One operation with a beginning and an end (a session, for example). |
| **Writer** | The program that writes the log. |
| **Acknowledgement (ack)** | An operator's mark: "I have seen this possible incident". It does not mean the incident was confirmed. |
| **SAFETY** | Records about safety: incident candidates, their acknowledgements, and the like. |

**Why all this matters.** A chain of fingerprints works like a seal on
every page of a bound register. You cannot tear out or rewrite a page
without it showing. But if you cut off the **last** pages, the seals on
the rest stay whole. That is why an anchor is needed: it is the "last
seal", kept somewhere else.

---

## 3. Installing

### Step 3.1. Download the installer and the `.sha256` file beside it

**What.** Take the `…-setup.exe` file and the file of the same name ending
in `.sha256`.

**Why.** The `.sha256` file holds the fingerprint of the correct installer.

**What it gives you.** You can make sure you have exactly the file the
developers built, and that it was not damaged or swapped on the way.

### Step 3.2. Check the installer's fingerprint

**What.**
1. Open PowerShell: Start, type `PowerShell`, then press Enter.
2. Type the following, with your own path:
   ```
   Get-FileHash -Algorithm SHA256 "C:\Users\You\Downloads\name-setup.exe"
   ```
3. Open the `.sha256` file in Notepad.
4. Compare the long string on the `Hash` line with the string in the
   `.sha256` file. Upper or lower case does not matter.

**Why.** The installer is not yet signed with a digital signature, so the
fingerprint is the only way to check that the file is genuine.

**What it gives you.**
- If the strings match, the file is the right one.
- If they do not match, **do not run it**. Download it again and tell the
  developers.

### Step 3.3. Run the installer

**What.**
1. Double-click `…-setup.exe`.
2. Windows may show a blue SmartScreen window, "Windows protected your PC".
3. If it does, click **More info**, then **Run anyway**.

**Why.** SmartScreen warns about every unsigned program. You have already
checked the fingerprint in step 3.2, so you know the file is the right one.

**What it gives you.** The program installs for your user only, without
administrator rights. You do not need to install Python separately.

---

## 4. First start

### Step 4.1. Choose the language

**What.** The **Language** list is at the top right. The program picks the
system's language by itself, and you can change it at any time.

**What it gives you.** All explanations are in your language. Some words
stay in English on purpose, because the log format itself writes them:
- record kind names, such as `GENESIS` and `INCIDENT_CANDIDATE`;
- clock marks, such as `UNSYNCED`;
- some of the verifier's notes.

They are not translated so that a translation cannot change what they say.

### Step 4.2. Look at "What is wired"

**What.** This panel is at the bottom of the screen. It shows whether the
program's inner part that reads logs (the sidecar) has started, and
whether the verifier is working.

**Why.** If something did not start, you see it at once, not later when a
check silently fails to run.

**What it gives you.**
- If every row reads "wired", "answered" or "enforced", you can start
  work.
- If it says the sidecar did not answer, restart the program.
- If restarting does not help, send the developers a screenshot of this
  panel.

---

## 5. Opening a log

### Step 5.1. Make a copy of the log

**What.** If the log is still being written (the system is running), copy
the file and open the copy.

**Why.** A file that is being written almost always ends in the middle of
a record. The program will honestly say "The file ends mid-record", even though nothing is wrong.

**What it gives you.** The check describes a stable file. If you need to
look at the live file, there is a separate mode for that (section 17).

### Step 5.2. Open the file

**What.** Click **Open a chain…** and choose the `.pala` file. You can
also drag the file into the window.

The files of a long log's parts end in a number, e.g. `chain.pala.00001`.
To see them in the dialog, choose **"All files"** at the bottom of it.

**What you will see.** A line like
`demo.pala — 16 records, 2 boots. Not checked yet.`

**Why this is a separate step.** Opening only establishes **what** you are
holding:
- the file's name;
- its size;
- the number of records;
- the file's fingerprint (SHA-256).

It is not yet a check. This is on purpose: you can make sure you have the
same file as a colleague before you see any verdict.

**What it gives you.**
- You can compare the file's fingerprint with the one the sender gave you.
- If the file changes while it is open, the program notices and tells you
  that what it shows no longer describes the file.

---

## 6. Verifying: three questions

### Step 6.1. Set up an anchor (once)

**What.** Click **Anchors…** next to **Verify**, then **New profile…**.
1. Give the profile a name, e.g. `desk`.
2. Under **Where**, choose where the head is kept:
   - **a head file**: a file written when the log was anchored, kept on a
     disk or share that the log's own machine cannot change. Click
     **Choose…** to pick it;
   - **this machine's secret store**: Windows Credential Manager (or the
     macOS Keychain), under an account name. If the head is not there yet,
     paste it into **Head** and click **Store the head**;
   - **a head typed in**: the 64 characters handed over with the log, on
     paper or in a message. Copy and paste it; do not retype it;
   - **a hardware token (PKCS#11)**: the token's module, its label, and the
     account in the secret store that holds the token's PIN.
3. You can add more than one source. They are asked in order, from the
   top, and the first that answers is used. Move them with **↑** and **↓**.
4. Click **Save the profile**.

**Why.** An anchor is the only thing that can show that the end of a log
was not cut off. It has to come from **outside** the log: a log cannot
vouch for itself.

**What it gives you.**
- The profile is kept on this computer and is there the next time you
  start the program. The panel shows where it is kept.
- It stores where to look, never a secret: a PIN stays in the secret
  store.
- A newly saved profile is chosen for the next check at once.

### Step 6.2. Choose what to verify against

**What.** Next to the **Verify** button is the **against** list.
- **"no anchor — question two stays unchecked"** verifies without an
  outside anchor.
- The other entries are your profiles, with the number of sources each
  has.

**Why.** Without an anchor, the program can say that the log is **whole**
inside. It cannot say that the log is **complete**, that is, that its end
was not cut off.

**Good to know.** If the head is kept on the same computer as the log,
whoever can rewrite the log can rewrite the head too. The answer then
says "complete against that store, nothing more". It is honest about
this, and so should your notes be.

### Step 6.3. Click "Verify"

You will see three columns, one for each of the three separate questions.
Each has an answer, and below it, in smaller type, its **basis**: what the
answer rests on.

#### Question 1. "Is what I hold internally consistent?"

- **What is checked.** Each record refers to the one before it, and each
  record's content matches its own fingerprint.
- **Basis:** "Proved — hash chain and body digests, no key required". This
  is a mathematical check; it rests on nobody's word.
- **What it gives you.** "Yes" means nothing inside the file was changed,
  inserted or removed without it showing.

#### Question 2. "Is what I hold all of it?"

- **What is checked.** Whether the log reaches the head kept in the anchor.
- **Possible answers:**
  - "Not checked — no anchor was supplied." There was nothing to check
    against. That is neither good nor bad: it is simply unknown.
  - "Complete to the head held by…". The log reaches the anchor.
  - "N records sit beyond the head held by…". There are records after
    the anchor. Usually that only means the anchor has not been updated
    yet.
  - "The head held by … does not name a record in this chain". The anchor is
    from another log, or the log was restored from an old copy.
- **What it gives you.** This is the only way to notice a cut-off end.

#### Question 3. "Did this history exist at time T?"

- **What is checked.** Whether there is outside evidence of time.
- **The usual answer:** "No external evidence in this file. Order is
  proved; the times are what the writer's clock recorded."
- **How to read it.**
  - The order of events was checked mathematically.
  - The time of each event is only what the clock of the computer that
    wrote the log showed. That clock may have been wrong, or someone may
    have changed it.
- **What it gives you.** You know what to trust fully (the order) and what
  to treat as a claim (the times).

### Step 6.4. Read the line under the buttons

**What.** It says what exactly was checked, e.g.
`demo.pala — 16 records, 2 boots. Checked without an anchor.`

**What it gives you.** A short sentence for your notes: which file, how
many records, and what it was checked against.

---

## 7. When something is wrong: the diagnosis card

If the verifier found something, a card appears with a title such as:
- "The file ends mid-record";
- "A sequence number is missing";
- "A record does not name its predecessor";
- "The anchored head is not in this chain".

Under it is **"Where to look — questions, not conclusions"**: a few points
on where to start finding out.

**Why questions, not conclusions.** The program sees only the file. It
does not know **why** something happened. A cut-off end can come from a
power loss, from copying a file while it was being written, or from
deletion. The program does not accuse and does not guess. It shows where
to look.

**What it gives you.** A plan of action, ordered from the simplest and most
likely cause first.

---

## 8. What else the screen shows

### Advisory

A list of notes that **do not affect the verdict** but are worth knowing.
For example:
- the clock went backwards;
- an operation was started and never finished;
- the program was stopped without closing properly (a crash, a power
  loss).

**What it gives you.** Context for reading the log, without alarm where
there is no cause for it.

### SAFETY

The safety records, grouped by kind. Each incident candidate shows whether
it was **acknowledged** (an operator saw it), and by which record. Click a
record to see the details:
- who acknowledged it;
- what disposition was recorded;
- how long it took.

**What it gives you.** A quick answer to "did anyone react to the
incidents".

### Chronoscope

A timeline of days by the writer's clock.
- **Click a day** to list that day's records.
- **Shift-click a second day** to list the days between them.
- **◆** marks a day's SAFETY records.
- **Click a boot's bar** to list that boot's records.
- A hatched band, "no ruler · the writer was down", is a gap between boots.

**What it gives you.** You see when the system was running, when it was
not, and where the safety events were.

### Boots and spans

The list of boots and operations, with their ranges of records.

### Record health

A description of the log's own "health":
- how many boots there were and how long each lasted;
- how the clock behaved;
- how often anchors were written;
- which warnings recur.

Each block says what it rests on:
- **proved**: counted in the order of the records, so it can be trusted;
- **the monotonic clock**: precise, but only within one boot;
- **recorded**: the writer's wall clock, so only a claim.

Under the warnings, **"Against the origin in force"** cuts the log where
the declared model or configuration changed, and counts the SAFETY records
written under each stretch, with a rate per 1,000 records. Stretches with
none are listed too. It shows **when** a pattern of warnings started. It
never says **why**: a new configuration and more warnings, side by side,
are two facts, not a cause and an effect.

**What it gives you.** An idea of how far the times in this log can be
relied on. The program gives no scores: what counts as normal is yours to
decide.

---

## 9. Records, search and one record up close

### The record list

The list shows the records page by page. The Chronoscope and the search
narrow it down.

### Search

The **search** field understands these queries:

| What to type | What happens |
|---|---|
| `#1447` | go to record 1447 |
| `@2026-08-06T22:41Z` | go to the record nearest to this time (by the writer's clock) |
| `kind:INCIDENT_CANDIDATE` | show only this kind of record; likewise `type:`, `tier:`, `source:`, `outcome:` |
| `boot:3f2a` or `span:9c01` | only this boot or span (the start of its id is enough) |
| `from:2026-08-01 to:2026-08-06` | only these days |
| `"frame magic"` | only records whose detail contains this phrase (in double quotes) |

Keys:
- `/` moves to the search field;
- `j` and `k` move to the next and the previous record;
- `n` moves to the next warning;
- `b` goes back to the record read before this one.

Under the field is an expandable reminder: **"search syntax and keys"**.

### Selected record

Click a record and its details appear on the right:
- its boot and span;
- its hash and the link to the record before it;
- its detail;
- for SAFETY records, the acknowledgement.

The **bytes** button shows the record's raw content in hexadecimal, with
every field named.

**Why the bytes.** Most of the time you will not need them. They help when
you have to show an expert exactly what lies in the file, without any
interpretation by the program.

---

## 10. The report

### Step 10.1. Build the report

**What.** After verifying, click **Build report** in the "Report" block.

**Why.** The report puts on record:
- the three answers the check gave;
- which file they are about (its fingerprint);
- which anchor it was checked against;
- when the check was run.

**What it gives you.** A document for your notes, or to hand to colleagues.

### Step 10.2. Save or print it

- **Save JSON…** is for programs and for the archive.
- **Show HTML** and **Save HTML…** are for people; the result opens in a
  browser.
- **Print…** opens the report in a separate window. In the print dialog,
  you can choose "Save as PDF".
- **Copy JSON** copies it to the clipboard.

### Step 10.3. Keep the `.sha256` file that appears beside it

**What.** Whenever the program saves a file (a report, an export, a
bundle), it writes a second file beside it, with the same name ending in
`.sha256`. The message after saving shows the fingerprint.

**Why.** That second file holds the fingerprint of the saved file.

**What it gives you.** Later, you or the recipient can check that the file
has not changed since it was saved. Use `Get-FileHash` as in step 3.2.

> Remember: a report is **a statement that a check was run**, not a
> certificate. It does not say "the system worked correctly". It says
> "this is what checking this file showed".

---

## 11. Exporting records

**What.**
1. In the "Export" block, set a range of records: **from #** and **to #**.
   Either can be left empty.
2. Click **Export JSONL…**.

**Why.** The log is binary, and ordinary programs cannot read it. The
export turns the records into text, one record per line.

**What it gives you.** You can open the records in a text editor, or load
them into a spreadsheet or another analysis tool.

**Important.** An export is **a copy for reading, not evidence**. It
carries no signature and is not part of the chain of fingerprints. Check
any conclusion you draw from it against the log itself, by record number.

---

## 12. Evidence bundle: handing an excerpt to someone else

**What.**
1. Set a range, for example the records around an incident. A bundle
   holds at most 100,000 records.
2. Click **Save bundle…**. The result is a single `.tar` file.

**Why.** Sometimes you have to show someone a few records, not the whole
log. The recipient should be able to make sure **themselves** that the
records are genuine, without trusting you or this program.

**What is inside:**
- the chosen records;
- for each record, a mathematical "inclusion proof" that it really is part
  of this log;
- the result of the check, and the anchor.

**What it gives you.** The recipient can check the bundle on their own.
The `check_bundle.py` script in the Auditor repository does that. It
needs only Python, not Auditor:

```
python3 check_bundle.py bundle.tar
```

Each line of its output starts with `ok` or `FAIL`.

**Important.** The log itself remains the primary evidence. A bundle is
an excerpt taken from it.

---

## 13. Prefix proof: showing the beginning has not changed

### Why

Say you handed the first 10,000 records of a log to an archive, or to
someone else, and the log kept growing. Later you want to show that
**the same** 10,000 records are still at the start of the log, and that
nobody rewrote them. You do not want to compare the whole log to do it.

### Step 13.1. Make the proof

**What.** In the "Prefix proof" block, type the number of leading records
and click **Prove and save…**.

**What it gives you.** A small proof file that ties the fingerprint of the
first N records to the fingerprint of the whole log as it is now. Keep it
with the archive.

### Step 13.2. Check it later

**What.** Open a newer version of the log, click **Check a proof…**, and
choose the saved file.

**What you will see.** Three separate answers:
1. **Path**: the proof is correct in itself.
2. **Prefix root**: the first N records of this log are the same as they
   were.
3. **Longer root**: the same, for the longer part.

**What it gives you.**
- If all three read "holds", the beginning of the log has not changed.
- If one reads "does not hold", those records are no longer the ones the
  proof was made from.

**Important.** The proof shows that two fingerprints agree. It does not
say where a fingerprint came from, so keep the proof with what you
archived.

---

## 14. Signed statement: checking someone else's confirmation

### What it is

Someone (an organisation, an auditor, a service) can publish a **signed
statement**: "I saw this log, and its head was this". The statement is
signed with their secret key. Anyone can check the signature with their
**public key**.

### Step 14.1. Get the public key from the issuer themselves

**What.** Take the issuer's public key from a source you trust: their
website, a contract, or the issuer in person.

**Why.** The check only shows that the holder of **this** key signed the
statement. If the key and the statement arrived in the same email from a
stranger, the check is worth nothing: a forger would send their own
statement and their own key.

**What it gives you.** Your trust in the result equals your trust in where
the key came from. That is why you are the one who chooses the key.

### Step 14.2. Check the statement

**What.**
1. Open the log.
2. Click **Check a statement…**.
3. Choose the statement file first, then the key file.

**What you will see.**
- **"Accepted"**: the statement was signed with this key and is about this
  very log at record #N. If the log has grown since, the program says so.
- **"Not accepted"**, with a reason: the signature does not match, the
  statement is about another log, the file is damaged, and so on. The
  program says which check failed. It does not claim to know why.

**What it gives you.** Independent confirmation that a log with this head
existed when the statement was signed. This answers question three better
than the writer's clock can.

---

## 15. Witness log

**What.** There is nothing to do. The first time you verify a file,
Auditor adds a line to its own log on this computer, recording:
- which file;
- which head;
- which anchor it was checked against;
- when.

The "Witness log" panel shows the latest entries, and where the file is
kept.

**Why.** Later you can show that **this computer** saw this head, in this
order. If someone changes an entry in the witness log, it shows.

**What it does not give you.** It is not an independent witness:
- its clock is this computer's clock;
- whoever controls this computer can start a new witness log;
- if its end is cut off, the rest still links.

**How to make it stronger.** From time to time, write down the witness
log's head (shown on the panel) **somewhere else**: in an email to
yourself, in a register, in a work chat. Then a cut-off end shows as well.

---

## 16. Segment set: a log in several files

Long logs are split into parts called segments. Beside them lies a
`segments.json` file, which lists the parts.

**What.** Click **Open a segment set…** and choose `segments.json`. You
can also drag it into the window.

**What you will see:**
- whether each part is whole;
- whether the parts join each other correctly;
- whether every part on the list is present.

A part that was removed under a retention policy is marked "listed, not
here".

**What it gives you.** A check of the whole history, not of one file. You
can open each part on its own with **Open**.

---

## 17. Watching a file that is still being written

**What.** Click **Watch a file…** and choose a log that is being written
right now.

**What happens.** Each new record is checked as soon as it appears. The
program shows what is happening at the end of the file, for example "a
record still being written".

- **Ask the three questions so far** runs an interim check.
- **Stop watching** stops it.

**Why.** To see, live, that the log grows correctly.

**Limits.**
- Watching keeps the records in memory, and stops by itself at about
  250,000 records.
- It never changes the file.
- To see everything (boots, spans, the report), stop watching and open a
  copy of the file the usual way.

---

## 18. Closing a log

**What.** Click **Close the chain**, next to "Verify".

**What it gives you.** The screen is cleared, and the program lets go of
the file. While a file is opening or being checked, the button is
disabled: wait until that finishes.

---

## 19. What the program does not do

- **It does not change the log**, not a record and not a byte.
- **It does not say who is to blame, or why.** It sees **what** is in the
  file, not **why** it happened.
- **It does not judge the AI model's work.** It checks the log, not the
  system's decisions.
- **It does not certify.** A report states that a check was run. It is not
  a seal of compliance.
- **It does not trust the writer's clock more than it deserves.** The
  order is proved; the times are only a claim.

---

## 20. Frequently asked questions

**Question one says "yes" and question two says "Not checked". Is that
good or bad?**
Neither. The file is whole inside. Whether it is complete is unknown,
because there is no anchor. Set one up (step 6.1) to answer it.

**"The file ends mid-record". Was I hacked?**
Most often, no. This happens when a file is copied while it is being
written, or when the power goes off. Read the "Where to look" points on
the diagnosis card. If you can, check a copy taken after the system
stopped.

**Why are some words in English even when the program is in another
language?**
They are the words of the log format itself and of the verifier. They are
shown exactly as written, so that a translation cannot change what they
say.

**What should I send a colleague so they can check for themselves?**
It depends on what they need:
- the whole log (the `.pala` file) and its fingerprint from step 5.2, if
  they will check it in their own Auditor;
- an evidence bundle (section 12), if they need only an excerpt;
- the report with its `.sha256` file, if they need only the result of
  your check.

**Where are my saved files?**
Where you chose in the save dialog. The program shows the path and the
fingerprint right after saving.

**Something went wrong in the program itself.**
Send the developers:
- a screenshot of the "What is wired" panel;
- the text of the error message;
- if you can, the log file itself, or its fingerprint.
