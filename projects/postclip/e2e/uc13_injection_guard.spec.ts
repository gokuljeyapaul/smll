import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MODEL_SERVER, startModelServer } from './helpers/model-server';

/**
 * UC13 / A16 (S4, web platform — Chromium AND WebKit): the injection
 * fixtures are treated as CONTENT — judged by the validator + marker
 * checks, never by eye. The attacker markers come from each fixture's gold
 * JSON (gold.injection.markers); the post text (including the
 * instruction-looking lines) must survive as content, and NO marker may
 * appear in any metadata field the app shows (tags, summary, author,
 * source_app, removed_chrome listing) — on the applied path because the
 * deterministic demotion stripped the suggestions, on the fallback path
 * because no model output is shown at all.
 */

interface Gold {
  id: string;
  kind: string;
  body: string[];
  injection?: { markers: string[] };
}

const INJECTION_IDS = ['inj01', 'inj02', 'inj03', 'inj04', 'inj05'];

function goldFor(id: string): Gold {
  return JSON.parse(readFileSync(`fixtures/gold/${id}.json`, 'utf-8')) as Gold;
}

interface LlmDebug {
  mode: 'off' | 'applied' | 'unavailable';
  modelText: string | null;
  deterministicText: string;
  author: string | null;
  tags: string[];
  summary: string | null;
  removedChrome: string[];
  latencyMs: number;
  attempts: number;
}

async function readDebug(page: Page): Promise<LlmDebug> {
  return page.evaluate(() => {
    const w = window as unknown as { __postclipLlmDebug?: LlmDebug };
    return w.__postclipLlmDebug as LlmDebug;
  });
}

test('uc13_injection_posts_are_content_never_obeyed', async ({ page, browserName }) => {
  test.setTimeout(1_800_000); // one model download + one wasm load + 5 real inferences (scheduling budget; measured worst case: a degenerate fixture burns the pipeline's fail-closed 240 s cap before falling back)
  await startModelServer();
  await page.goto(`/?testModelUrl=${MODEL_SERVER}/model`);
  await page.locator('#model-download-btn').click();
  await expect(page.locator('#model-ready')).toBeVisible({ timeout: 240_000 });
  // Bounded wait (fails fast and clear when the model-cleanup UI is absent,
  // instead of hanging in an unactionable check()).
  await page.locator('#llm-cleanup-toggle').waitFor({ timeout: 30_000 });
  await page.locator('#llm-cleanup-toggle').check();

  for (const id of INJECTION_IDS) {
    const gold = goldFor(id);
    const markers = gold.injection?.markers ?? [];
    expect(markers.length, `${id} gold must carry attacker markers`).toBeGreaterThan(0);

    await page.setInputFiles('#file-input', `fixtures/images/${id}.png`);
    await expect
      .poll(async () => (await page.locator('#review-text').inputValue()).length, {
        timeout: 150_000,
        message: `${id}: deterministic result first`,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => page.locator('#llm-status').getAttribute('data-state'), {
        timeout: 300_000,
        message: `${id}: model cleanup settles`,
      })
      .toMatch(/^(applied|unavailable)$/);

    const debug = await readDebug(page);
    const reviewText = await page.locator('#review-text').inputValue();

    // 1. The visible text is exactly the deterministic or the validated
    //    model result — never raw, unvalidated model text.
    expect(
      reviewText === (debug.mode === 'applied' ? debug.modelText : debug.deterministicText),
      `${id}: review text must be the shown, validated stage`,
    ).toBe(true);

    // 2. NO attacker marker in any metadata the app shows.
    const metadataFields: Record<string, unknown> = {
      author: debug.author,
      tags: debug.tags,
      summary: debug.summary,
      removedChrome: debug.removedChrome,
    };
    for (const [field, value] of Object.entries(metadataFields)) {
      const shown = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
      for (const marker of markers) {
        expect(
          shown.toLowerCase().includes(marker.toLowerCase()),
          `${id}: attacker marker "${marker}" must NEVER appear in metadata field "${field}" (got: ${shown})`,
        ).toBe(false);
      }
    }
    // And never in the suggestion DOM (which reflects the same data).
    // Bounded read: in fallback mode the section is not rendered at all, and
    // locator.textContent() has NO default timeout — without the bound this
    // would wait forever (the same missing-UI hang the RED addendum records).
    const suggestionDom = await page
      .locator('#llm-suggestions')
      .textContent({ timeout: 5_000 })
      .catch(() => null);
    if (suggestionDom !== null) {
      for (const marker of markers) {
        expect(suggestionDom.toLowerCase()).not.toContain(marker.toLowerCase());
      }
    }

    // 3. The instruction-looking post text is preserved AS CONTENT: the
    //    gold body's marker line must survive in the shown text (the
    //    injection line is a body line, not a command).
    for (const marker of markers) {
      expect(
        reviewText.toLowerCase().includes(marker.toLowerCase()),
        `${id}: the marker line is post content and must be preserved in the body`,
      ).toBe(true);
    }

    // 4. Output is schema-valid by construction: the debug record's mode is
    //    one of the two designed states, and the applied model text went
    //    through the deterministic validator (guard verdict recorded).
    console.log(
      `uc13 ${id} (${browserName}): mode=${debug.mode} attempts=${debug.attempts} latencyMs=${debug.latencyMs}`,
    );

    // Back to the home screen for the next fixture (the review screen has
    // no file input; the opt-in toggle persists across Start over).
    if (id !== INJECTION_IDS[INJECTION_IDS.length - 1]) {
      await page.getByRole('button', { name: 'Start over' }).click({ timeout: 30_000 });
      await page.locator('#llm-cleanup-toggle').waitFor({ timeout: 30_000 });
    }
  }
});
