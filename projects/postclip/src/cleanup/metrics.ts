/**
 * Cleanup-quality metrics (plan "Fixtures and metrics"): body-token F1 vs
 * gold, chrome leakage rate, and fabricated-token rate, over word tokens
 * with OCR-tolerant fuzzy matching (the plan's faithfulness guard uses
 * "fuzzy match for OCR variants"; these metrics separate cleanup quality
 * from OCR noise the same way).
 *
 * Definitions (recorded with the numbers in docs/evidence/S1/metrics.md):
 *  - token: a maximal run of letters/digits (plus internal ' _ - . apostrophes),
 *    lowercased. Emoji are not word tokens.
 *  - fuzzyMatch(a, b): equal, or Levenshtein distance <= 1 for tokens of
 *    length >= 4, <= 2 for length >= 8 (OCR variants like "verdffentlicht"
 *    vs "veröffentlicht" are cleanup-irrelevant noise).
 *  - bodyTokenF1(output, goldBody): multiset match between output tokens and
 *    gold body tokens; F1 = 2PR/(P+R).
 *  - chromeLeakageRate(output, goldBody, goldChrome): the fraction of gold
 *    chrome tokens that appear in the output while NOT being explained by
 *    gold body content (a chrome token that also occurs in the body, like
 *    "Share" in "happy to share the runbook", is content, not a leak).
 *  - fabricatedTokenRate(output, rawInput): the fraction of output tokens
 *    that are not traceable (fuzzy) to any token of the raw input the
 *    cleanup was given — cleanup inventing words, not OCR misreading them.
 */

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu);
  return matches ? [...matches] : [];
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
}

export function fuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 8) return levenshtein(a, b) <= 2;
  if (minLen >= 4) return levenshtein(a, b) <= 1;
  return false;
}

/** Greedy multiset matching: how many gold tokens found an unconsumed
 *  fuzzy-matching output token. */
function matchCount(gold: string[], output: string[]): number {
  const consumed = new Array<boolean>(output.length).fill(false);
  let matched = 0;
  for (const g of gold) {
    for (let i = 0; i < output.length; i++) {
      if (!consumed[i] && fuzzyMatch(g, output[i])) {
        consumed[i] = true;
        matched++;
        break;
      }
    }
  }
  return matched;
}

export function bodyTokenF1(output: string, goldBody: string): number {
  const out = tokenize(output);
  const gold = tokenize(goldBody);
  if (gold.length === 0) return out.length === 0 ? 1 : 0;
  if (out.length === 0) return 0;
  const matched = matchCount(gold, out);
  const precision = matched / out.length;
  const recall = matched / gold.length;
  return (2 * precision * recall) / (precision + recall);
}

export function chromeLeakageRate(output: string, goldBody: string, goldChrome: string[]): number {
  const out = tokenize(output);
  const body = tokenize(goldBody);
  const chrome = goldChrome.flatMap((c) => tokenize(c));
  if (chrome.length === 0) return 0;
  let leaked = 0;
  for (const c of chrome) {
    const inBody = body.some((b) => fuzzyMatch(c, b));
    const inOutput = out.some((o) => fuzzyMatch(c, o));
    if (!inBody && inOutput) leaked++;
  }
  return leaked / chrome.length;
}

export function fabricatedTokenRate(output: string, rawInput: string): number {
  const out = tokenize(output);
  const input = tokenize(rawInput);
  if (out.length === 0) return 0;
  let untraceable = 0;
  for (const o of out) {
    if (!input.some((i) => fuzzyMatch(o, i))) untraceable++;
  }
  return untraceable / out.length;
}
