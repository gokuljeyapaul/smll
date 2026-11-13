#!/usr/bin/env python
"""Verify downloaded model files against scripts/model_manifest.json.

Exit 0 only if every manifest-listed file exists and its sha256 matches.
Non-zero with a clear message naming the file (never its contents) on:
- missing file, hash mismatch, malformed manifest, missing manifest fields.
No network access; purely local hashing. Used by setup.sh, verify.sh and
(optionally) runtime fail-closed checks (issue #18).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

DEFAULT_MANIFEST = pathlib.Path(__file__).resolve().parent / "model_manifest.json"
DEFAULT_ROOT = pathlib.Path(__file__).resolve().parents[1] / "models"

REQUIRED_MODEL_FIELDS = ("repo_id", "revision", "local_path", "files")
REQUIRED_TOP_FIELDS = ("schema_version", "models")
# Models not stored as plain files under the models/ root (e.g. pip-installed
# spaCy wheels) may set "hash_verification": false; they must then state
# files as {} so the exclusion is explicit rather than silent.
EXEMPT_MODELS: set[str] = set()


class ManifestError(Exception):
    pass


def _load_manifest(path: pathlib.Path) -> dict:
    EXEMPT_MODELS.clear()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ManifestError(f"manifest unreadable: {path} ({exc})") from exc
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ManifestError(f"malformed manifest (invalid JSON): {path} ({exc})") from exc
    if not isinstance(manifest, dict):
        raise ManifestError(f"malformed manifest (not a JSON object): {path}")
    for field in REQUIRED_TOP_FIELDS:
        if field not in manifest:
            raise ManifestError(f"malformed manifest: missing required field '{field}'")
    models = manifest["models"]
    if not isinstance(models, dict) or not models:
        raise ManifestError("malformed manifest: 'models' must be a non-empty object")
    for name, entry in models.items():
        if not isinstance(entry, dict):
            raise ManifestError(f"malformed manifest: model '{name}' is not an object")
        for field in REQUIRED_MODEL_FIELDS:
            if field not in entry:
                raise ManifestError(
                    f"malformed manifest: model '{name}' is missing required field '{field}'"
                )
        files = entry["files"]
        exempt = entry.get("hash_verification") is False
        if exempt:
            if files:
                raise ManifestError(
                    f"malformed manifest: model '{name}' sets hash_verification=false "
                    "but lists files"
                )
            EXEMPT_MODELS.add(name)
        elif not isinstance(files, dict) or not files:
            raise ManifestError(
                f"malformed manifest: model '{name}' has no file entries "
                "(set hash_verification=false to exclude it explicitly)"
            )
    return manifest


def _sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_hash(value: str) -> str:
    v = value.strip().lower()
    if v.startswith("sha256:"):
        v = v[len("sha256:"):]
    if len(v) != 64 or any(c not in "0123456789abcdef" for c in v):
        raise ManifestError(f"malformed manifest: invalid sha256 value '{value}'")
    return v


def verify(manifest: dict, root: pathlib.Path) -> list[str]:
    """Return a list of human-readable problems (empty list = all match)."""
    problems: list[str] = []
    for name, entry in manifest["models"].items():
        if name in EXEMPT_MODELS:
            continue
        local = entry["local_path"]
        model_dir = (root / local).resolve()
        for rel_file, expected in entry["files"].items():
            try:
                expected_hash = _normalize_hash(str(expected))
            except ManifestError as exc:
                problems.append(str(exc))
                continue
            target = (model_dir / rel_file).resolve()
            # Reject traversal outside the model dir / root.
            if root.resolve() not in target.parents and target != root.resolve():
                problems.append(
                    f"manifest entry '{name}/{rel_file}' escapes the models root"
                )
                continue
            if not target.is_file():
                problems.append(f"missing file: {name}/{rel_file} ({target})")
                continue
            actual_hash = _sha256_file(target)
            if actual_hash != expected_hash:
                problems.append(
                    f"hash mismatch: {name}/{rel_file} "
                    f"(expected sha256:{expected_hash}, got sha256:{actual_hash})"
                )
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify model files against manifest")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    args = parser.parse_args(argv)

    manifest_path = pathlib.Path(args.manifest)
    root = pathlib.Path(args.root)
    try:
        manifest = _load_manifest(manifest_path)
    except ManifestError as exc:
        print(f"MODEL VERIFICATION FAILED: {exc}", file=sys.stderr)
        return 2
    problems = verify(manifest, root)
    if problems:
        for problem in problems:
            print(f"MODEL VERIFICATION FAILED: {problem}", file=sys.stderr)
        return 1
    count = sum(
        len(entry["files"])
        for name, entry in manifest["models"].items()
        if name not in EXEMPT_MODELS
    )
    print(
        f"model verification OK: {count} files match manifest {manifest_path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
