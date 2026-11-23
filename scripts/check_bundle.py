#!/usr/bin/env python3
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Re-verify a `pala-bundle/1` evidence bundle with nothing but Python (E-02).

Written from the specifications alone — `docs/specs/bundle/pala-bundle-1.md`
§8 and PALA-1 core §1.2, §2.1, §2.4, §4.1–§4.3 in Palimpsests — and imports
nothing from this repository or from Palimpsests: a bundle is made to be
sent, and its recipient should not have to trust the program that made it,
nor the program that shows it. This file is that recipient's check.

What it recomputes, in the order §8 gives:

  1. each member's SHA-256 against MANIFEST.json;
  2. records.pala walks as a container to its end (§2.4); every body matches
     the digest its header binds (§1.2); the records link to one another and
     their seqs run without a gap (§4.1) — and, when the range starts at
     seq 0, it starts with a GENESIS whose prev_hash is zero (§4.2), and when
     it reaches the chain's last record, it ends on MANIFEST's source_head;
  3. every non-null proof folds from its leaf — which must be the hash of
     that record's header in records.pala — along its path to its root
     (§4.3), and that root is the one the MERKLE record at root_seq carries,
     when that record is in the range;
  4. each time claim equals the fields of its record's header.

What it does not do: §7.4's semantic checks and the anchor. A bundle's
`verification.json` is the assembler's statement about the whole source
chain; this reads it for nothing but where the chain ended, and says so.
A null proof is "not yet aggregated", never "not included", and is counted,
not failed.

    python3 check_bundle.py bundle.tar

Exit 0 when every check holds, 1 when one does not (each is listed), 2 when
the file is not a bundle this can read.
"""

import hashlib
import json
import struct
import sys
import tarfile

MEMBERS = (
    "records.pala",
    "proofs.json",
    "verification.json",
    "time-claims.json",
    "MANIFEST.json",
)
HEADER = 156
RT_GENESIS = 0x0001
RT_MERKLE = 0x0020
TLV_MERKLE_TREE_HASH = 0x0011
ZERO32 = bytes(32)


def sha256(b):
    return hashlib.sha256(b).digest()


class Record:
    """One record's header, read at the offsets of core §2.1."""

    def __init__(self, header, body):
        (
            self.magic,
            self.format_version,
            self.header_len,
            self.record_type,
            self.assurance_tier,
            self.time_trust,
            self.seq,
        ) = struct.unpack_from("<4sHHHBBQ", header, 0)
        self.boot_id = header[20:36]
        self.prev_hash = header[36:68]
        self.monotonic_ns, self.wall_clock_ns = struct.unpack_from("<Qq", header, 100)
        self.key_id, self.body_len = struct.unpack_from("<II", header, 116)
        self.body_digest = header[124:156]
        self.header = header
        self.body = body
        self.hash = sha256(header)  # record_hash, §1.2

    def tlvs(self):
        """TLV items after the fixed header (§2.2), as (type, value)."""
        out, off = [], HEADER
        while off < self.header_len:
            if off + 4 > self.header_len:
                raise ValueError(f"#{self.seq}: a TLV header overruns header_len")
            t, n = struct.unpack_from("<HH", self.header, off)
            off += 4
            if off + n > self.header_len:
                raise ValueError(f"#{self.seq}: a TLV value overruns header_len")
            out.append((t, self.header[off : off + n]))
            off += n
        return out


def walk(data):
    """Records back to back from byte 0 (§2.4). Returns (records, where it stopped or None)."""
    records, off = [], 0
    while off < len(data):
        if len(data) - off < HEADER:
            return records, f"a truncated tail at byte {off}: fewer than {HEADER} bytes"
        if data[off : off + 4] != b"PALA":
            return records, f"no PALA magic at byte {off}"
        header_len, = struct.unpack_from("<H", data, off + 6)
        body_len, = struct.unpack_from("<I", data, off + 120)
        if header_len < HEADER:
            return records, f"header_len {header_len} below {HEADER} at byte {off}"
        end = off + header_len + body_len
        if end > len(data):
            return records, f"a truncated tail at byte {off}: the record runs past the end"
        records.append(Record(data[off : off + header_len], data[off + header_len : end]))
        off = end
    return records, None


def fold(leaf_record_hash, path):
    """§4.3: leaf() of the record hash, then node() along the tagged path."""
    h = sha256(b"\x00" + leaf_record_hash)
    for side, sibling in path:
        s = bytes.fromhex(sibling)
        if side == "L":
            h = sha256(b"\x01" + s + h)
        elif side == "R":
            h = sha256(b"\x01" + h + s)
        else:
            raise ValueError(f"a path entry with side {side!r}")
    return h


