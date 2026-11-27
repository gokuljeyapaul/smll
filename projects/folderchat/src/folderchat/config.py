"""Configuration: data dir, limits (validated against safe ranges), languages, model manifest."""
from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass
from typing import Any

import yaml

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG_DIR = PROJECT_ROOT / "config"


class ConfigError(Exception):
    """A configuration value is missing, unknown, or outside its safe range — refused at startup."""


def data_dir() -> pathlib.Path:
    """The app's data dir (D9): the SQLite index lives here. Overridable for tests/CI."""
    env = os.environ.get("FOLDERCHAT_DATA_DIR")
    if env:
        p = pathlib.Path(env)
    else:
        p = pathlib.Path.home() / ".local" / "share" / "folderchat"
    p.mkdir(parents=True, exist_ok=True)
    return p


def models_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("FOLDERCHAT_MODEL_DIR", PROJECT_ROOT / ".cache" / "models"))


def manifest_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("FOLDERCHAT_MANIFEST", PROJECT_ROOT / "scripts" / "model_manifest.json"))


# D12 safe ranges: a configured value outside its range is refused at startup.
LIMIT_RANGES: dict[str, tuple[int | float, int | float]] = {
    "max_file_mb": (1, 50),
    "max_pages": (10, 500),
    "max_extracted_chars": (10_000, 2_000_000),
    "max_files_per_source": (100, 20_000),
    "warn_files_per_source": (100, 20_000),
    "max_question_chars": (100, 1_000),
    "retrieve_top_k": (1, 20),
    "prompt_source_count": (1, 12),
    "answer_max_tokens": (64, 1536),
    "answer_timeout_s": (5, 600),
    "reserved_answer_tokens": (128, 2_048),
}


@dataclass(frozen=True)
class Limits:
    max_file_mb: int
    max_pages: int
    max_extracted_chars: int
    max_files_per_source: int
    warn_files_per_source: int
    max_question_chars: int
    retrieve_top_k: int
    prompt_source_count: int
    answer_max_tokens: int
    answer_timeout_s: int
    reserved_answer_tokens: int

    @property
    def max_file_bytes(self) -> int:
        return self.max_file_mb * 1024 * 1024


def _limits_yaml_path() -> pathlib.Path:
    env = os.environ.get("FOLDERCHAT_LIMITS")
    return pathlib.Path(env) if env else CONFIG_DIR / "limits.yaml"


def load_limits(**overrides: Any) -> Limits:
    """Load config/limits.yaml (defaults), overlay $FOLDERCHAT_LIMITS when set (a
    partial override file is allowed — anything it omits keeps the default), validate
    every value against its safe range, and return the frozen Limits. Raises
    ConfigError on anything out of range or unknown — the caller refuses to start."""
    raw: dict[str, Any] = {}
    default_path = CONFIG_DIR / "limits.yaml"
    if default_path.is_file():
        loaded = yaml.safe_load(default_path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ConfigError(f"{default_path}: limits file must be a mapping")
        raw = dict(loaded)
    path = _limits_yaml_path()
    if path != default_path and path.is_file():
        overlay = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(overlay, dict):
            raise ConfigError(f"{path}: limits file must be a mapping")
        raw.update(overlay)
    raw.update({k: v for k, v in overrides.items() if v is not None})

    problems: list[str] = []
    for key in raw:
        if key not in LIMIT_RANGES:
            problems.append(f"unknown limit: {key!r}")
    for key, (lo, hi) in LIMIT_RANGES.items():
        val = raw.get(key)
        if val is None:
            problems.append(f"missing limit: {key}")
            continue
        if not isinstance(val, int) or isinstance(val, bool) or not (lo <= val <= hi):
            problems.append(f"{key}={val!r} outside its safe range [{lo}, {hi}]")
    if problems:
        raise ConfigError("; ".join(problems))
    return Limits(**{k: raw[k] for k in LIMIT_RANGES})


@dataclass(frozen=True)
class Languages:
    default: str
    languages: dict[str, dict[str, Any]]


def load_languages() -> Languages:
    path = CONFIG_DIR / "languages.yaml"
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict) or "default" not in loaded or "languages" not in loaded:
        raise ConfigError(f"{path}: languages file must define 'default' and 'languages'")
    if loaded["default"] not in loaded["languages"]:
        raise ConfigError(f"{path}: default language {loaded['default']!r} is not defined")
    return Languages(default=loaded["default"], languages=loaded["languages"])


def load_manifest() -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads(manifest_path().read_text(encoding="utf-8"))
    return manifest


def resolve_model_path(entry: dict[str, Any]) -> pathlib.Path:
    """The artifact to load for a manifest entry: the recorded patch output when the
    entry declares one (build-time metadata correction, sha256-pinned), else the file."""
    patch = entry.get("patch")
    models = models_dir()
    if patch and (models / patch["output_file"]).is_file():
        resolved: pathlib.Path = models / patch["output_file"]
        return resolved
    direct: pathlib.Path = models / entry["file"]
    return direct
