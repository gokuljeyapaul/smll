/**
 * Fixture definitions — the single source of truth for both the rendered
 * screenshots and the gold JSON. Everything here is synthetic: fictional
 * authors, fictional companies, no real people, brands, logos or marks.
 *
 * `body` is the post text (what cleanup must keep), `chrome` is UI furniture
 * (what cleanup must remove), and `ocr_expected` is the visible text in
 * reading order, ONE ENTRY PER VISUAL LINE (how the card actually renders:
 * the handle+time meta line is one line; the action row is one band).
 *
 * Emoji/blur/rotation variants arrive with the later-slice fixture expansion
 * (plan: variants ≥ 40 by S4); the S0 set is plain-text posts so the clean-set
 * OCR bar measures text reading, not emoji glyph handling.
 */

const ACTION_ROW = 'Like Comment Share';

export const REACTION_LABELS = {
  clean01: '42 reactions · 9 comments',
  clean02: '137 reactions · 9 comments',
  clean03: '51 reactions · 3 comments',
  clean04: '8 reactions',
  clean05: '220 reactions · 31 comments',
  clean06: '77 reactions · 4 comments',
  dark01: '64 reactions · 2 comments',
  dark02: '98 reactions · 5 comments',
  chrome01: '1,208 reactions · 89 comments',
  chrome02: '342 reactions · 44 comments',
};

export const FIXTURES = [
  {
    id: 'clean01',
    kind: 'clean',
    theme: 'light',
    author: 'Maya Lindqvist',
    handle: '@maya-builds',
    time: '2h',
    body: [
      'Shipped our first offline-first release today.',
      'No cloud, no accounts, just a local cache that never lies.',
      'What is the last app you used that worked in a tunnel? #buildinpublic #offline',
    ],
    promoted: false,
  },
  {
    id: 'clean02',
    kind: 'clean',
    theme: 'light',
    author: 'Devon Park',
    handle: '@devon.park',
    time: '5h',
    body: [
      'Three lessons from refactoring a legacy ingest pipeline:',
      '1. Write the schema down before touching a single handler.',
      '2. Delete twice as much code as you add.',
      '3. A flaky test is a production incident you get to have twice.',
      'The pipeline now processes a day of traffic in eleven minutes.',
      'Ask me anything about the migration — happy to share the runbook. #engineering #refactor',
    ],
    promoted: false,
  },
  {
    id: 'clean03',
    kind: 'clean',
    theme: 'light',
    author: 'Amara Osei',
    handle: '@amaraosei',
    time: '1d',
    body: [
      'Hiring update from Brightpath Labs:',
      '• Senior platform engineer (Rust, distributed storage)',
      '• Product designer (privacy-first interfaces)',
      '• Applied researcher (small language models)',
      'We read every application ourselves. No keyword filters. #hiring',
    ],
    promoted: false,
  },
  {
    id: 'clean04',
    kind: 'clean',
    theme: 'light',
    author: 'Felix Brandt',
    handle: '@felixb',
    time: '4h',
    body: ['The best commit message is the one a tired colleague reads in six months and still understands.'],
    promoted: false,
  },
  {
    id: 'clean05',
    kind: 'clean',
    theme: 'light',
    author: 'Priya Raman',
    handle: '@priya-r',
    time: '8h',
    body: [
      'Reviewing telemetry dashboards this week taught me one thing:',
      'a chart nobody looks at is just a very expensive screenshot.',
      'Deleting beats maintaining. What did you delete recently? #observability',
    ],
    promoted: false,
  },
  {
    id: 'clean06',
    kind: 'clean',
    theme: 'light',
    author: 'Iris Tan',
    handle: '@iris.codes',
    time: '3h',
    body: [
      'New writeup: how we fit a document pipeline into 40 MB of WebAssembly.',
      'The trick was not a clever algorithm — it was deleting four features nobody opened.',
    ],
    promoted: false,
  },
  {
    id: 'dark01',
    kind: 'dark',
    theme: 'dark',
    author: 'Lena Fischer',
    handle: '@lenaf',
    time: '6h',
    body: [
      'Dark mode is not a theme, it is a promise about battery life.',
      'Our web app now repaints 34% less per scroll on OLED panels.',
    ],
    promoted: false,
  },
  {
    id: 'dark02',
    kind: 'dark',
    theme: 'dark',
    author: 'Marco D\u2019Souza',
    handle: '@marco-ds',
    time: '9h',
    body: [
      'Debugging story from this week: a cache that expired too fast,',
      'a clock that lied by 90 seconds, and one very patient SRE.',
      'Root cause? Two services disagreed about what \u201cnow\u201d means. #postmortem',
    ],
    promoted: false,
  },
  {
    id: 'chrome01',
    kind: 'chrome',
    theme: 'light',
    author: 'Sofia Marchetti',
    handle: '@sofia-m',
    time: '1h',
    promoted: true,
    body: [
      'Harborlight Systems is hiring a founding engineer for our storage team.',
      'You will own the replication layer end to end, from design to on-call.',
      'Fully remote, four-day weeks, real on-call compensation. Apply below.',
    ],
  },
  {
    id: 'chrome02',
    kind: 'chrome',
    theme: 'light',
    author: 'Noah Kessler',
    handle: '@noahk',
    time: '7h',
    promoted: false,
    body: [
      'Reminder: our community call on Thursday covers the new audit API.',
      'Bring your weirdest access-control bug. We will debug it live.',
    ],
  },
];

export function reactionLabel(id) {
  return REACTION_LABELS[id];
}

/** UI furniture strings (what cleanup must remove), in reading order. */
export function chromeStrings(fixture) {
  const chrome = [fixture.handle, fixture.time, ACTION_ROW.split(' '), reactionLabel(fixture.id)];
  if (fixture.promoted) chrome.unshift('Promoted');
  if (fixture.kind === 'chrome') chrome.push('Follow');
  return chrome.flat();
}

/** The visible text, one entry per visual line, in reading order. */
export function ocrExpected(fixture) {
  const lines = [];
  if (fixture.promoted) lines.push('Promoted');
  lines.push(fixture.author);
  lines.push(`${fixture.handle} · ${fixture.time}`);
  lines.push(...fixture.body);
  lines.push(reactionLabel(fixture.id));
  lines.push(fixture.kind === 'chrome' ? `${ACTION_ROW} Follow` : ACTION_ROW);
  return lines;
}
