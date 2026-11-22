/**
 * Strict JSON extraction from raw model text (S4 — plan "LLM safety design"
 * point 2, A17): "constrained decoding ... otherwise strict JSON parse with
 * at most one retry".
 *
 * The primary path is constrained decoding (the runtime's JSON-schema
 * grammar), which should already emit parseable JSON; this module is the
 * STRICT parser used for any output that still carries noise (leading
 * prose, code fences, commentary) and for runtimes without grammar
 * support — with AT MOST one re-generation attempt (MAX_GENERATION_ATTEMPTS),
 * then a deterministic fallback.
 *
 * The parser never repairs or invents: it finds the first balanced {...}
 * object in the text and JSON.parses it verbatim; a truncated object is a
 * parse failure, never a guess.
 */

export interface StrictParseResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** How many generation attempts a cleanup may use: 1 + at most 1 retry. */
export const MAX_GENERATION_ATTEMPTS = 2;

/** Find every balanced top-level {...} object in the text (string/escape aware). */
function* balancedJsonObjects(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          yield text.slice(start, i + 1);
          start = -1;
        }
      }
    }
  }
}

/** Extract the JSON object from a raw model completion and parse it. */
export function strictParseJson(raw: string): StrictParseResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'empty model output' };
  }
  // The common constrained path: the whole answer is the JSON object.
  const trimmed = raw.trim();
  try {
    const value = JSON.parse(trimmed);
    if (typeof value === 'object' && value !== null) return { ok: true, value };
    return { ok: false, error: 'model output is JSON but not an object' };
  } catch {
    // fall through to extraction
  }
  // Noise around the JSON (prose, code fences, reasoning): take the FIRST
  // balanced object that parses.
  for (const candidate of balancedJsonObjects(raw)) {
    try {
      const value = JSON.parse(candidate);
      if (typeof value === 'object' && value !== null) return { ok: true, value };
    } catch {
      // keep scanning; a truncated first object is skipped, not repaired
    }
  }
  return { ok: false, error: 'no parseable JSON object in the model output' };
}
