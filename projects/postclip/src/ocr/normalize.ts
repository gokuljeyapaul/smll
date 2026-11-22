/**
 * Normalize raw OCR lines into review text.
 *
 * S0 contract (tested in normalizeOcrLines.test.ts):
 *  - each line is trimmed;
 *  - empty lines are dropped;
 *  - runs of spaces/tabs inside a line collapse to a single space;
 *  - the joined text uses `\n` between the surviving lines, no leading/trailing whitespace.
 *
 * S1 adds the pipeline's no-text error message (A07): OCR that produces no
 * text is a specific error state, never a silently empty review.
 */

/** The user-facing message when OCR found no text at all (blank image). */
export const NO_TEXT_MESSAGE =
  'No readable text was found in that image. If it is a screenshot of a post, try a larger or sharper capture.';

export function normalizeOcrLines(rawLines: string[]): { lines: string[]; text: string } {
  const lines: string[] = [];
  for (const raw of rawLines) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (line.length > 0) lines.push(line);
  }
  return { lines, text: lines.join('\n') };
}
