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
  // Not yet implemented: returns the raw input. Tests define the behavior (RED first).
  return { lines: rawLines, text: rawLines.join('\n') };
}
