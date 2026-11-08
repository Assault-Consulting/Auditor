# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-16 — the seam imports only the declared consumer surface.

`CONSUMER-SURFACE.md` r2, in Palimpsests: a symbol is public only if it
appears in the `__all__` of a consumer module (`reader`, `anchors`, with
`anchors_pkcs11`) or of a public channel module; anything reached another
way is internal, however importable. Auditor's side of that agreement is
"only the declared surface": `pala_seam.py` imports nothing else.

Two layers enforce it. `scripts/check_no_wire_parsing.sh` refuses any import
from a module outside the list, without needing the package installed. This
test needs it: every imported name must be in its module's `__all__` in the
version actually installed — so a name the package later stops declaring
fails here, on the pin bump or in the canary against Palimpsests `main`,
rather than when a user opens a file.
"""

from __future__ import annotations

import ast
import importlib
import pytest
from pathlib import Path

SIDECAR = Path(__file__).resolve().parents[1] / "auditor_sidecar"
SEAM = SIDECAR / "pala_seam.py"

#: The modules the seam may import from, and why each is public.
CONSUMER_MODULES = {
    "palimpsests.audit.reader": "consumer module (r2 decision 1)",
    "palimpsests.audit.anchors": "consumer module (r2 decision 1)",
    "palimpsests.audit.anchors_pkcs11": "consumer module, with anchors (r2)",
    "palimpsests.audit.names": "declared public; has __all__",
    "palimpsests.audit.report": "channel 2 (INTEGRATION-SURFACE.md)",
}

#: Channel 2 has no `__all__`; its public names are the ones the channel
#: table in INTEGRATION-SURFACE.md lists.
CHANNEL_2 = {"build_report", "derive_verdict"}


def _package_imports(path: Path) -> list[tuple[str, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("palimpsests"):
            found.extend((node.module, alias.name) for alias in node.names)
        elif isinstance(node, ast.Import):
            found.extend(
                (alias.name, "*") for alias in node.names if alias.name.startswith("palimpsests")
            )
    return found


def test_the_seam_imports_only_from_consumer_modules() -> None:
    imports = _package_imports(SEAM)
    assert imports, "the seam is where the package is imported"
    stray = sorted({module for module, _ in imports if module not in CONSUMER_MODULES})
    assert stray == [], f"outside the consumer surface: {stray}"
    assert all(name != "*" for _, name in imports), "a bare `import palimpsests...`"


@pytest.mark.parametrize("module,name", sorted(set(_package_imports(SEAM))))
def test_every_imported_name_is_declared_public(module: str, name: str) -> None:
    mod = importlib.import_module(module)
    declared = getattr(mod, "__all__", None)
    if declared is None:
        assert module == "palimpsests.audit.report", f"{module} declares no __all__"
        assert name in CHANNEL_2, f"{name} is not a channel-2 name"
    else:
        assert name in declared, f"{name} is not in {module}.__all__"


def test_nothing_else_in_the_sidecar_imports_the_package() -> None:
    others = {
        path.name: _package_imports(path)
        for path in SIDECAR.glob("*.py")
        if path != SEAM and _package_imports(path)
    }
    assert others == {}
