#!/usr/bin/env python3
"""Fetch and verify the pinned model artifacts (stdlib only — runs before/independent of deps).

Reads scripts/model_manifest.json (the single source of truth) and downloads into the
gitignored .cache/models/. Every artifact is verified: size AND sha256 must match the
manifest. Idempotent: an already-verified artifact is not re-downloaded.

Range-resume across attempts: CI runners are progressively rate-limited by the model
host (observed in the postclip campaign: fresh multi-hundred-MB downloads get cut
mid-stream, then quick-rejected), so each retry resumes from the bytes already on
disk instead of restarting. The sha256 hash state lives across attempts.

Usage:
  python3 scripts/fetch_model.py                # every 'roles' entry (what the app ships)
  python3 scripts/fetch_model.py --candidate N # also fetch candidates.bench entry N (host bench)
  python3 scripts/fetch_model.py --list
Exit 0 = all requested artifacts verified present; 1 = failure after retries.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODELS_DIR = ROOT / ".cache" / "models"
MANIFEST_PATH = HERE / "model_manifest.json"

MAX_ATTEMPTS = 6
BACKOFF_S = [5, 15, 45, 90, 180]
CHUNK = 1 << 20


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def sha256_and_size(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        while True:
            block = f.read(CHUNK * 8)
            if not block:
                break
            h.update(block)
            size += len(block)
    return h.hexdigest(), size


def fetch_verified(url: str, target: Path, sha256: str, size_bytes: int) -> bool:
    """Download url -> target with range-resume retries; verify size+sha256. True on success."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file():
        got_hash, got_size = sha256_and_size(target)
        if got_hash == sha256 and got_size == size_bytes:
            print(f"fetch_model: {target.name} already present and VERIFIED")
            return True
        print(f"fetch_model: {target.name} present but does NOT match the manifest — re-downloading")
        target.unlink()

    tmp = target.with_suffix(target.suffix + ".part")
    print(f"fetch_model: downloading {url}")
    print(f"fetch_model: expecting size={size_bytes} sha256={sha256}")
    hash_obj = hashlib.sha256()
    bytes_so_far = tmp.stat().st_size if tmp.exists() else 0
    if bytes_so_far:
        with tmp.open("rb") as f:
            while True:
                block = f.read(CHUNK * 8)
                if not block:
                    break
                hash_obj.update(block)
        print(f"fetch_model: resuming from existing .part ({bytes_so_far} bytes)")

    last_err: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            headers = {"User-Agent": "folderchat-setup/1.0"}
            if bytes_so_far > 0:
                headers["Range"] = f"bytes={bytes_so_far}-"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as res:
                status = res.status
                if bytes_so_far > 0 and status == 200:
                    # Host ignored the range: restart cleanly from byte 0.
                    tmp.unlink(missing_ok=True)
                    hash_obj = hashlib.sha256()
                    bytes_so_far = 0
                mode = "ab" if (bytes_so_far > 0 and status in (206, 200)) else "wb"
                if status == 200:
                    mode = "wb" if bytes_so_far == 0 else "ab"
                with tmp.open(mode) as out:
                    while True:
                        block = res.read(CHUNK)
                        if not block:
                            break
                        hash_obj.update(block)
                        out.write(block)
                        bytes_so_far += len(block)
            if bytes_so_far != size_bytes:
                raise OSError(f"truncated stream: got {bytes_so_far}/{size_bytes} bytes")
            got = hash_obj.hexdigest()
            if got != sha256:
                raise OSError(f"integrity mismatch: sha256={got}")
            tmp.replace(target)
            print(f"fetch_model: downloaded {bytes_so_far} bytes across {attempt} attempt(s); sha256 VERIFIED")
            return True
        except Exception as exc:  # noqa: BLE001 — retry any transport/integrity failure
            last_err = exc
            print(f"fetch_model: attempt {attempt} failed at byte {bytes_so_far}: {exc}", file=sys.stderr)
            msg = str(exc)
            if "integrity mismatch" in msg or "truncated stream" in msg:
                tmp.unlink(missing_ok=True)
                hash_obj = hashlib.sha256()
                bytes_so_far = 0
            else:
                print(f"fetch_model: keeping .part ({bytes_so_far} bytes) for range-resume")
            if attempt < MAX_ATTEMPTS:
                wait = BACKOFF_S[min(attempt - 1, len(BACKOFF_S) - 1)]
                print(f"fetch_model: retrying in {wait}s")
                time.sleep(wait)
    print(f"fetch_model: FAILED after {MAX_ATTEMPTS} attempts: {last_err}", file=sys.stderr)
    return False


def fetch_single(entry: dict) -> bool:
    target = MODELS_DIR / entry["file"]
    if not fetch_verified(entry["url"], target, entry["sha256"], int(entry["size_bytes"])):
        return False
    ok = True
    if entry.get("patch"):
        ok = apply_patch(entry, target) and ok
    for aux in entry.get("aux_files", []):
        aux_target = MODELS_DIR / (entry.get("name", "aux") + "-aux") / aux["path"]
        ok = fetch_verified(aux["url"], aux_target, aux["sha256"], int(aux["size_bytes"])) and ok
    return ok


