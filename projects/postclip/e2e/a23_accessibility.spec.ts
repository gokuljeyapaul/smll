import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * A23 (web — both engines): accessibility.
 *
 *  1. Automated axe checks (@axe-core/playwright) report no serious/critical
 *     violations on EVERY screen. The app ships BOTH color schemes
 *     (prefers-color-scheme, styles.css), so each screen is scanned in light
 *     AND dark emulation — a contrast failure in the dark palette is a real
 *     shipped violation. All violations (any impact) are printed for the
 *     evidence; the assertion binds the plan's bar: serious/critical = 0.
 *
 *  2. The main flow works with the keyboard alone: Tab/Enter through
 *     pick → review → edit → copy/share/export. The one non-automatable
 *     step is the OS file dialog the picker opens (plan testability map:
 *     native UI is browser chrome): the spec proves Enter on the focused
 *     Choose button OPENS the picker (observed on the hidden input's click),
 *     then substitutes the file the way every other spec does
 *     (setInputFiles) and continues keyboard-only from there. Focus
 *     visibility is asserted at every stop (O05's "focus is visible").
 */

interface ManifestImages {
  images: { id: string; file: string }[];
}

function fixturePath(id: string): string {
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as ManifestImages;
  const entry = manifest.images.find((i) => i.id === id);
  if (!entry) throw new Error(`fixture ${id} missing from the manifest`);
  return `fixtures/${entry.file}`;
}

type Violation = { id: string; impact: string | null; targets: string };

async function scan(page: Page, screenName: string): Promise<Violation[]> {
  const results = await new AxeBuilder({ page }).analyze();
  const all = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'none',
    targets: v.nodes.map((n) => n.target).join(','),
  }));
  if (all.length > 0) {
    console.log(`axe ${screenName}: ${all.map((v) => `[${v.impact}] ${v.id} (${v.targets})`).join(' | ')}`);
  } else {
    console.log(`axe ${screenName}: no violations`);
  }
  return all;
}

async function assertNoSeriousCritical(violations: Violation[], screenName: string) {
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious,
    `${screenName}: serious/critical axe violations must be empty (got ${JSON.stringify(serious)})`,
  ).toEqual([]);
}

/** The computed focus indicator must actually draw (O05: focus is visible). */
async function assertFocusVisible(page: Page, expectedId: string | null, label: string) {
  const info = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { desc: 'none', visible: false };
    const st = getComputedStyle(el);
    const outlineVisible = st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0;
    const shadowVisible = (st.boxShadow ?? '') !== 'none' && st.boxShadow !== '';
    return {
      desc: `${el.tagName}#${el.id || '-'} outline=${st.outlineStyle}/${st.outlineWidth}`,
      visible: outlineVisible || shadowVisible,
    };
  });
  if (expectedId !== null) {
    expect(info.desc, `${label}: focus must be on #${expectedId} (got ${info.desc})`).toContain(expectedId);
  }
  expect(info.visible, `${label}: the focused element must paint a visible focus indicator (${info.desc})`).toBe(true);
}

test('a23_axe_no_serious_or_critical_violations_every_screen', async ({ page }) => {
  test.setTimeout(240_000);
  // Screen 1: home (light + dark).
  await page.goto('/');
  await assertNoSeriousCritical(await scan(page, 'home (light)'), 'home (light)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await assertNoSeriousCritical(await scan(page, 'home (dark)'), 'home (dark)');

  // Screen 2: home with an error banner (bad input, fail closed).
  await page.setInputFiles('#file-input', fixturePath('corrupt01'));
  await expect(page.locator('.error-banner')).toBeVisible();
  await assertNoSeriousCritical(await scan(page, 'home error (dark)'), 'home error (dark)');
  await page.emulateMedia({ colorScheme: 'light' });
  await assertNoSeriousCritical(await scan(page, 'home error (light)'), 'home error (light)');

  // Screen 3: review with the extracted text (light + dark).
  await page.setInputFiles('#file-input', fixturePath('clean01'));
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 120_000 })
    .toBeGreaterThan(40);
  await assertNoSeriousCritical(await scan(page, 'review (light)'), 'review (light)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await assertNoSeriousCritical(await scan(page, 'review (dark)'), 'review (dark)');

  // Screen 4: review with the export menu open (its items are real buttons).
  await page.locator('#export-menu summary').click();
  await expect(page.locator('#export-txt')).toBeVisible();
  await assertNoSeriousCritical(await scan(page, 'review export menu open (dark)'), 'review export menu open (dark)');
  await page.emulateMedia({ colorScheme: 'light' });
  await assertNoSeriousCritical(
    await scan(page, 'review export menu open (light)'),
    'review export menu open (light)',
  );
});

