from __future__ import annotations

import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET_DIR = ROOT / "prompts" / "library" / "400个火爆音色"
REPORT_PATH = ROOT / "tools" / "400个火爆音色_rename_report.csv"
VOICE_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}


AD_TAIL_RE = re.compile(
    r"[-_\s]*(?:由)?微信(?:公众)?号?\s*Aruanjian888\s*(?:收集整理|整理)?\s*$",
    re.IGNORECASE,
)
INVALID_CHARS_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
DATE_OR_INDEX_RE = re.compile(r"^(?:\d{4}[.\-]\d{1,2}[.\-]\d{1,2}|\d+(?:\.\d+)*|音频|测试\d*)$")
SENTENCE_HINT_RE = re.compile(r"[，。！？；、,.!?;]|大家好|亲爱|各位|今天|很多人|你看|欢迎|姐妹|宝宝|兄弟|朋友")


def _strip_ad_tail(stem: str) -> str:
    previous = None
    current = stem.strip()
    while previous != current:
        previous = current
        current = AD_TAIL_RE.sub("", current).strip(" -_")
    return current


def _normalize_bracket_prefix(name: str) -> str:
    name = name.strip()
    match = re.match(r"^【([^】]+)】[（(]([^）)]+)[）)]", name)
    if match:
        return f"{match.group(1)}-{match.group(2)}" + name[match.end() :]
    return name


def _is_noise_part(part: str) -> bool:
    compact = part.strip()
    if not compact:
        return True
    if DATE_OR_INDEX_RE.match(compact):
        return True
    if len(compact) <= 3 and re.fullmatch(r"[\dA-Za-z_.]+", compact):
        return True
    return False


def _trim_candidate(candidate: str, max_len: int = 32) -> str:
    candidate = re.sub(r"\s+", "", candidate)
    candidate = candidate.strip(" -_")
    candidate = INVALID_CHARS_RE.sub("", candidate)
    if len(candidate) <= max_len:
        return candidate or "音色"
    return candidate[:max_len].rstrip(" -_") or "音色"


def short_name(stem: str) -> str:
    cleaned = _normalize_bracket_prefix(_strip_ad_tail(stem))
    cleaned = cleaned.replace("——", "-").replace("—", "-").replace("–", "-").replace("－", "-")
    parts = [p.strip() for p in cleaned.split("-") if p.strip()]
    if not parts:
        return "音色"

    first_index = 0
    if len(parts) > 1 and _is_noise_part(parts[0]):
        first_index = 1

    candidate_parts = [parts[first_index]]
    next_index = first_index + 1
    if next_index < len(parts):
        next_part = parts[next_index]
        if len(next_part) <= 10 and not SENTENCE_HINT_RE.search(next_part):
            candidate_parts.append(next_part)

    return _trim_candidate("-".join(candidate_parts))


def main() -> None:
    target = TARGET_DIR.resolve(strict=True)
    original_name_by_current: dict[str, str] = {}
    if REPORT_PATH.is_file():
        with REPORT_PATH.open("r", encoding="utf-8-sig", newline="") as fp:
            for row in csv.DictReader(fp):
                old_name = (row.get("old_name") or "").strip()
                current_name = (row.get("new_name") or "").strip()
                if old_name and current_name:
                    current_path = (TARGET_DIR / current_name).resolve(strict=False)
                    original_name_by_current[str(current_path).lower()] = old_name

    files = sorted(
        [p for p in target.rglob("*") if p.is_file() and p.suffix.lower() in VOICE_EXTS],
        key=lambda p: str(p).lower(),
    )

    mappings: list[tuple[Path, Path]] = []
    used: set[str] = set()
    for old in files:
        parent = old.parent.resolve(strict=True)
        if target not in (parent, *parent.parents):
            raise RuntimeError(f"refuse path outside target: {old}")

        original_name = original_name_by_current.get(str(old.resolve(strict=False)).lower(), old.name)
        base = short_name(Path(original_name).stem)
        ext = old.suffix.lower()
        candidate = f"{base}{ext}"
        key = str((old.parent / candidate).resolve(strict=False)).lower()
        index = 2
        while key in used:
            candidate = f"{base}-{index:02d}{ext}"
            key = str((old.parent / candidate).resolve(strict=False)).lower()
            index += 1
        used.add(key)
        mappings.append((old, old.parent / candidate))

    report_rows = []
    temp_paths: list[tuple[Path, Path, Path]] = []
    for idx, (old, new) in enumerate(mappings, start=1):
        temp = old.parent / f"__rename_tmp_{idx:04d}{old.suffix.lower()}"
        temp_paths.append((old, temp, new))

    for old, temp, new in temp_paths:
        if old.resolve(strict=False) == new.resolve(strict=False):
            report_rows.append((old.name, new.name, "unchanged"))
            continue
        if temp.exists():
            raise FileExistsError(temp)
        old.rename(temp)

    for old, temp, new in temp_paths:
        if old.resolve(strict=False) == new.resolve(strict=False):
            continue
        if new.exists():
            raise FileExistsError(new)
        temp.rename(new)
        original_name = original_name_by_current.get(str(old.resolve(strict=False)).lower(), old.name)
        report_rows.append((original_name, new.name, "renamed"))

    with REPORT_PATH.open("w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.writer(fp)
        writer.writerow(["old_name", "new_name", "status"])
        writer.writerows(report_rows)

    renamed = sum(1 for _, _, status in report_rows if status == "renamed")
    print(f"processed={len(files)} renamed={renamed} report={REPORT_PATH}")


if __name__ == "__main__":
    main()
