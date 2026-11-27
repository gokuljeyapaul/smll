"""The answer engine: citation-native SLM over llama.cpp, with the prompt budget (A24),
the wall-clock timeout fallback, citation verification (A05) and the abstain gate (A06).

Pleias-RAG prompt family (from the model card / Pleias-RAG-Library, pinned revision):
  <|query_start|>{question}<|query_end|>
  <|source_start|><|source_id|>1 {text}<|source_end|> ...
  <|language_start|>
The model answers with reasoning sections and a final <|answer_start|>...<|answer_end|>
whose claims carry <ref name="N">literal quote</ref> citations."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from folderchat import cite

SECTION_RES = {
    "query_report": re.compile(r"<\|query_report_start\|>(.*?)<\|query_report_end\|>", re.DOTALL),
    "source_analysis": re.compile(r"<\|source_analysis_start\|>(.*?)<\|source_analysis_end\|>", re.DOTALL),
    "status": re.compile(r"<\|status_start\|>(.*?)<\|status_end\|>", re.DOTALL),
    "draft": re.compile(r"<\|draft_start\|>(.*?)<\|draft_end\|>", re.DOTALL),
    "answer": re.compile(r"<\|answer_start\|>(.*?)<\|answer_end\|>", re.DOTALL),
}
REFUSAL_MARKERS = ("refus", "not enough", "insufficient", "cannot answer", "does not contain")


@dataclass
class AskResult:
    mode: str = "slm"
    not_found: bool = False
    answer_text: str = ""
    citations: list[dict[str, Any]] = field(default_factory=list)
    unsupported_claims: list[str] = field(default_factory=list)
    closest_passages: list[dict[str, Any]] = field(default_factory=list)
    notice: str = ""
    fallback_notice: str | None = None
    timed_out: bool = False
    dropped_sources: int = 0
    latency_ttft_s: float | None = None
    latency_full_s: float | None = None
    raw: str = ""


class AnswerEngine:
    """Loads the pinned answer model through llama-cpp-python (CPU)."""

    def __init__(self, manifest: dict[str, Any], model_path: Any, *, n_threads: int | None = None,
                 timeout_s: float | None = None, max_tokens: int | None = None,
                 n_ctx: int | None = None, reserved_answer_tokens: int | None = None,
                 temperature: float = 0.1) -> None:
        entry = manifest["roles"]["answer"] if "roles" in manifest else manifest
        self.entry = entry
        self.model_path = str(model_path)
        self.prompt_family = entry.get("prompt_family", "pleias-rag")
        self.n_threads = n_threads
        self.temperature = temperature
        from folderchat.config import load_limits

        limits = load_limits()
        self.timeout_s = float(timeout_s) if timeout_s is not None else float(limits.answer_timeout_s)
        self.max_tokens = int(max_tokens) if max_tokens is not None else int(limits.answer_max_tokens)
        self.reserved_answer_tokens = (int(reserved_answer_tokens) if reserved_answer_tokens is not None
                                       else int(limits.reserved_answer_tokens))
        self._n_ctx_override = n_ctx
        self._llm: Any = None

    # ------------------------------------------------------------------ model
    def load(self) -> None:
        if self._llm is not None:
            return
        import llama_cpp

        n_ctx = self._n_ctx_override or int(self.entry.get("context_length") or 4096)
        self._llm = llama_cpp.Llama(
            model_path=self.model_path, n_ctx=n_ctx,
            n_threads=self.n_threads or 4, n_gpu_layers=0, verbose=False, seed=42)

    @property
    def context_length(self) -> int:
        if self._llm is None:
            return int(self._n_ctx_override or self.entry.get("context_length") or 4096)
        return int(self._llm.n_ctx())

    def token_count(self, text: str) -> int:
        self.load()
        return len(self._llm.tokenize(text.encode("utf-8"), special=True))

    def close(self) -> None:
        self._llm = None

    # ------------------------------------------------------------- assembling
    def assemble_prompt(self, question: str, passages: list[dict[str, Any]]) -> dict[str, Any]:
        """Greedy assembly within the context budget: whole passages only (never cut
        mid-passage), the answer budget always reserved; overflow passages are dropped
        and counted, and a notice is produced. Families differ only in the wrapper
        tokens around the same numbered sources."""
        prefix = f"<|query_start|>{question}<|query_end|>\n"
        if self.prompt_family == "occ-rag":
            prefix = f"<|im_start|>user\n{prefix}"
        included: list[dict[str, Any]] = []
        used = self.token_count(prefix)
        dropped = 0
        for p in passages:
            piece = f"<|source_start|><|source_id|>{len(included) + 1} {p['text']}<|source_end|>\n"
            cost = self.token_count(piece)
            if used + cost > self.context_length - self.reserved_answer_tokens - 8:
                dropped += 1
                continue
            used += cost
            included.append({**p, "source_id": len(included) + 1, "piece": piece})
        if self.prompt_family == "occ-rag":
            suffix = "<|im_end|>\n<|im_start|>assistant\n"
        else:
            suffix = "<|language_start|>\n"
        used += self.token_count(suffix)
        prompt = prefix + "".join(p["piece"] for p in included) + suffix
        notice = ""
        if dropped:
            notice = (f"Only part of the evidence fit the context: {len(included)} of "
                      f"{len(passages)} passages shown ({dropped} dropped).")
        return {"prompt": prompt, "included": included, "dropped": dropped, "notice": notice}

    # ------------------------------------------------------------- answering
    def ask(self, question: str, passages: list[dict[str, Any]], *, timeout_s: float | None = None,
            mode: str = "slm") -> AskResult:
        """Answer a question from the retrieved passages (A04/A05/A06 core path)."""
        timeout = float(timeout_s) if timeout_s is not None else self.timeout_s
        assembled = self.assemble_prompt(question, passages)
        included = assembled["included"]
        chunks_by_sid = {p["source_id"]: p["text"] for p in included}
        result = AskResult(notice=assembled["notice"], dropped_sources=assembled["dropped"])
        if not included:
            result.not_found = True
            result.closest_passages = _top(passages)
            return result

        self.load()
        deadline = time.monotonic() + timeout
        # Low-level token loop (the same path as the Pleias reference library): the
        # prompt is tokenized WITH special tokens so <|query_start|> and friends are
        # real control tokens, and each generated token is detokenized with
        # special=True so the answer's <|answer_start|>/<ref> markers survive to the
        # parser. create_completion() would strip them and break the format.
        prompt_ids = self._llm.tokenize(assembled["prompt"].encode("utf-8"), special=True)
        pieces: list[str] = []
        ttft: float | None = None
        started = time.monotonic()
        timed_out = False
        # Sampling: near-greedy with a light repeat penalty. The official
        # Pleias-RAG-Library reference defaults (temp=0.0, repetition_penalty=1.0)
        # were measured on these fixtures (probe, 2026-11-27): greedy decoding
        # degenerates into a citation-repetition loop and never reaches
        # <|answer_end|> within the token budget. temp=0.1 + repeat_penalty=1.05
        # terminates cleanly on the same prompts; the deviation and its measurement
        # are recorded in docs/evidence/S0/model_selection.md.
        stop_pieces = ["<|end_of_text|>", "<|im_end|>"] if self.prompt_family == "occ-rag" else ["<|end_of_text|>"]
        try:
            token_iter = self._llm.generate(prompt_ids, temp=self.temperature, top_p=0.95,
                                             repeat_penalty=1.05, reset=True)
            for i, tok in enumerate(token_iter):
                now = time.monotonic()
                if now > deadline:
                    timed_out = True
                    break
                if i >= self.max_tokens:
                    break
                if ttft is None:
                    ttft = now - started
                piece = self._llm.detokenize([tok], special=True).decode("utf-8", errors="replace")
                if piece in stop_pieces:
                    break
                pieces.append(piece)
        except Exception:  # noqa: BLE001 — any generation failure fails closed to passages
            timed_out = True
        result.latency_ttft_s = ttft
        result.latency_full_s = time.monotonic() - started
        if timed_out:
            result.timed_out = True
            result.not_found = True
            result.fallback_notice = (
                f"The answer timed out after {timeout:.0f} s — falling back to passage mode. "
                "No answer was generated.")
            result.closest_passages = _top(passages)
            return result

        raw = "".join(pieces)
        result.raw = raw
        if self.prompt_family == "pleias-rag":
            answer_section = _section(raw, "answer")
            if answer_section is None:
                result.not_found = True
                result.closest_passages = _top(passages)
                result.fallback_notice = "The model produced no answer section."
                return result
            if _looks_like_refusal(raw):
                result.not_found = True
                result.closest_passages = _top(passages)
                return result
        elif self.prompt_family == "occ-rag":
            # native OCC format: a status verdict, then the answer section
            status = _section(raw, "status")
            answer_section = _section(raw, "answer")
            if answer_section is None:
                m = re.search(r"<\|answer_start\|>(.*)", raw, re.DOTALL)
                answer_section = m.group(1).strip() if m else None
            low = raw.lower()
            if (status is not None and "unanswerable" in status.lower()) \
                    or answer_section is None or "not enough information" in low:
                result.not_found = True
                result.closest_passages = _top(passages)
                return result
        else:
            # instruction-prompted families: the whole generation is the answer draft
            answer_section = raw.strip()
            if not answer_section:
                result.not_found = True
                result.closest_passages = _top(passages)
                return result

        verified = cite.apply_citation_verifier(answer_section, chunks_by_sid)
        good = [c for c in verified.citations if c.verified]
        if not good:
            # abstain gate: no claim is grounded in a verified citation
            result.not_found = True
            result.closest_passages = _top(passages)
            result.unsupported_claims = verified.unsupported_claims
            return result

        result.answer_text = verified.clean_text
        result.citations = [
            {"n": c.display_number, "source_id": c.source_id, "quote": c.quote,
             "file": _find(passage_map=included, sid=c.source_id, key="file"),
             "page": _find(passage_map=included, sid=c.source_id, key="page"),
             "heading": _find(passage_map=included, sid=c.source_id, key="heading")}
            for c in good
        ]
        result.unsupported_claims = verified.unsupported_claims
        if result.dropped_sources:
            result.notice = assembled["notice"]
        return result


def _top(passages: list[dict[str, Any]], n: int = 3) -> list[dict[str, Any]]:
    return [{k: p.get(k) for k in ("file", "page", "heading", "text")} for p in passages[:n]]


def _find(passage_map: list[dict[str, Any]], sid: int, key: str) -> Any:
    for p in passage_map:
        if p["source_id"] == sid:
            return p.get(key)
    return None


def _section(raw: str, name: str) -> str | None:
    m = SECTION_RES[name].search(raw)
    return m.group(1).strip() if m else None


def _looks_like_refusal(raw: str) -> bool:
    low = raw.lower()
    return any(m in low for m in REFUSAL_MARKERS[:3]) and "<|answer_start|>" not in raw
