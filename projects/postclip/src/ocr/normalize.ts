/**
 * Normalize raw OCR lines into review text.
 *
 * S0 contract (tested in normalizeOcrLines.test.ts):
 *  - each line is trimmed;
 *  - empty lines are dropped;
 *  - runs of spaces/tabs inside a line collapse to a single space;
 *  - the joined text uses `\n` between the surviving lines, no leading/trailing whitespace.
 */
export function normalizeOcrLines(rawLines: string[]): { lines: string[]; text: string } {
  const lines: string[] = [];
  for (const raw of rawLines) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (line.length > 0) lines.push(line);
  }
  return { lines, text: lines.join('\n') };
}