test('a23_keyboard_only_main_flow_pick_review_copy_share_export', async ({ page }) => {
  test.setTimeout(240_000);
  // Spy on Web Share before anything loads (the OS sheet is not automatable).
  await page.addInitScript(() => {
    const w = window as unknown as { __shareCalls: { text?: string }[] };
    w.__shareCalls = [];
    Object.defineProperty(navigator, 'share', {
      value: (data: ShareData) => {
        w.__shareCalls.push(data);
        return Promise.resolve();
      },
      configurable: true,
      writable: true,
    });
  });

  await page.goto('/');

  // Tab to the Choose screenshot button and open the picker with Enter.
  // The OS dialog is browser chrome (plan testability map) — the spec
  // observes the picker OPEN (the hidden input receives the click), then
  // substitutes the file with setInputFiles and stays keyboard-only.
  await page.evaluate(() => {
    const w = window as unknown as { __pickerOpened: boolean };
    w.__pickerOpened = false;
    document.getElementById('file-input')?.addEventListener('click', () => {
      w.__pickerOpened = true;
    });
  });
  await page.keyboard.press('Tab');
  await assertFocusVisible(page, null, 'home: first Tab');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Choose screenshot');
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() => (window as unknown as { __pickerOpened: boolean }).__pickerOpened),
    'Enter on the focused Choose button must open the file picker',
  ).toBe(true);
  await page.setInputFiles('#file-input', fixturePath('clean01'));

  // Review appears with the real OCR text.
  await expect
    .poll(async () => (await page.locator('#review-text').inputValue()).length, { timeout: 120_000 })
    .toBeGreaterThan(40);

  // Tab to the review textarea and edit with the keyboard only.
  for (let i = 0; i < 10; i++) {
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    if (active === 'review-text') break;
    await page.keyboard.press('Tab');
  }
  await assertFocusVisible(page, 'review-text', 'review: textarea');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Keyboard edit.');
  const editedText = await page.locator('#review-text').inputValue();
  expect(editedText.endsWith('Keyboard edit.'), 'the keyboard edit must land in the review text').toBe(true);

  // Tab to Share, press Enter: the spy payload equals the edited text.
  for (let i = 0; i < 10; i++) {
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    if (active === 'share-btn') break;
    await page.keyboard.press('Tab');
  }
  await assertFocusVisible(page, 'share-btn', 'review: Share button');
  await page.keyboard.press('Enter');
  const shareCalls = await page.evaluate(() => {
    const w = window as unknown as { __shareCalls: { text?: string }[] };
    return w.__shareCalls;
  });
  expect(shareCalls).toHaveLength(1);
  expect(shareCalls[0]?.text).toBe(editedText);

  // Tab to Copy, press Enter: the real clipboard carries exactly the text.
  for (let i = 0; i < 10; i++) {
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    if (active === 'copy-btn') break;
    await page.keyboard.press('Tab');
  }
  await assertFocusVisible(page, 'copy-btn', 'review: Copy button');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Copied')).toBeVisible();
  if (test.info().project.name === 'chromium') {
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(editedText);
  } else {
    // WebKit grants no clipboard-read (recorded S2): real paste round-trip.
    await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = 'paste-probe-target';
      ta.setAttribute('aria-label', 'e2e paste probe');
      ta.style.cssText = 'position:fixed;bottom:4px;left:4px;width:160px;height:28px;z-index:9999;';
      document.body.appendChild(ta);
    });
    await page.locator('#paste-probe-target').focus();
    await page.keyboard.press('ControlOrMeta+V');
    const pasted = await page.locator('#paste-probe-target').inputValue();
    expect(pasted).toBe(editedText);
  }

  // Tab to the Export disclosure, open it with Enter, Tab to the .txt item,
  // press Enter: a real download lands with the edited text. Tab focuses the
  // <summary> inside the details, so the stop condition checks membership.
  for (let i = 0; i < 10; i++) {
    const active = await page.evaluate(
      () => document.activeElement?.closest('#export-menu')?.id ?? document.activeElement?.id ?? '',
    );
    if (active === 'export-menu') break;
    await page.keyboard.press('Tab');
  }
  await assertFocusVisible(page, null, 'review: Export summary');
  expect(
    await page.evaluate(() => document.activeElement?.closest('#export-menu')?.id ?? ''),
    'focus must be on the Export disclosure',
  ).toBe('export-menu');
  await page.keyboard.press('Enter');
  await expect(page.locator('#export-txt')).toBeVisible();
  for (let i = 0; i < 10; i++) {
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    if (active === 'export-txt') break;
    await page.keyboard.press('Tab');
  }
  await assertFocusVisible(page, 'export-txt', 'review: Export .txt item');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('postclip-export.txt');
  const content = readFileSync(await download.path(), 'utf-8');
  expect(content, 'the keyboard-triggered export must carry the edited text').toContain('Keyboard edit.');
});
