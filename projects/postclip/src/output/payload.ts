/**
 * Build the outbound payloads for Share and Copy.
 *
 * S0 contract (tested in payload.test.ts):
 *  - the Web Share payload's `text` is EXACTLY the review text, character for character;
 *  - the payload carries the fixed title "PostClip";
 *  - Copy writes the exact review text to the clipboard.
 */
export function buildSharePayload(reviewText: string): ShareData {
  return { title: 'PostClip', text: reviewText };
}

export async function copyReviewText(reviewText: string): Promise<void> {
  await navigator.clipboard.writeText(reviewText);
}