def apply_patch(entry: dict, upstream: Path) -> bool:
    """Apply the manifest's recorded metadata patch to the verified upstream artifact
    and sha256-pin the result.

    Recorded reason (S0): the upstream Pleias GGUFs set tokenizer.ggml.pre='pleias-rag',
    a pre-tokenizer type llama.cpp never learned — llama.cpp refuses to load the file
    (hard error even on current master). The tokenizer's actual pre-tokenizer is the
    GPT-2 regex + ByteLevel (read from the model's tokenizer.json), so the kv is
    rewritten to 'gpt2'. The patched artifact is re-pinned by sha256 here and its
    tokenization is verified against the HF tokenizer by
    tests/e2e/test_cli.py::test_a01_pleias_patch_tokenizer_equality (token-id equality
    on the fixture questions and the prompt markers)."""
    patch = entry["patch"]
    target = MODELS_DIR / patch["output_file"]
    if target.is_file():
        got_hash, got_size = sha256_and_size(target)
        if patch.get("sha256") and got_hash == patch["sha256"] and got_size == int(patch["size_bytes"]):
            print(f"fetch_model: {patch['output_file']} already present and VERIFIED (patched)")
            return True

    import gguf

    reader = gguf.GGUFReader(str(upstream))
    pre_field = reader.get_field("tokenizer.ggml.pre")
    if pre_field is not None and pre_field.contents() == patch["pre_value"]:
        print(f"fetch_model: {upstream.name} already has pre={patch['pre_value']} — no patch needed")
        return True
    arch_field = reader.get_field("general.architecture")
    arch = arch_field.contents() if arch_field is not None else "llama"
    print(f"fetch_model: applying recorded patch to {upstream.name} -> {patch['output_file']} "
          f"(pre: {pre_field.contents() if pre_field is not None else '<missing>'} -> {patch['pre_value']})")
    writer = gguf.GGUFWriter(path=None, arch=arch)
    writer_managed = {"GGUF.version", "GGUF.tensor_count", "GGUF.kv_count", "general.architecture"}
    had_pre = False
    for name, item in reader.fields.items():
        if name in writer_managed:
            continue  # the writer emits these itself
        if name == "tokenizer.ggml.pre":
            had_pre = True
            writer.add_key_value(name, patch["pre_value"], gguf.GGUFValueType.STRING)
            continue
        vtype = item.types[0]
        if vtype == gguf.GGUFValueType.ARRAY:
            writer.add_key_value(name, item.contents(), gguf.GGUFValueType.ARRAY, sub_type=item.types[-1])
        else:
            writer.add_key_value(name, item.contents(), vtype)
    if not had_pre:
        # upstream omitted the kv entirely (llama.cpp would fall back to the 'default'
        # pre, which is not this tokenizer's true pre) — add it
        writer.add_key_value("tokenizer.ggml.pre", patch["pre_value"], gguf.GGUFValueType.STRING)
    for tensor in reader.tensors:
        writer.add_tensor(tensor.name, tensor.data, raw_dtype=tensor.tensor_type)
    tmp = target.with_suffix(".tmp")
    writer.write_header_to_file(path=str(tmp))
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    got_hash, got_size = sha256_and_size(tmp)
    if patch.get("sha256"):
        if got_hash != patch["sha256"] or got_size != int(patch["size_bytes"]):
            print(f"fetch_model: patched artifact MISMATCH: sha256={got_hash} size={got_size} "
                  f"(expected {patch['sha256']}, {patch['size_bytes']})", file=sys.stderr)
            tmp.unlink(missing_ok=True)
            return False
    else:
        # first run: report the freshly computed pin so it can be recorded in the manifest
        print(f"fetch_model: PATCH_PIN sha256={got_hash} size_bytes={got_size} "
              f"(record this in scripts/model_manifest.json -> patch)")
        tmp.replace(target)
        return True
    tmp.replace(target)
    print(f"fetch_model: patched artifact VERIFIED: {patch['output_file']}")
    return True


def fetch_snapshot(entry: dict) -> bool:
    base = MODELS_DIR / entry["repo"].split("/")[-1]
    for f in entry["files"]:
        url = f"https://huggingface.co/{entry['repo']}/resolve/{entry['revision']}/{f['path']}"
        if not fetch_verified(url, base / f["path"], f["sha256"], int(f["size_bytes"])):
            return False
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--candidate", action="append", default=[],
                    help="also fetch this candidates.<name> entry (repeatable; host bench)")
    ap.add_argument("--list", action="store_true", help="list manifest entries and exit")
    args = ap.parse_args(argv)

    manifest = load_manifest()
    if args.list:
        for role, entry in manifest["roles"].items():
            print(f"role {role}: {entry.get('repo', entry.get('kind'))}")
        for name, entry in manifest["candidates"].items():
            print(f"candidate {name}: {entry.get('repo', entry.get('kind'))}")
        return 0

    ok = True
    for role, entry in manifest["roles"].items():
        print(f"== role: {role} ==")
        if entry.get("kind") == "baseline" or role == "answer" and entry.get("url") is None:
            print(f"fetch_model: role {role} needs no download")
            continue
        if "files" in entry:
            ok = fetch_snapshot(entry) and ok
        elif "url" in entry:
            ok = fetch_single(entry) and ok
        else:
            print(f"fetch_model: role {role} needs no download")
    for name in args.candidate:
        entry = manifest["candidates"].get(name)
        if entry is None:
            print(f"fetch_model: unknown candidate {name}", file=sys.stderr)
            return 1
        print(f"== candidate: {name} ==")
        if entry.get("kind") == "baseline":
            print("fetch_model: baseline needs no download")
            continue
        if "files" in entry:
            ok = fetch_snapshot(entry) and ok
        else:
            ok = fetch_single(entry) and ok
    print("fetch_model: OK" if ok else "fetch_model: FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
