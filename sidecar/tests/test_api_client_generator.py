# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The OpenAPI-to-TypeScript generator.

Tested because CI diffs its output. A generator whose output reorders or
drifts between runs fails the build for no reason, and a check that fails for
no reason is a check everyone learns to re-run until it passes — which is the
same as not having it.
"""

from __future__ import annotations

import importlib.util
import json
import pytest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_generator():
    """Import the script by path: `scripts/` is not a package."""
    spec = importlib.util.spec_from_file_location(
        "generate_api_client", ROOT / "scripts" / "generate_api_client.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gen = _load_generator()


# --- type rendering ---------------------------------------------------------


@pytest.mark.parametrize(
    ("node", "expected"),
    [
        ({"type": "string"}, "string"),
        ({"type": "integer"}, "number"),
        ({"type": "number"}, "number"),
        ({"type": "boolean"}, "boolean"),
        ({"type": "null"}, "null"),
        ({"type": "array", "items": {"type": "string"}}, "Array<string>"),
        ({"type": "array"}, "Array<unknown>"),
        ({"type": "object"}, "Record<string, unknown>"),
        (
            {"type": "object", "additionalProperties": {"type": "integer"}},
            "Record<string, number>",
        ),
        ({"$ref": "#/components/schemas/Thing"}, "Thing"),
        (
            {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "string | null",
        ),
        ({"enum": ["a", "b"]}, '"a" | "b"'),
        ({"type": ["string", "null"]}, "string | null"),
    ],
)
def test_type_rendering(node: dict, expected: str) -> None:
    assert gen.ts_type(node) == expected


def test_a_typeless_node_becomes_unknown_not_any() -> None:
    """`unknown` forces the caller to narrow.

    `any` would let a field that does not exist be dereferenced without a
    murmur, which in a verification report is the worst available failure:
    the report still looks complete.
    """
    assert gen.ts_type({}) == "unknown"


def test_an_unmapped_type_raises_rather_than_guessing() -> None:
    """The schema is ours, so an unmapped type means a model gained something
    nobody considered. Failing is more useful than emitting `any`."""
    with pytest.raises(gen.UnsupportedSchema):
        gen.ts_type({"type": "quaternion"})


# --- interface rendering ----------------------------------------------------


def test_optional_fields_are_marked_optional() -> None:
    out = gen.render_interface(
        "Thing",
        {
            "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
            "required": ["a"],
        },
    )
    assert "  a: string;" in out
    assert "  b?: string;" in out


def test_descriptions_become_comments() -> None:
    out = gen.render_interface(
        "Thing",
        {
            "description": "What a thing is.",
            "properties": {"a": {"type": "string", "description": "The a."}},
            "required": ["a"],
        },
    )
    assert "What a thing is." in out
    assert "/** The a. */" in out


# --- determinism ------------------------------------------------------------


def test_output_is_stable_across_runs() -> None:
    """The property CI depends on: same input, identical bytes."""
    schema = gen.build_schema()
    assert gen.render(schema) == gen.render(schema)


def test_components_are_emitted_in_sorted_order() -> None:
    """Sorted rather than schema order, so a reordering upstream cannot
    produce a diff that says nothing."""
    schema = {
        "components": {
            "schemas": {
                "Zebra": {"properties": {}},
                "Apple": {"properties": {}},
            }
        }
    }
    out = gen.render(schema)
    assert out.index("interface Apple") < out.index("interface Zebra")


# --- the committed artifacts ------------------------------------------------


def test_committed_client_matches_the_current_models() -> None:
    """The same assertion CI makes, available before pushing.

    If this fails, someone changed a response model without regenerating, and
    the committed client no longer describes the service.
    """
    schema = gen.build_schema()
    expected_types = gen.render(schema)
    expected_schema = json.dumps(schema, indent=2, sort_keys=True) + "\n"

    assert gen.TYPES_PATH.read_text(encoding="utf-8") == expected_types, (
        "src/api/generated/types.ts is stale — run scripts/generate_api_client.py"
    )
    assert gen.SCHEMA_PATH.read_text(encoding="utf-8") == expected_schema, (
        "schemas/openapi.json is stale — run scripts/generate_api_client.py"
    )


def test_health_is_described_in_the_schema() -> None:
    """A guard against the endpoint losing its response model.

    Without one FastAPI still serves the route, but the schema carries no
    component, the generator emits nothing, and the frontend silently goes
    back to untyped access — a regression with no visible symptom.
    """
    schema = gen.build_schema()
    assert "/health" in schema["paths"]
    assert "HealthResponse" in schema["components"]["schemas"]
