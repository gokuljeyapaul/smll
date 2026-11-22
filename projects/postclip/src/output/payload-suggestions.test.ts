// @vitest-environment node
/**
 * Suggestion toggles in the outbound payloads (S4 — plan "LLM safety
 * design" point 5, UC05): tags and summary are SUGGESTIONS — labelled,
 * default OFF, and EXCLUDED from every payload unless the user toggled
 * them on. The verified author is the only always-available extra, and it
 * too joins the payload only when included.
 *
 * A03's invariant (the share/copy payload text is EXACTLY the review text)
 * is the default-off contract; this suite pins the toggled-on shapes.
 */
import { describe, expect, it } from 'vitest';
import { buildSharePayload, buildExportPayload, type ShareExtras } from './payload';

const REVIEW = 'Shipped our first offline-first release today.';
const EXTRAS: ShareExtras = {
  author: 'Maya Lindqvist',
  tags: ['buildinpublic', 'offline'],
  summary: 'Shipped an offline-first release.',
};

describe('payload builders with suggestion toggles (S4, A03/A04 default-off)', () => {
  it('WITHOUT extras every payload is exactly the review text (A03 invariant)', () => {
    expect(buildSharePayload(REVIEW).text).toBe(REVIEW);
    expect(buildExportPayload(REVIEW, 'txt')).toBe(REVIEW);
    expect(buildExportPayload(REVIEW, 'md')).toBe(REVIEW);
    const json = JSON.parse(buildExportPayload(REVIEW, 'json')) as Record<string, unknown>;
    expect(json.text).toBe(REVIEW);
    expect(json.author).toBeUndefined();
    expect(json.tags).toBeUndefined();
    expect(json.summary).toBeUndefined();
  });

  it('extras WITHOUT any toggled field change nothing', () => {
    const none: ShareExtras = { author: null, tags: [], summary: null, includeAuthor: false, includeTags: false, includeSummary: false };
    expect(buildSharePayload(REVIEW, none).text).toBe(REVIEW);
    expect(buildSharePayload(REVIEW, EXTRAS).text).toBe(REVIEW); // toggles default to off
  });

  it('the author line joins the payload only when included', () => {
    const withAuthor = buildSharePayload(REVIEW, { ...EXTRAS, includeAuthor: true });
    expect(withAuthor.text).toContain(REVIEW);
    expect(withAuthor.text).toContain('Author: Maya Lindqvist');
    const without = buildSharePayload(REVIEW, { ...EXTRAS, includeAuthor: false });
    expect(without.text).not.toContain('Author');
  });

  it('tags join as a single labelled line only when included', () => {
    const withTags = buildSharePayload(REVIEW, { ...EXTRAS, includeTags: true });
    expect(withTags.text).toContain('Tags: #buildinpublic #offline');
    const without = buildSharePayload(REVIEW, { ...EXTRAS, includeTags: false });
    expect(without.text).not.toContain('Tags:');
  });

  it('the summary joins as a labelled line only when included', () => {
    const withSummary = buildSharePayload(REVIEW, { ...EXTRAS, includeSummary: true });
    expect(withSummary.text).toContain(`Summary: ${EXTRAS.summary}`);
    const without = buildSharePayload(REVIEW, { ...EXTRAS, includeSummary: false });
    expect(without.text).not.toContain('Summary:');
  });

  it('.txt and .md carry the same labelled block; .json carries structured fields', () => {
    const all = { ...EXTRAS, includeAuthor: true, includeTags: true, includeSummary: true };
    const txt = buildExportPayload(REVIEW, 'txt', all);
    expect(txt.startsWith(REVIEW)).toBe(true);
    expect(txt).toContain('Author: Maya Lindqvist');
    expect(txt).toContain('Tags: #buildinpublic #offline');
    const md = buildExportPayload(REVIEW, 'md', all);
    expect(md).toBe(txt);
    const json = JSON.parse(buildExportPayload(REVIEW, 'json', all)) as Record<string, unknown>;
    expect(json.text).toBe(REVIEW);
    expect(json.author).toBe('Maya Lindqvist');
    expect(json.tags).toEqual(['buildinpublic', 'offline']);
    expect(json.summary).toBe(EXTRAS.summary);
    // The metadata block is appended AFTER the review text, clearly separated.
    expect(txt.indexOf(REVIEW)).toBeLessThan(txt.indexOf('Author:'));
  });

  it('suggestion lines never leak into the payload when a toggle is off even if others are on', () => {
    const partial = { ...EXTRAS, includeAuthor: false, includeTags: true, includeSummary: false };
    const payload = buildSharePayload(REVIEW, partial);
    expect(payload.text).toContain('Tags: #buildinpublic #offline');
    expect(payload.text).not.toContain('Author:');
    expect(payload.text).not.toContain('Summary:');
  });
});
