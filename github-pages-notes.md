# GitHub Pages deployment

The user requested GitHub Pages after the local savings-review feature was completed. This supersedes the earlier local-only hosting constraint.

GitHub Pages serves static files, so the published app reads PDFs on the user's device with the official Mozilla PDF.js 6.5.438 compatibility build. All reader assets and licenses are self-hosted and pinned by SHA-256; no CDN, API key, npm dependency or separate server is required. Browser imports run through the existing unmodified statement validator and reconcile against printed totals. Source excerpts and line numbers refer to the browser's position-based text extraction; Poppler line numbering remains unchanged in local mode. File SHA-256 IDs and ledger row IDs are identical across readers.

The public website includes only app assets and fictional examples. Selected PDFs are never uploaded. Extracted evidence and decisions remain in the existing `project-dad:v1` localStorage shape, scoped to the browser/origin; they are not transferred from localhost or synced across devices. The local Node server still uses Poppler and retains its original Host, origin and security-header checks.

## Changed files

| File | Purpose |
| --- | --- |
| `public/pdf-browser.mjs` | Read local File bytes with PDF.js, enforce size/page/time/text limits, hash, validate/reconcile and report failures. |
| `public/pdf-text.mjs` | Reconstruct ordered horizontal text lines from actual PDF text positions; no financial interpretation. |
| `public/workflow.mjs` | Share the existing file type/size checks between local and browser readers. |
| `public/app.mjs` | Select the browser reader in the static build; use module-relative sample URLs. |
| `public/index.html` | Relative module, stylesheet and sample URLs for repository subpaths. |
| `vendor/pdfjs/` | Official unmodified compatibility reader/worker/fonts/CMaps, notices, origin and integrity manifest. |
| `scripts/build-pages.mjs` | Verify vendor hashes; package only public assets, the shared validator, reader assets and fictional Cardiff PDF; add browser mode and a restrictive CSP. |
| `.github/workflows/pages.yml` | Test, build and deploy Pages on `main` pushes or manual dispatch. |
| `test/pages.test.mjs` | Six tests covering the static artifact, every supplied fixture, native/browser parity, rankings, overlaps, invalid input and positioned text. |
| `package.json` | Add `build:pages` and the six new tests; no dependency installation. |
| `.gitignore` | Ignore generated `dist/`; retain the fictional Cardiff test/deployment fixture. |
| `README.md`, `github-pages-notes.md` | Hosted workflow, data behavior, deployment instructions and this record. |

## Verification

- `npm test`: **33/33 pass** (all prior 27 plus six Pages tests).
- Every supplied readable PDF produces identical dates, original descriptors, integer cents, pages, reconciliation and SHA-256 file IDs under PDF.js and Poppler. Cardiff still gives **79 rows / $18,255.27 / $1,494.40 / 11 included**, ranked **Coastline, Hulu, Apple**, with deeply equal recommendation objects. Samples retain **29 rows / $653.07 / $162.49**; overlap plus partial retains **35 rows / $777.05 / $162.49**.
- A static-only server at `/project-dad/` passed the full desktop/phone browser workflow: picker, drag/drop, all source evidence, keyboard focus/ARIA, Keep/rename/clear/undo, reload, duplicate imports, sample confirmation/undo, partial and unsupported files. There were **zero upload/API/POST requests** and zero unexpected console errors.
- Checked **1280×900** and **390×844**, with no horizontal overflow, reading text at least 16 px and controls at least 44×44 px. Physical phones and screen-reader speech remain untested.
- Evidence is under `output/playwright/pages-*`, including desktop/phone screenshots, rendered copy and `pages-browser-checks.json`. These verification artifacts are not published with the app.

The source repository and Pages workflow are the deployment record. The final chat response supplies the verified live URL after deployment completes.
