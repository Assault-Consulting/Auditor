# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Entry point of the frozen sidecar (PyInstaller).

The same `run()` that `python -m auditor_sidecar.main` calls, so an installed
build and a development one start the service the same way.
"""

from auditor_sidecar.main import run

if __name__ == "__main__":
    run()
