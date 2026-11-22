/**
 * The S4 runtime selection decision, as a single committed constant.
 *
 * A19 (plan "GREEN: bars met, or the LLM ships disabled by default with
 * measured numbers and the deterministic baseline stays the default (a
 * valid completion)"): the decision is made BY MEASUREMENT (the browser
 * eval on real OCR output, docs/evidence/S4/model_selection.md +
 * llm-eval-chromium.json), never by preference. The constant below records
 * the outcome; the evidence records the numbers that decided it.
 *
 * S4 measurement result (see model_selection.md for the full table): the
 * pinned 0.6B model on the single-threaded WASM path did NOT beat the
 * deterministic baseline on cleanup quality (it keeps the author/meta
 * header chrome in the body: mean body-token F1 below the rules baseline,
 * chrome leakage far above the 2% bar) and a cleanup takes 60-130 s
 * (over the plan's 60 s WASM budget, A22). The LLM therefore ships
 * DISABLED BY DEFAULT: the user may still opt in per session (the
 * toggle), and every opt-in run goes through the same guards.
 */
export const LLM_CLEANUP_ENABLED_BY_DEFAULT = false;

/** The recorded A19 margin (filled by the eval; see model_selection.md). */
export const A19_DECISION_NOTE =
  'LLM cleanup ships disabled by default: the measured model-mode cleanup did not beat the deterministic baseline (kept header chrome in the body; slower). Numbers: docs/evidence/S4/model_selection.md.';
