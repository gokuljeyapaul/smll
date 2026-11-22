// @vitest-environment node
/**
 * Strict JSON parsing + the at-most-ONE-retry rule (S4, A17). The primary
 * path is the runtime's JSON-schema CONSTRAINED DECODING (wllama's GBNF
 * grammar); this is the strict parser for outputs that still carry noise
 * (reasoning blocks, code fences, prose) and for runtimes without grammar
 * support — with AT MOST one re-generation attempt, then fallback.
 */
import { describe, expect, it } from 'vitest';
import { strictParseJson, MAX_GENERATION_ATTEMPTS } from './parse';

describe('strictParseJson (A17)', () => {
  it('parses a clean JSON object', () => {
    const r = strictParseJson('{"body":"hi","author":null,"source_app":null,"tags":[],"summary":"","removed_chrome":[]}');
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, unknown>).body).toBe('hi');
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const r = strictParseJson('```json\n{"body":"hi"}\n```');
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, unknown>).body).toBe('hi');
  });

  it('parses JSON surrounded by leading prose', () => {
    const r = strictParseJson('Here is the result: {"body":"hi"} — done.');
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, unknown>).body).toBe('hi');
  });

  it('parses JSON after a thinking/reasoning block the model emitted anyway', () => {
    const raw = 'Let me clean this up. The chrome lines are the header and the action row. {"body":"hi"}';
    const r = strictParseJson(raw);
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, unknown>).body).toBe('hi');
  });

  it('extracts the FIRST balanced JSON object when several appear', () => {
    const r = strictParseJson('{"body":"first"} trailing {"body":"second"}');
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, unknown>).body).toBe('first');
  });

  it('fails on plain prose with no JSON', () => {
    const r = strictParseJson('The post is about local-first apps.');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('fails on a truncated JSON object (never invents the missing half)', () => {
    const r = strictParseJson('{"body":"hi","tags":[');
    expect(r.ok).toBe(false);
  });

  it('the retry budget is exactly one re-generation (2 attempts total)', () => {
    expect(MAX_GENERATION_ATTEMPTS).toBe(2);
  });
});
