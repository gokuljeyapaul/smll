# S1 owner gallery — cleanup, edit, export, language gate, errors (O02)

Captured from a real passing run of the built app (real in-browser OCR on the
synthetic fixtures `clean01.png` and `de01.png`, phone viewport 390×844,
headless Chromium on the building machine). Screenshots are committed next to
this file.

1. **Review (cleaned)** — the text after real OCR + deterministic cleanup: UI
   chrome (author header, reaction counts, Like/Comment/Share) is gone, the
   post body reads naturally, the text is fully editable:
   [01-review-cleaned.png](01-review-cleaned.png)
2. **Edited** — the same review after adding my own line (edits stick and flow
   into Share, Copy and Export exactly): [02-edited.png](02-edited.png)
3. **Export menu** — .md / .txt / .json downloads of exactly the text on
   screen: [03-export-menu.png](03-export-menu.png)
4. **Non-English message** — a German screenshot is rejected with a clear,
   kind message and nothing is processed:
   [04-non-english.png](04-non-english.png)
5. **Too small** — a 64×64 image is rejected before OCR:
   [05-too-small.png](05-too-small.png)
6. **Corrupt image** — a damaged PNG file gets its own explanation:
   [06-corrupt.png](06-corrupt.png)
7. **Not an image** — a plain text file is recognized as not a screenshot:
   [07-not-an-image.png](07-not-an-image.png)
8. **No readable text** — a blank image says so clearly:
   [08-no-text.png](08-no-text.png)

You are confirming (issue tick-list): the cleaned text reads naturally, edits
stick, and the messages are clear and kind. Reply `O02 ok` or
`O02 no: <why>` in the slice issue.
