"""Compatibility wrapper for the shared LEON LLM proxy."""

from pathlib import Path
import sys

_LEON_ROOT = Path(__file__).resolve().parents[2]
if str(_LEON_ROOT) not in sys.path:
    sys.path.insert(0, str(_LEON_ROOT))

from leon_common.llm_proxy import *  # noqa: F401,F403
from leon_common.llm_proxy import __all__ as _COMMON_ALL
from leon_common.llm_proxy import _normalize_role  # noqa: F401

__all__ = [*_COMMON_ALL, "_normalize_role"]
