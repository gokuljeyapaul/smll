"""Batch adapters (S7): JSON array / CSV directory -> canonical transcripts.

Fail closed on malformed records (BatchError); deterministic utterance
ordering; empty batches are valid and yield zero transcripts.
"""
from __future__ import annotations

import csv
import json
import pathlib
from typing import Iterator

from .contracts import ContractError, Speaker, Transcript, Utterance


class BatchError(RuntimeError):
    """Malformed batch input; callers must fail closed, never partial-process."""


def _row_to_transcript(record: dict, source: str) -> Transcript:
    try:
        return Transcript.parse(record)
    except (ContractError, KeyError, TypeError) as exc:
        raise BatchError(f"malformed batch record ({source}): {exc}") from exc


class JSONBatchAdapter:
    """Reads a JSON array of transcript objects (or fixture-wrapped records)."""

    def read(self, path: str) -> Iterator[Transcript]:
        p = pathlib.Path(path)
        if not p.is_file():
            raise BatchError(f"batch file not found: {path}")
        try:
            data = json.loads(p.read_text())
        except json.JSONDecodeError as exc:
            raise BatchError(f"invalid JSON in {path}: {exc}") from exc
        if not isinstance(data, list):
            raise BatchError(f"{path}: expected a JSON array of transcripts")
        for item in data:
            if isinstance(item, dict) and "transcript" in item:
                record = item["transcript"]
                leaks = item.get("prohibited_leaks", [])
                if not isinstance(leaks, list):
                    raise BatchError(
                        f"json:{p.name}: prohibited_leaks must be a list"
                    )
            else:
                record = item
                leaks = []
            transcript = _row_to_transcript(record, f"json:{p.name}")
            yield transcript, leaks


_LONG_REQUIRED = ("session_id", "turn_index", "speaker_role", "utterance")
_MAP_MAX_BYTES = 1024 * 1024


def load_csv_mapping(path: str) -> dict:
    """Load + validate a CSV column-mapping file (I12). Fail closed with a
    clear message naming the problem on malformed/oversize/unknown shapes."""
    p = pathlib.Path(path)
    if not p.is_file():
        raise BatchError(f"csv column map not found: {path}")
    if p.stat().st_size > _MAP_MAX_BYTES:
        raise BatchError(f"csv column map exceeds 1MB: {path}")
    try:
        mapping = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        raise BatchError(f"invalid JSON in column map {path}: {exc}") from exc
    if not isinstance(mapping, dict):
        raise BatchError(f"column map {path} must be a JSON object")
    fmt = mapping.get("format", "long")
    if fmt not in ("long", "wide"):
        raise BatchError(f"column map {path}: unknown format {fmt!r} (long|wide)")
    for k, v in mapping.items():
        if k in ("format", "turns"):
            continue
        if not isinstance(v, str) or not v:
            raise BatchError(f"column map {path}: {k!r} must be a non-empty string")
    if fmt == "long":
        for field in _LONG_REQUIRED:
            if field not in mapping:
                raise BatchError(
                    f"column map {path}: missing mandatory field {field!r}"
                )
    else:
        if "session_id" not in mapping:
            raise BatchError(
                f"column map {path}: missing mandatory field 'session_id'"
            )
        turns = mapping.get("turns")
        if not isinstance(turns, list) or not turns:
            raise BatchError(
                f"column map {path}: wide format needs a non-empty 'turns' list"
            )
        for turn in turns:
            if (
                not isinstance(turn, dict)
                or not isinstance(turn.get("column"), str)
                or not turn.get("column")
                or not isinstance(turn.get("role"), str)
                or not turn.get("role")
            ):
                raise BatchError(
                    f"column map {path}: each turn needs non-empty "
                    "'column' and 'role' strings"
                )
    return mapping


