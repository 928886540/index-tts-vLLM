"""Lightweight SQLite-backed profile and usage log storage."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional


DB_PATH = os.path.join("outputs", "indextts_profiles.sqlite3")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_parent_dir(db_path: str) -> None:
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _json_dumps(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _json_loads(data_json: str) -> dict:
    data = json.loads(data_json)
    if not isinstance(data, dict):
        raise ValueError("stored JSON value is not an object")
    return data


def init_db(db_path: str = DB_PATH) -> None:
    """Create profile and usage log tables if they do not already exist."""
    _ensure_parent_dir(db_path)
    with _connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS usage_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at
            ON usage_logs(created_at)
            """
        )


def save_profile(name: str, data: dict, db_path: str = DB_PATH) -> int:
    """Insert or update a named profile and return its row id."""
    if not name:
        raise ValueError("profile name must not be empty")
    if not isinstance(data, dict):
        raise TypeError("profile data must be a dict")

    init_db(db_path)
    now = _now_iso()
    data_json = _json_dumps(data)

    with _connect(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE profiles
            SET data_json = ?, updated_at = ?
            WHERE name = ?
            """,
            (data_json, now, name),
        )
        if cursor.rowcount == 0:
            cursor = conn.execute(
                """
                INSERT INTO profiles (name, data_json, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (name, data_json, now, now),
            )
            return int(cursor.lastrowid)

        row = conn.execute(
            "SELECT id FROM profiles WHERE name = ?",
            (name,),
        ).fetchone()
        if row is None:
            raise RuntimeError("profile update succeeded but row lookup failed")
        return int(row["id"])


def get_profile(name: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Return a named profile with metadata, or None when it does not exist."""
    init_db(db_path)
    with _connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, name, data_json, created_at, updated_at
            FROM profiles
            WHERE name = ?
            """,
            (name,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "data": _json_loads(row["data_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_profiles(db_path: str = DB_PATH) -> list[dict]:
    """Return all profiles ordered by most recently updated first."""
    init_db(db_path)
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, name, data_json, created_at, updated_at
            FROM profiles
            ORDER BY updated_at DESC, id DESC
            """
        ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "name": row["name"],
            "data": _json_loads(row["data_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def delete_profile(name: str, db_path: str = DB_PATH) -> bool:
    """Delete a named profile and return True if a row was removed."""
    init_db(db_path)
    with _connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM profiles WHERE name = ?", (name,))
        return cursor.rowcount > 0


def append_usage(event_type: str, payload: dict, db_path: str = DB_PATH) -> int:
    """Append a usage event and return its row id."""
    if not event_type:
        raise ValueError("event_type must not be empty")
    if not isinstance(payload, dict):
        raise TypeError("usage payload must be a dict")

    init_db(db_path)
    now = _now_iso()
    with _connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO usage_logs (event_type, payload_json, created_at)
            VALUES (?, ?, ?)
            """,
            (event_type, _json_dumps(payload), now),
        )
        return int(cursor.lastrowid)


def list_usage(limit: int = 200, db_path: str = DB_PATH) -> list[dict]:
    """Return recent usage events ordered by newest first."""
    init_db(db_path)
    if limit < 1:
        return []

    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, event_type, payload_json, created_at
            FROM usage_logs
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "event_type": row["event_type"],
            "payload": _json_loads(row["payload_json"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]
