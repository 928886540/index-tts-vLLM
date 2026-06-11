"""Compatibility wrapper for shared LEON cache/audio contract helpers."""

from pathlib import Path
import sys

_LEON_ROOT = Path(__file__).resolve().parents[2]
if str(_LEON_ROOT) not in sys.path:
    sys.path.insert(0, str(_LEON_ROOT))

from leon_common.cache_contracts import *  # noqa: F401,F403
