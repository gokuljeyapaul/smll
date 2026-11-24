# O09 owner gallery — R2-3: the model downloads once (issue #78)

Real screenshots from a passing run of the test build (Chromium, phone viewports; one real download of the pinned model in a persistent profile; the full e2e matrix is in docs/evidence/R2-3/).

### The home screen (390x844), fresh profile: no model card, no download button — the only trace of the model is the collapsed "Advanced" section
![The home screen 390x844, fresh profile: no model card, no download button — the only trace of the model is the collapsed "Advanced" section](../owner/o09-390x844-home-model-not-offered.png)

### The Advanced section opened (390x844): the honest one-time-download offer, visible only because you chose to look
![The Advanced section opened 390x844: the honest one-time-download offer, visible only because you chose to look](../owner/o09-390x844-advanced-section-open.png)

### Volatile storage (390x844): the kind explanation replaces the download — no 397 MB that would be lost
![Volatile storage 390x844: the kind explanation replaces the download — no 397 MB that would be lost](../owner/o09-390x844-volatile-explanation.png)

### After closing and reopening the browser (390x844): "Tidy-up model ready (cached)" — remembered, no re-download, no download button
![After closing and reopening the browser 390x844: "Tidy-up model ready cached" — remembered, no re-download, no download button](../owner/o09-390x844-ready-cached-after-restart.png)

### The home screen (360x800), fresh profile: no model card, no download button — the only trace of the model is the collapsed "Advanced" section
![The home screen 360x800, fresh profile: no model card, no download button — the only trace of the model is the collapsed "Advanced" section](../owner/o09-360x800-home-model-not-offered.png)

### The Advanced section opened (360x800): the honest one-time-download offer, visible only because you chose to look
![The Advanced section opened 360x800: the honest one-time-download offer, visible only because you chose to look](../owner/o09-360x800-advanced-section-open.png)

### Volatile storage (360x800): the kind explanation replaces the download — no 397 MB that would be lost
![Volatile storage 360x800: the kind explanation replaces the download — no 397 MB that would be lost](../owner/o09-360x800-volatile-explanation.png)

### After closing and reopening the browser (360x800): "Tidy-up model ready (cached)" — remembered, no re-download, no download button
![After closing and reopening the browser 360x800: "Tidy-up model ready cached" — remembered, no re-download, no download button](../owner/o09-360x800-ready-cached-after-restart.png)

---

**What you confirm (reply `O09 ok` or `O09 no: <why>`):** the 397 MB download is never pushed at anyone; the model, once downloaded, is remembered across restarts; the ephemeral/lost-cache case is explained kindly.
