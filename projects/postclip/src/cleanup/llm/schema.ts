/**
 * The model cleanup output schema (S4 — plan "LLM safety design" point 2,
 * A17). Constrained to this exact shape, either by the runtime's JSON-schema
 * decoding (wllama's GBNF grammar) or by strict parsing + validation:
 *
 *   { body, author|null, source_app|null, tags[<=5], summary<=280, removed_chrome[] }
 *
 * Extra fields are rejected (never silently ignored): anything outside the
 * contract never reaches the user (A17 "schema-validated").
 */

/** Hard bounds the validator enforces on every field (fail-closed). */
export const SCHEMA_BOUNDS = {
  /** tags: at most 5 short suggestions. */
  maxTags: 5,
  /** summary: at most 280 characters (the plan's bound). */
  maxSummaryChars: 280,
  /** tags: each tag short enough to be a tag, not a sentence. */
  maxTagChars: 40,
  /** removed_chrome: at most 20 accounted removals. */
  maxRemovedChromeEntries: 20,
  /** body: never more than 1.5x the OCR text (catches runaway repetition). */
  maxBodyToOcrCharRatio: 1.5,
  /** body: never fewer than half the OCR tokens kept unaccounted (guard),
   * expressed as the precision bar below. */
  /** Faithfulness bar (plan point 3): body multiset precision vs OCR. */
  minBodyPrecision: 0.98,
} as const;

/** The validated model-cleanup result the app may show (after the guard). */
export interface LlmCleanupOutput {
  body: string;
  author: string | null;
  source_app: string | null;
  tags: string[];
  summary: string | null;
  removed_chrome: string[];
}

/** The raw model output, before any validation (shape unknown). */
export type RawModelOutput = unknown;

/**
 * The JSON Schema handed to the runtime for CONSTRAINED DECODING (A17:
 * "constrained decoding (grammar / JSON-schema decoding if the runtime
 * supports it)"). wllama (llama.cpp WASM) compiles this into a GBNF grammar
 * so the model can only emit text that parses against this schema.
 */
export const CLEANUP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string', description: 'The post body text, copied verbatim from the OCR text; UI chrome removed.' },
    author: { type: ['string', 'null'], description: 'The post author name as it appears in the text, or null.' },
    source_app: { type: ['string', 'null'], description: 'The app the screenshot is from, if named in the text, else null.' },
    tags: {
      type: 'array',
      maxItems: SCHEMA_BOUNDS.maxTags,
      items: { type: 'string' },
      description: 'Up to 5 short suggested tags drawn from the post content.',
    },
    summary: { type: 'string', description: 'A short summary of the post, at most 280 characters.' },
    removed_chrome: {
      type: 'array',
      items: { type: 'string' },
      description: 'Every UI-chrome line that was removed from the body, quoted.',
    },
  },
  required: ['body', 'author', 'source_app', 'tags', 'summary', 'removed_chrome'],
  additionalProperties: false,
} as const;
