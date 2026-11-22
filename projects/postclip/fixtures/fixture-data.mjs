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
 * S1 expansion (plan "Fixtures and metrics"): German and Spanish posts for
 * the English-only language gate (A06), and the bad-input variants (blank,
 * tiny, huge ≥ 4000 px, corrupt PNG, non-image file, low-contrast, long
 * post, emoji/hashtag, heavy chrome, slight blur). Long lines in longpost01
 * wrap at the card width on purpose: the visual continuation lines always
 * start lowercase, exercising cleanup's line-break repair.
 */

const ACTION_ROW = 'Like Comment Share';

/** Localized UI furniture for non-English cards (the gate fixtures render
 *  with localized chrome, like a real localized app would). */
const LOCALES = {
  en: { actionRow: 'Like Comment Share', promoted: 'Promoted' },
  de: { actionRow: 'Gefällt mir Kommentieren Teilen', promoted: 'Gesponsert' },
  es: { actionRow: 'Me gusta Comentar Compartir', promoted: 'Promocionado' },
};

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
  de01: '42 Reaktionen · 9 Kommentare',
  de02: '64 Reaktionen · 2 Kommentare',
  de03: '137 Reaktionen · 9 Kommentare',
  es01: '51 reacciones · 3 comentarios',
  es02: '77 reacciones · 4 comentarios',
  emoji01: '220 reactions · 31 comments',
  longpost01: '98 reactions · 5 comments',
  lowcontrast01: '34 reactions · 6 comments',
  blur01: '12 reactions · 1 comment',
  huge01: '42 reactions · 9 comments',
  heavychrome01: '1,208 reactions · 89 comments',
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
  {
    id: 'de01',
    kind: 'lang-de',
    theme: 'light',
    locale: 'de',
    author: 'Lukas Berger',
    handle: '@lukas-berger',
    time: '3 Std.',
    body: [
      'Heute haben wir unsere erste offline-first Version veröffentlicht.',
      'Kein Cloud-Zugriff, keine Konten, nur ein lokaler Cache, der nie lügt.',
      'Welche App habt ihr zuletzt in einem Tunnel benutzt? #buildinpublic',
    ],
    promoted: false,
  },
  {
    id: 'de02',
    kind: 'lang-de',
    theme: 'dark',
    locale: 'de',
    author: 'Anja Schubert',
    handle: '@anja-schreibt',
    time: '6 Std.',
    body: [
      'Debugging-Story aus dieser Woche: ein Cache, der zu schnell ablief,',
      'eine Uhr, die um 90 Sekunden log, und ein sehr geduldiger SRE.',
      'Ursache? Zwei Dienste waren sich nicht einig, was \u201ejetzt\u201c bedeutet. #postmortem',
    ],
    promoted: false,
  },
  {
    id: 'de03',
    kind: 'lang-de',
    theme: 'light',
    locale: 'de',
    author: 'Jonas Weber',
    handle: '@jonasw',
    time: '1 Tag',
    body: [
      'Drei Lehren aus dem Refactoring unserer Legacy-Ingest-Pipeline:',
      '1. Erst das Schema aufschreiben, bevor man einen Handler anfasst.',
      '2. Doppelt so viel Code löschen wie man hinzufügt.',
      '3. Ein flatternder Test ist ein Vorfall, den man zweimal haben darf.',
      'Die Pipeline verarbeitet nun einen Tag Traffic in elf Minuten.',
    ],
    promoted: false,
  },
  {
    id: 'es01',
    kind: 'lang-es',
    theme: 'light',
    locale: 'es',
    author: 'Elena Ruiz',
    handle: '@elena-ruiz',
    time: '2 h',
    body: [
      'Hoy publicamos nuestra primera versión offline-first.',
      'Sin nube, sin cuentas, solo una memoria local que nunca miente.',
      '¿Cuál fue la última app que usaste en un túnel? #buildinpublic',
    ],
    promoted: false,
  },
  {
    id: 'es02',
    kind: 'lang-es',
    theme: 'dark',
    locale: 'es',
    author: 'Mateo Ortega',
    handle: '@mateo.ortega',
    time: '5 h',
    body: [
      'Tres lecciones de refactorizar un pipeline heredado:',
      '1. Escribe el esquema antes de tocar un solo handler.',
      '2. Borra el doble de código del que añades.',
      '3. Un test inestable es un incidente de producción que te pasa dos veces.',
    ],
    promoted: false,
  },
  {
    id: 'emoji01',
    kind: 'emoji',
    theme: 'light',
    author: 'Priya Nandan',
    handle: '@priya-n',
    time: '1h',
    body: [
      'Shipped the redesign today 🚀 Small team, big release.',
      'We cut load time in half and deleted three modals. ✨',
      'What should we open-source next? #buildinpublic #design',
    ],
    promoted: false,
  },
  {
    id: 'longpost01',
    kind: 'longpost',
    theme: 'light',
    scale: 1,
    author: 'Nadia Farouk',
    handle: '@nadia-f',
    time: '4h',
    body: [
      'A long one for the readers: here is everything we learned moving our ingestion pipeline to a single binary, and why the second attempt worked when the first one did not, and what we would do differently if we started over next quarter.',
      'Short version: delete first, measure second, celebrate third.',
      '1. We wrote down the schema before touching a handler.',
      '2. We deleted twice as much code as we added.',
      '3. We made the flaky tests fail loudly instead of silently retrying.',
      '4. We gave every service one owner with a name and a face.',
      '5. We stopped calling pages heroic and started calling them expensive.',
      'The pipeline now processes a full day of traffic in eleven minutes,',
      'down from four hours, with fewer incidents and better sleep for everyone.',
      'Ask me anything about the migration below. #engineering #longread',
    ],
    promoted: false,
  },
  {
    id: 'lowcontrast01',
    kind: 'lowcontrast',
    theme: 'light',
    lowcontrast: true,
    author: 'Ines Karlsson',
    handle: '@ines-k',
    time: '9h',
    body: [
      'Accessibility is not a feature you add at the end.',
      'It is a constraint you design with from the first sketch.',
      'Contrast ratios are a floor, not a ceiling. #a11y',
    ],
    promoted: false,
  },
  {
    id: 'blur01',
    kind: 'blur',
    theme: 'light',
    blur: true,
    author: 'Tomas Ricci',
    handle: '@tomas-ricci',
    time: '12h',
    body: [
      'Reading the OCR tea leaves this week taught me patience.',
      'A slight blur is fine for humans and a puzzle for machines.',
    ],
    promoted: false,
  },
  {
    id: 'huge01',
    kind: 'huge',
    theme: 'light',
    cardWidth: 1336,
    scale: 3,
    author: 'Maya Lindqvist',
    handle: '@maya-builds',
    time: '2h',
    body: [
      'This is a very large screenshot, and PostClip shrinks it before reading.',
      'The text stays readable after the downscale, and nothing is uploaded.',
    ],
    promoted: false,
  },
  {
    id: 'heavychrome01',
    kind: 'heavychrome',
    theme: 'light',
    heavy: true,
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
    id: 'blank01',
    kind: 'blank',
    theme: 'light',
    author: '',
    handle: '',
    time: '',
    body: [],
    promoted: false,
  },
  {
    id: 'tiny01',
    kind: 'tiny',
    theme: 'light',
    author: '',
    handle: '',
    time: '',
    body: [],
    promoted: false,
  },
  {
    id: 'corrupt01',
    kind: 'corrupt',
    theme: 'light',
    author: '',
    handle: '',
    time: '',
    body: [],
    promoted: false,
  },
  {
    id: 'nonimage01',
    kind: 'non-image',
    theme: 'light',
    author: '',
    handle: '',
    time: '',
    body: [],
    promoted: false,
  },
];

