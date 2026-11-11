"""Versioned purpose policies loaded from YAML.

Unknown or malformed policies fail closed (A02).
"""
from __future__ import annotations

import pathlib

import yaml

VALID_OPERATIONS = {"REPLACE", "GENERALIZE", "SUPPRESS", "PRESERVE"}


class PolicyStore:
    def __init__(self, path: str | pathlib.Path):
        path = pathlib.Path(path)
        if not path.is_file():
            raise FileNotFoundError(f"policy file not found: {path}")
        raw = yaml.safe_load(path.read_text())
        if not isinstance(raw, dict) or "purpose_policies" not in raw:
            raise ValueError(f"malformed policy file: {path}")
        self._policies: dict[str, dict] = {}
        for name, body in raw["purpose_policies"].items():
            if not isinstance(body, dict) or "mandatory_stages" not in body:
                raise ValueError(f"malformed policy: {name}")
            for op in body.get("direct_pii", []) + body.get("quasi_identifiers", []):
                if op not in VALID_OPERATIONS and op != "REVIEW":
                    raise ValueError(f"invalid operation {op!r} in policy {name}")
            self._policies[name] = body

    def get(self, name: str) -> dict:
        if name not in self._policies:
            raise KeyError(f"unknown purpose policy: {name!r}")
        return self._policies[name]

    def names(self) -> list[str]:
        return sorted(self._policies)
