# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Palimpsests Auditor sidecar — the reader-side service.

The only process in the application that touches PALA-1 data, and it does so
only through :mod:`auditor_sidecar.pala_seam`.
"""

__version__ = "0.0.1"
__all__ = ["__version__"]