export function localeOf(fixture) {
  return LOCALES[fixture.locale ?? 'en'];
}

export function reactionLabel(id) {
  return REACTION_LABELS[id];
}

const BAD_INPUT_KINDS = ['blank', 'tiny', 'corrupt', 'non-image'];
export function isBadInputFixture(fixture) {
  return BAD_INPUT_KINDS.includes(fixture.kind);
}

/** UI furniture strings (what cleanup must remove), in reading order. */
export function chromeStrings(fixture) {
  if (isBadInputFixture(fixture)) return [];
  const locale = localeOf(fixture);
  const chrome = [fixture.handle, fixture.time, locale.actionRow.split(' '), reactionLabel(fixture.id)];
  if (fixture.promoted) chrome.unshift(locale.promoted);
  if (fixture.kind === 'chrome') chrome.push('Follow');
  if (fixture.heavy) chrome.push('Follow', 'Connect', '···');
  return chrome.flat();
}

/** The visible text, one entry per visual line, in reading order. */
export function ocrExpected(fixture) {
  if (isBadInputFixture(fixture)) return [];
  const locale = localeOf(fixture);
  const lines = [];
  if (fixture.promoted) lines.push(locale.promoted);
  if (fixture.heavy) lines.push('···');
  lines.push(fixture.author);
  lines.push(`${fixture.handle} · ${fixture.time}`);
  lines.push(...fixture.body);
  lines.push(reactionLabel(fixture.id));
  if (fixture.kind === 'chrome') {
    lines.push(`${locale.actionRow} Follow`);
  } else if (fixture.heavy) {
    lines.push(`${locale.actionRow} Follow Connect`);
  } else {
    lines.push(locale.actionRow);
  }
  return lines;
}

/** The gold `language` for a fixture: en/de/es for readable posts, `none`
 *  for the bad-input fixtures that never reach the language gate. */
export function goldLanguage(fixture) {
  if (fixture.locale === 'de') return 'de';
  if (fixture.locale === 'es') return 'es';
  if (isBadInputFixture(fixture)) return 'none';
  return 'en';
}

/** The app error state a bad-input fixture must produce (undefined = the
 *  fixture is expected to process successfully). */
export function expectedError(fixture) {
  switch (fixture.kind) {
    case 'blank':
      return 'no-text';
    case 'tiny':
      return 'tiny';
    case 'corrupt':
      return 'corrupt';
    case 'non-image':
      return 'non-image';
    default:
      return undefined;
  }
}
