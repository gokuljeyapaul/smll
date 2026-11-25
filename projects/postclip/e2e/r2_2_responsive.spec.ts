import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * A42 (R2-2, web — Chromium AND WebKit): the mobile-first responsive
 * layout. The viewport matrix the issue demands — 320×568, 390×844,
 * 768×1024, 1280×800 — with, at every size:
 *   * NO horizontal overflow (document scrollWidth never exceeds the
 *     viewport),
 *   * the primary action visible and tappable (bounding-box inside the
 *     viewport, touch target >= 44 px),
 * in BOTH color schemes on the home screen, and on the result screen via
 * a real OCR run resized through the same matrix (one OCR per engine;
 * resizing the same page exercises the fluid layout, not a new read).
 */
const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
];

interface Overflow {
  scrollWidth: number;
  innerWidth: number;
}

async function overflowOf(page: Page): Promise<Overflow> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

/** No horizontal overflow at this viewport. */
async function expectNoHorizontalOverflow(page: Page, vpName: string, where: string) {
  const o = await overflowOf(page);
  expect(
    o.scrollWidth,
    `${where}: no horizontal overflow at ${vpName} (scrollWidth <= innerWidth)`,
  ).toBeLessThanOrEqual(o.innerWidth + 1);
}

/** The locator is visible, fully inside the viewport, and a >= 44 px tall
 *  touch target (the issue's tappable bounding-box check). */
async function expectTappable(
  loc: Locator,
  vpName: string,
  viewport: { width: number; height: number },
) {
  const box = await loc.boundingBox();
  expect(box, `the primary action has a bounding box at ${vpName}`).toBeTruthy();
  expect(box!.height, `touch target >= 44 px tall at ${vpName}`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `fully inside the viewport (left) at ${vpName}`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `fully inside the viewport (top) at ${vpName}`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `fully inside the viewport (right) at ${vpName}`).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(
    box!.y + box!.height,
    `fully inside the viewport (bottom) at ${vpName}`,
  ).toBeLessThanOrEqual(viewport.height + 1);
}

test('a42_home_screen_no_overflow_and_tappable_primary_action_at_every_viewport', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Both color schemes (the issue: light and dark both fine).
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      const choose = page.getByRole('button', { name: 'Choose screenshot' });
      await expect(choose, `${vp.name} (${scheme}): the home screen's primary action renders`).toBeVisible();
      await expectNoHorizontalOverflow(page, vp.name, `home (${scheme})`);
      await expectTappable(choose, vp.name, vp);
      // The drop zone (the home screen's main surface) is inside the frame too.
      await expect(page.getByTestId('dropzone')).toBeVisible();
    }
  }
});

test('a42_result_screen_fluid_through_the_viewport_matrix_one_real_read', async ({ page }) => {
  test.setTimeout(360_000);
  // One real in-browser OCR (the fixture is read once); the resize matrix
  // then walks the SAME result page through every viewport — the fluid
  // layout responds, nothing re-reads.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.setInputFiles('#file-input', 'fixtures/images/clean01.png');
  await expect(page.getByRole('heading', { name: 'Your text' })).toBeVisible({ timeout: 180_000 });
  // Determinism: the Review screen renders during READING too — the heading
  // alone is not the result. The resize matrix must run on the RESULT.
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, {
      timeout: 120_000,
      message: 'the real OCR result is on screen before the resize matrix',
    })
    .toBeGreaterThan(40);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const copy = page.locator('#copy-btn');
    await expect(copy, `${vp.name}: the Copy action is on the result screen`).toBeVisible();
    await expectNoHorizontalOverflow(page, vp.name, 'result');
    await expectTappable(copy, vp.name, vp);
    // The editable text stays usable: no fixed width poking out.
    const textBox = await page.locator('#review-text').boundingBox();
    expect(
      textBox,
      `${vp.name}: the text box has a box`,
    ).toBeTruthy();
    expect(textBox!.x + textBox!.width, `${vp.name}: the text box fits the width`).toBeLessThanOrEqual(
      vp.width + 1,
    );
  }
});
