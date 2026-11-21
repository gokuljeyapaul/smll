/**
 * Build the outbound payloads for Share and Copy.
 *
 * S0 contract (tested in payload.test.ts):
 *  - the Web Share payload's `text` is EXACTLY the review text, character for character;
 *  - the payload carries the fixed title "PostClip";
 *  - Copy writes the exact review text to the clipboard.
 */
export function buildSharePayload(reviewText: string): ShareData {
  // Not yet implemented. Tests define the behavior (RED first).
  void reviewText;
  return { title: '', text: '' };
}

export async function copyReviewText(reviewText: string): Promise<void> {
  // Not yet implemented. Tests define the behavior (RED first).
  void reviewText;
}
