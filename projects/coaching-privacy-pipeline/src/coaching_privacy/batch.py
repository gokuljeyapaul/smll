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
            record = item.get("transcript", item) if isinstance(item, dict) else item
            yield _row_to_transcript(record, f"json:{p.name}")


class CSVBatchAdapter:
    """Reads long-format CSV (session_id, turn_index, speaker_role, utterance)
    and flattens it into one canonical transcript per session_id, ordered by
    turn_index."""

    def __init__(self, purpose: str = "internal_coaching_analysis"):
        self.purpose = purpose

    def read(self, path: str) -> Iterator[Transcript]:
        p = pathlib.Path(path)
        if not p.is_file():
            raise BatchError(f"batch file not found: {path}")
        sessions: dict[str, list[tuple[int, str, str]]] = {}
        with p.open(newline="") as fh:
            reader = csv.DictReader(fh)
            required = {"session_id", "turn_index", "speaker_role", "utterance"}
            if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
                raise BatchError(
                    f"{path}: CSV must have columns {sorted(required)}"
                )
            for row in reader:
                sid = row["session_id"].strip()
                try:
                    idx = int(row["turn_index"])
                except ValueError as exc:
                    raise BatchError(
                        f"non-integer turn_index {row['turn_index']!r} in {path}"
                    ) from exc
                sessions.setdefault(sid, []).append(
                    (idx, row["speaker_role"].strip(), row["utterance"])
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
            )