def check(path):
    """Every finding, as (ok, line). Raises ValueError for a file this cannot read."""
    findings = []

    def say(ok, yes, no=None):
        findings.append((ok, yes if ok else (no or yes)))

    try:
        tar = tarfile.open(path, mode="r:")
    except (tarfile.TarError, OSError) as exc:
        raise ValueError(f"not a tar archive: {exc}") from None
    with tar:
        names = tar.getnames()
        if names != list(MEMBERS):
            raise ValueError(f"not a pala-bundle/1: members {names}, expected {list(MEMBERS)}")
        raw = {n: tar.extractfile(n).read() for n in MEMBERS}

    manifest = json.loads(raw["MANIFEST.json"])
    if manifest.get("format") != "pala-bundle/1":
        raise ValueError(f"not a pala-bundle/1: format {manifest.get('format')!r}")

    # 1. Members against the manifest.
    listed = manifest.get("members") or {}
    for name in MEMBERS[:-1]:
        claimed = listed.get(name, {}).get("sha256")
        got = hashlib.sha256(raw[name]).hexdigest()
        say(
            claimed == got,
            f"{name}: SHA-256 matches MANIFEST.json",
            f"{name}: SHA-256 does not match MANIFEST.json",
        )

    # 2. The records.
    records, stopped = walk(raw["records.pala"])
    say(stopped is None, "records.pala walks to its end", f"records.pala stops: {stopped}")
    bad_bodies = [r.seq for r in records if not body_matches(r)]
    say(
        not bad_bodies,
        "every body matches its header's digest",
        f"bodies that do not match their header's digest: {bad_bodies}",
    )
    pairs = list(zip(records, records[1:], strict=False))
    breaks = [b.seq for a, b in pairs if b.prev_hash != a.hash]
    gaps = [b.seq for a, b in pairs if b.seq != a.seq + 1]
    say(not breaks, "each record links to the one before it", f"breaks at {breaks}")
    say(not gaps, "the seqs run without a gap", f"gaps at {gaps}")

    rng = manifest.get("range") or {}
    from_seq, to_seq, count = rng.get("from_seq"), rng.get("to_seq"), rng.get("records")
    seqs = [r.seq for r in records]
    held = (seqs[0], seqs[-1], len(seqs)) if seqs else (None, None, 0)
    say(
        held == (from_seq, to_seq, count or 0),
        f"records.pala holds the manifest's range #{from_seq}–#{to_seq}, {count} records",
        f"records.pala holds {held}, the manifest says {(from_seq, to_seq, count)}",
    )

    if records and from_seq == 0:
        first = records[0]
        say(
            first.record_type == RT_GENESIS and first.prev_hash == ZERO32,
            "the range starts at a GENESIS with a zero prev_hash",
            "the range starts at seq 0 but not at a GENESIS with a zero prev_hash",
        )
    later = [r.seq for r in records[1:] if r.record_type == RT_GENESIS]
    say(not later, "no GENESIS after the first record", f"a GENESIS after the first at {later}")

    verification = json.loads(raw["verification.json"])
    total = verification.get("records")
    source_head = manifest.get("source_head")
    reaches_end = (
        from_seq == 0 and isinstance(total, int) and to_seq is not None and to_seq >= total - 1
    )
    if records and records[-1].hash.hex() == source_head:
        say(True, "the range ends on source_head: it reaches the chain's last record")
    elif records and reaches_end:
        # A chain from seq 0 has its last record at `records` - 1.
        say(False, "the range reaches the chain's last record but does not end on source_head")
    else:
        say(True, "the range does not reach the chain's last record: no head to compare (§8.2)")

    # 3. Proofs.
    by_seq = {r.seq: r for r in records}
    proofs = json.loads(raw["proofs.json"]).get("proofs") or {}
    null, good, bad = 0, 0, []
    for key, proof in proofs.items():
        if proof is None:
            null += 1
            continue
        problem = proof_problem(int(key), proof, by_seq)
        if problem is None:
            good += 1
        else:
            bad.append(problem)
    missing = sorted(set(by_seq) - {int(k) for k in proofs})
    if missing:
        bad.append(f"no proofs.json entry for {missing}")
    say(
        not bad,
        f"{good} inclusion proofs verify; {null} not yet aggregated (null — not 'not included')",
        "; ".join(bad),
    )

    # 4. Time claims.
    claims = json.loads(raw["time-claims.json"]).get("claims") or []
    wrong = [c.get("seq") for c in claims if not claim_matches(c, by_seq)]
    absent = sorted(set(by_seq) - {c.get("seq") for c in claims})
    say(
        not wrong and not absent,
        f"{len(claims)} time claims equal their headers",
        f"time claims that differ from their header: {wrong}; missing: {absent}",
    )

    # What verification.json says is the assembler's, about the whole source.
    say(
        True,
        "verification.json — the assembler's statement on the whole source, not rechecked "
        f"here: consistent={verification.get('consistent')}, "
        f"chain_ok={verification.get('chain_ok')}",
    )
    return findings


def body_matches(r):
    """§1.2 and §2.1: SHA-256 of the body, or 32 zero bytes for none."""
    if r.body_len == 0:
        return r.body_digest == ZERO32
    return sha256(r.body) == r.body_digest


def proof_problem(seq, proof, by_seq):
    """None when the proof holds (§8.3), else what does not."""
    rec = by_seq.get(seq)
    leaf = bytes.fromhex(proof["leaf"])
    if rec is None or leaf != rec.hash:
        return f"#{seq}: its leaf is not that record's header hash"
    try:
        root = fold(leaf, proof["path"])
    except ValueError as exc:
        return f"#{seq}: {exc}"
    if root.hex() != proof["root"]:
        return f"#{seq}: the path does not fold to its root"
    carrier = by_seq.get(proof.get("root_seq"))
    if carrier is not None:
        carried = [v for t, v in carrier.tlvs() if t == TLV_MERKLE_TREE_HASH]
        if carrier.record_type != RT_MERKLE or carried != [root]:
            return f"#{seq}: the root is not the one MERKLE #{carrier.seq} carries"
    return None


def claim_matches(claim, by_seq):
    rec = by_seq.get(claim.get("seq"))
    if rec is None:
        return False
    stated = (claim.get("monotonic_ns"), claim.get("wall_clock_ns"), claim.get("time_trust"))
    return stated == (rec.monotonic_ns, rec.wall_clock_ns, rec.time_trust)


def main(path):
    try:
        findings = check(path)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"cannot check {path}: {exc}")
        return 2
    for ok, line in findings:
        print(("ok    " if ok else "FAIL  ") + line)
    return 0 if all(ok for ok, _ in findings) else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[0])
        print("usage: python3 check_bundle.py bundle.tar")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
