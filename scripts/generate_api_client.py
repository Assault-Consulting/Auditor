#!/usr/bin/env python3
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Generate the OpenAPI schema and the frontend's TypeScript types from it.

The point of generating rather than hand-writing: a response model changing
shape becomes a **TypeScript compile error** instead of a field that silently
renders empty. In an application whose output is a verification report, a
quietly-absent field is the worst available failure — the report still looks
complete.

Written here rather than delegated to a generator from npm, for two reasons.
It is a few hundred lines against a schema we control, so the dependency would
be larger than the problem; and CI regenerates and diffs the committed output,
which means the generator has to be deterministic and testable — properties
easier to guarantee in code that lives in this repository with its own tests.

Run with ``--check`` to fail instead of writing, which is what CI does. If it
fails there, someone changed a model without regenerating, and the committed
client no longer describes the service.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "openapi.json"
TYPES_PATH = ROOT / "src" / "api" / "generated" / "types.ts"

HEADER = """// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0
//
// GENERATED FILE — do not edit.
//
// Produced by scripts/generate_api_client.py from the sidecar's OpenAPI
// schema. CI regenerates this and fails on any difference, so an edit here
// is reverted by the next run rather than merged.
//
// To change these types, change the response model in
// sidecar/auditor_sidecar/models.py and run:
//
//     python scripts/generate_api_client.py
"""

#: JSON Schema primitives to TypeScript. Deliberately small: the schema is
#: ours, so an unmapped type means a model gained something unconsidered, and
#: failing is more useful than emitting `any`.
PRIMITIVES = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
    "null": "null",
}


class UnsupportedSchema(Exception):
    """A construct the generator will not guess at."""


def ts_type(node: dict[str, Any]) -> str:
    """Render one JSON Schema node as a TypeScript type expression."""
    if "$ref" in node:
        return node["$ref"].rsplit("/", 1)[-1]

    if "enum" in node:
        return " | ".join(json.dumps(v) for v in node["enum"])

    for key in ("anyOf", "oneOf"):
        if key in node:
            return " | ".join(ts_type(sub) for sub in node[key])

    kind = node.get("type")
    if kind is None:
        # No type, no $ref, no union: an open object. `unknown` rather than
        # `any`, so the caller is forced to narrow it instead of silently
        # dereferencing a field that may not be there.
        return "unknown"

    if isinstance(kind, list):
        return " | ".join(ts_type({"type": k}) for k in kind)

    if kind in PRIMITIVES:
        return PRIMITIVES[kind]

    if kind == "array":
        items = node.get("items")
        return f"Array<{ts_type(items) if items else 'unknown'}>"

    if kind == "object":
        extra = node.get("additionalProperties")
        if isinstance(extra, dict):
            return f"Record<string, {ts_type(extra)}>"
        return "Record<string, unknown>"

    raise UnsupportedSchema(f"unmapped schema type: {kind!r}")


def render_interface(name: str, schema: dict[str, Any]) -> str:
    """Render one component schema as an exported interface."""
    lines: list[str] = []

    if doc := schema.get("description"):
        lines.append("/**")
        lines.extend(f" * {line}".rstrip() for line in doc.strip().splitlines())
        lines.append(" */")

    lines.append(f"export interface {name} {{")

    required = set(schema.get("required", []))
    for field, node in schema.get("properties", {}).items():
        if field_doc := node.get("description"):
            lines.append(f"  /** {' '.join(field_doc.split())} */")
        optional = "" if field in required else "?"
        lines.append(f"  {field}{optional}: {ts_type(node)};")

    lines.append("}")
    return "\n".join(lines)


def render(schema: dict[str, Any]) -> str:
    """Render the whole module.

    Components are emitted in sorted order rather than schema order, so a
    reordering upstream cannot produce a diff that says nothing. That matters:
    CI diffs this file, and a check that fails for no reason is a check
    everyone learns to re-run until it passes.
    """
    components = schema.get("components", {}).get("schemas", {})
    blocks = [render_interface(name, node) for name, node in sorted(components.items())]
    return HEADER + "\n" + "\n\n".join(blocks) + "\n"


def build_schema() -> dict[str, Any]:
    """The sidecar's OpenAPI document.

    Built from an app with the token gate off, because the schema describes the
    shape of the API and not the configuration of one launch. A token would put
    nothing in the document and would be one more thing to get wrong.
    """
    sys.path.insert(0, str(ROOT / "sidecar"))
    from auditor_sidecar.main import build_app

    return build_app(token=None).openapi()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the committed files differ from what would be generated",
    )
    args = parser.parse_args()

    schema = build_schema()
    # sort_keys and a trailing newline: byte-stable output is what makes the
    # --check diff meaningful.
    schema_text = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    types_text = render(schema)

    targets = [(SCHEMA_PATH, schema_text), (TYPES_PATH, types_text)]

    if args.check:
        stale = [
            path
            for path, text in targets
            if not path.exists() or path.read_text(encoding="utf-8") != text
        ]
        if stale:
            print("FAIL: generated files are out of date:")
            for path in stale:
                print(f"  {path.relative_to(ROOT)}")
            print("\nRun: python scripts/generate_api_client.py")
            return 1
        print(f"ok: {len(targets)} generated file(s) match the current models")
        return 0

    for path, text in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
