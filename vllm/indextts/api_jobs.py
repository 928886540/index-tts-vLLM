"""Compatibility wrapper for shared LEON API job helpers."""

from pathlib import Path
import sys

_LEON_ROOT = Path(__file__).resolve().parents[2]
if str(_LEON_ROOT) not in sys.path:
    sys.path.insert(0, str(_LEON_ROOT))

from leon_common.api.jobs import *  # noqa: F401,F403
