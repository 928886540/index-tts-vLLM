"""Smoke test for the human-readable snapshot cache index.

This test uses a temporary cache root. It does not touch outputs/cache.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from indextts import snapshot_cache  # noqa: E402


def main() -> None:
    original_cache_dir = snapshot_cache.CACHE_DIR
    original_readable_dir = snapshot_cache.READABLE_CACHE_DIR
    try:
        with tempfile.TemporaryDirectory(prefix="idx-readable-cache-") as root:
            snapshot_cache.CACHE_DIR = os.path.join(root, "cache")
            snapshot_cache.READABLE_CACHE_DIR = os.path.join(snapshot_cache.CACHE_DIR, "by_role")

            key = "c" * 40
            metadata = {
                "segments_meta": [
                    {"role": "\u65c1\u767d"},
                    {"role": "ZhangSan"},
                    {"role": "ZhangSan"},
                    {"role": "\u5bf9\u767d"},
                ],
                "duration_s": 1.23,
            }

            wav_path = snapshot_cache.save_cached_audio(key, b"RIFF-test-audio", metadata)
            _, json_path = snapshot_cache.cache_paths(key)
            saved = snapshot_cache._read_metadata(json_path)
            entries = saved.get("readable_cache") or []

            assert os.path.exists(wav_path), wav_path
            assert len(entries) == 1, entries
            assert entries[0]["role"] == "ZhangSan", entries
            assert key in os.path.basename(entries[0]["path"]), entries[0]
            assert os.path.exists(entries[0]["path"]), entries[0]
            assert os.path.exists(entries[0]["metadata_path"]), entries[0]

            snapshot_cache.get_cached_audio(key)
            readable_meta = snapshot_cache._read_metadata(entries[0]["metadata_path"])
            assert readable_meta.get("hit_count") == 1, readable_meta

            assert snapshot_cache.delete_cache(key) is True
            assert not os.path.exists(wav_path), wav_path
            assert not os.path.exists(entries[0]["path"]), entries[0]
            assert not os.path.exists(entries[0]["metadata_path"]), entries[0]
    finally:
        snapshot_cache.CACHE_DIR = original_cache_dir
        snapshot_cache.READABLE_CACHE_DIR = original_readable_dir

    print("snapshot readable cache smoke OK")


if __name__ == "__main__":
    main()
