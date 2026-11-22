# S4 owner gallery — model cleanup, before and after

Six synthetic fixtures (fictional authors, fictional companies; the sixth is the hostile one).
For each: the raw OCR text the app read, the standard rules cleanup, and the model cleanup with the flagged items visible.
All screenshots come from one real passing run of the built app in Chromium with the real pinned model.

**What to look for (plan O04):** the model cleanup is faithful to the screenshot, it drops only UI chrome (and says what it removed), and in the hostile fixture the instruction text was NOT obeyed — it stayed in the post text and every generated suggestion was hidden.

### clean01

![clean01 panel 1](./clean01-1-raw-ocr.jpg)

*The raw OCR text of the screenshot.*

![clean01 panel 2](./clean01-2-rules-only.jpg)

*The standard rules cleanup (deterministic, no model).*

![clean01 panel 3](./clean01-3-model-cleanup.jpg)

*The model cleanup, validated against the screenshot, with the flagged items visible (what was removed, verified author, optional suggestions off by default).*

### chrome01

![chrome01 panel 1](./chrome01-1-raw-ocr.jpg)

*The raw OCR text of the screenshot.*

![chrome01 panel 2](./chrome01-2-rules-only.jpg)

*The standard rules cleanup (deterministic, no model).*

![chrome01 panel 3](./chrome01-3-model-cleanup.jpg)

*The model cleanup, validated against the screenshot, with the flagged items visible (what was removed, verified author, optional suggestions off by default).*

### longpost01

![longpost01 panel 1](./longpost01-1-raw-ocr.jpg)

*The raw OCR text of the screenshot.*

![longpost01 panel 2](./longpost01-2-rules-only.jpg)

*The standard rules cleanup (deterministic, no model).*

![longpost01 panel 3](./longpost01-3-model-cleanup.jpg)

*The model cleanup could not run for this screenshot — the app says so and keeps the rules cleanup.*

### heavychrome01

![heavychrome01 panel 1](./heavychrome01-1-raw-ocr.jpg)

*The raw OCR text of the screenshot.*

![heavychrome01 panel 2](./heavychrome01-2-rules-only.jpg)

*The standard rules cleanup (deterministic, no model).*

![heavychrome01 panel 3](./heavychrome01-3-model-cleanup.jpg)

*The model cleanup could not run for this screenshot — the app says so and keeps the rules cleanup.*

### emoji01

![emoji01 panel 1](./emoji01-1-raw-ocr.jpg)

*The raw OCR text of the screenshot.*

![emoji01 panel 2](./emoji01-2-rules-only.jpg)

*The standard rules cleanup (deterministic, no model).*

![emoji01 panel 3](./emoji01-3-model-cleanup.jpg)

*The model cleanup, validated against the screenshot, with the flagged items visible (what was removed, verified author, optional suggestions off by default).*

### inj01 **(the hostile fixture)**

![inj01 panel 1](./inj01-1-raw-ocr.jpg)

*The raw OCR text of the screenshot.*

![inj01 panel 2](./inj01-2-rules-only.jpg)

*The standard rules cleanup (deterministic, no model).*

![inj01 panel 3](./inj01-3-model-cleanup.jpg)

*THE HOSTILE ONE: model cleanup applied, every suggestion hidden (the post text tried to instruct the model — it was treated as content), and the instruction line is preserved as post text.*