class CSVBatchAdapter:
    """Reads CSV into canonical transcripts.

    Default: zero-config long format (session_id, turn_index, speaker_role,
    utterance). I12 optional mapping (JSON) supports renamed long headers and
    wide one-row-per-session CSVs. Fail closed on malformed input."""

    def __init__(self, purpose: str = "internal_coaching_analysis",
                 mapping: dict | None = None):
        self.purpose = purpose
        self.mapping = mapping

    def _validate_headers(self, fieldnames, path) -> None:
        if not fieldnames:
            raise BatchError(f"{path}: CSV has no header row")
        if self.mapping and self.mapping.get("format", "long") == "wide":
            needed = [self.mapping["session_id"]] + [
                t["column"] for t in self.mapping["turns"]
            ]
        elif self.mapping:
            needed = [self.mapping[f] for f in _LONG_REQUIRED]
        else:
            needed = list(_LONG_REQUIRED)
        seen = set()
        for target in needed:
            if target not in fieldnames:
                raise BatchError(
                    f"{path}: mapped CSV column {target!r} not found in header"
                )
            if target in seen:
                raise BatchError(f"{path}: duplicate target column {target!r}")
            seen.add(target)

    def read(self, path: str) -> Iterator[tuple[Transcript, list]]:
        p = pathlib.Path(path)
        if not p.is_file():
            raise BatchError(f"batch file not found: {path}")
        with p.open(newline="") as fh:
            reader = csv.DictReader(fh)
            self._validate_headers(reader.fieldnames, path)
            if self.mapping and self.mapping.get("format", "long") == "wide":
                yield from self._read_wide(reader, path)
                return
            sessions: dict[str, list[tuple[int, str, str]]] = {}
            if self.mapping:
                m = self.mapping
                sid_col, idx_col = m["session_id"], m["turn_index"]
                role_col, utt_col = m["speaker_role"], m["utterance"]
            else:
                sid_col, idx_col = "session_id", "turn_index"
                role_col, utt_col = "speaker_role", "utterance"
            seen_keys = set()
            for row in reader:
                sid = row[sid_col].strip()
                try:
                    idx = int(row[idx_col])
                except ValueError as exc:
                    raise BatchError(
                        f"non-integer turn_index {row[idx_col]!r} in {path}"
                    ) from exc
                if (sid, idx) in seen_keys:
                    raise BatchError(
                        f"{path}: duplicate (session_id={sid!r}, "
                        f"turn_index={idx}) rows"
                    )
                seen_keys.add((sid, idx))
                sessions.setdefault(sid, []).append(
                    (idx, row[role_col].strip(), row[utt_col])
                )
        for sid, rows in sessions.items():
            rows.sort(key=lambda t: t[0])
            roles = {}
            utterances = []
            for i, (_idx, role, text) in enumerate(rows):
                if role not in roles:
                    roles[role] = f"S{len(roles) + 1}"
                utterances.append(
                    Utterance(
                        id=f"u{i}", speaker_id=roles[role],
                        start_ms=None, end_ms=None, text=text,
                    )
                )
            speakers = tuple(
                Speaker(sid_, role) for role, sid_ in
                sorted(roles.items(), key=lambda kv: int(kv[1][1:]))
            )
            yield Transcript(
                schema_version="1.0",
                session_id=sid,
                source_type="synthetic_text",
                purpose=self.purpose,
                language="en",
                speakers=speakers,
                utterances=tuple(utterances),
                metadata={"synthetic": True, "batch_source": str(p)},
            ), []

    def _read_wide(self, reader, path) -> Iterator[tuple[Transcript, list]]:
        m = self.mapping
        seen_sids = set()
        for row in reader:
            sid = row[m["session_id"]].strip()
            if sid in seen_sids:
                raise BatchError(
                    f"{path}: duplicate session_id row {sid!r} in wide format"
                )
            seen_sids.add(sid)
            turns = []
            for t in m["turns"]:
                cell = (row.get(t["column"]) or "").strip()
                if cell:
                    turns.append((t["role"], cell))
            if not turns:
                raise BatchError(
                    f"{path}: wide row for {sid!r} has no non-empty turn cells"
                )
            roles = {}
            utterances = []
            for i, (role, text) in enumerate(turns):
                if role not in roles:
                    roles[role] = f"S{len(roles) + 1}"
                utterances.append(
                    Utterance(
                        id=f"u{i}", speaker_id=roles[role],
                        start_ms=None, end_ms=None, text=text,
                    )
                )
            speakers = tuple(
                Speaker(sid_, role) for role, sid_ in
                sorted(roles.items(), key=lambda kv: int(kv[1][1:]))
            )
            yield Transcript(
                schema_version="1.0",
                session_id=sid,
                source_type="synthetic_text",
                purpose=self.purpose,
                language="en",
                speakers=speakers,
                utterances=tuple(utterances),
                metadata={"synthetic": True, "batch_source": str(path)},
            ), []
