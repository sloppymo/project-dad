# Project Dad

Project Dad turns fictional or properly redacted checking and credit card statements into a short, ranked savings review. Each suggestion explains what stood out, what you can do, and what you could save, with the original statement rows behind **Show charges**. The full list and monthly estimate remain available below the review.

## GitHub Pages

The browser-only version is published at **[sloppymo.github.io/project-dad](https://sloppymo.github.io/project-dad/)**. Open it, choose or drop PDFs, or click **Import 2 sample PDFs**. The fictional Cardiff example is available under **Download sample PDFs**. PDFs are read on the device using a pinned, self-hosted Mozilla PDF.js compatibility build; selected files are never uploaded. Imports and decisions stay in that browser's local storage and do not sync to other devices or the localhost version. The website itself is public.

The Pages build uses the same statement validation, printed-total reconciliation, ledger and recommendation rules as the local version. Browser text line numbers differ from Poppler's layout line numbers; dates, descriptors, amounts, source pages, file hashes and recommendations match across both readers. Only the two fictional statement layouts are supported; there is no OCR or real-issuer support added by hosting.

Pushes to `main` run all **33 tests**, verify the vendored reader's SHA-256 hashes, build `dist/`, and deploy it through `.github/workflows/pages.yml`. Re-run **Publish Project Dad** in GitHub Actions to redeploy manually. No npm install, API key, backend or paid service is needed. To create the static files locally, run:

```sh
npm run build:pages
```

Deploy only `dist/`. Its relative asset URLs work under a repository path such as `/project-dad/`. The normal `npm start` workflow below retains the local Node/Poppler reader and its existing security headers and Host checks. See [github-pages-notes.md](github-pages-notes.md) for the deployment changes and verification.

## Run locally

You need Node.js 22 or later and Poppler's `pdfinfo` and `pdftotext` commands on your PATH. Poppler is available as `poppler-utils` on Ubuntu/Debian and `poppler` in Homebrew. The app has zero npm dependencies.

On Ubuntu or Debian, install Poppler if needed.

```sh
sudo apt-get install poppler-utils
```

From the project folder, run the checks and start the app.

```sh
npm test
npm start
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Use this address consistently because the browser saves imports and decisions for that address and port.

To regenerate the bundled sample files and labeled rows, use `npm run fixtures` with Python 3 and ReportLab installed. The app and tests use the files already included.

## Try the workflow

1. Click **Import 2 sample PDFs** for a quick start. To exercise the normal picker with the same files, expand **Download sample PDFs**, download **Harbor checking, Jan to Mar** and **Summit credit card, Jan to Mar**, then select both with **Choose PDFs**. You can also drop PDFs onto **Drop statement PDFs here**, or activate that zone with Enter or Space to choose them.
2. Click **Find ways to save** to return to the review; it also opens automatically after an import. The samples give exactly two suggestions: **Lantern Streaming**, whose $12.99 → $15.99 increase could be reversed for **$3 a month / $36 a year before fees**, and **PAYPAL \*PINECONE**, which needs identifying before a saving can be estimated. **Show charges** reveals dates, positive charge amounts, original descriptors, file names, pages, lines and source excerpts. Firefly Water stays in the full list because its latest bill is below the 25% jump threshold; there is no video-overlap suggestion.
3. Expand **All repeating charges**. Expect **$162.49 per month** across three recurring expenses and one charge awaiting confirmation. Open **Lantern Streaming** to see the increase and use the decision controls. Click a source to see the captured statement excerpt and page number.
4. Choose **Renegotiate**, then reload the page and reopen the finding. The button remains selected. Use **Correct finding** to rename, confirm, or dismiss a finding. To test the math, confirm **PAYPAL \*PINECONE** as monthly. The estimate becomes **$171.48**. Use **Undo correction** to restore **$162.49**. Choosing **Keep** removes a charge from the savings review; **Clear choice** makes it eligible again.
5. Select the same credit card PDF again. It should say **Already imported**. Under **Transaction ledger**, the 29-row baseline has **$653.07** in purchase debits. The ledger lists six excluded card-payment rows, one excluded transfer and one unclear debit separately.
6. Try the overlap, partial and unsupported examples together. The card statement extends coverage through April and preserves both identical March 21 purchases. The partial checking file saves two readable rows and exposes the issue under **Statement coverage → Imported statements**. The unsupported file fails with a visible message. The scope names the partial statement, and the same two suggestions update their evidence. This batch leaves the estimate at **$162.49** and brings the purchase debits to **$777.05** across **35 rows**.
7. In a fresh browser profile, choose or drop **output/pdf/cardiff-credit-card-statement.pdf** alone. The review ranks **Coastline Fiber** ($119 in July and August, then $149 in September and October; restoring the old rate could save **$30 a month / $360 a year before fees**), **Hulu** (alongside Netflix and YouTube TV; canceling Hulu if rarely used could save **$227.88 over 12 months at the current price**), then the unidentified **$29.99 Apple charge** (no saving estimated). Golf stays in the full list. The baseline is **79 rows / $18,255.27** in purchase debits and **$1,494.40 a month / 11 included charges**, plus Apple awaiting confirmation.

| Finding | Latest charge | Contribution to estimate |
| --- | ---: | ---: |
| Northline Internet | $64.50 | $64.50 |
| Firefly Water District | $99.00 | $82.00, median of $73.00, $82.00 and $99.00 |
| Lantern Streaming | $15.99, up from $12.99 | $15.99 |
| PAYPAL \*PINECONE | $8.99 | Awaiting confirmation |

## Prototype decisions

The completed design document was unavailable. This implementation follows the build brief and the available design prompt. Its scope is one household, USD posted transactions and two fictional selectable-text layouts. The local HTTP server binds to the loopback interface. A phone can use the responsive layout when the app is running in an environment accessible to that phone.

- **Extraction.** Poppler returns layout-preserving text by PDF page. The interpreter accepts those pages and proposes an account, period and source-indexed rows. `validateStatement` verifies proposals against the independently read source and checks count and signed total against the printed summary. A future server-side interpreter can use the same boundary. New formats require a source verifier for their dates, amounts and row boundaries. The current parser accepts files up to 12 MB and 24 pages.
- **Ledger.** Expenses are negative integer cents. The ledger's purchase-debit subtotal is a gross sum of classified purchases. Credits and refunds are displayed separately. A SHA-256 file fingerprint detects exact reimports. Overlap uses the institution, account type and last four digits plus the posted date, original descriptor and amount. It preserves the largest observed number of identical rows in a statement and flags disagreements for review. This assumes the masked account identity distinguishes the household's accounts.
- **Recurrence.** The first pass looks for consecutive months with gaps of 21–40 days, using original descriptions with minor normalization. Automatic inclusion requires three matching charges from complete imports and evidence of a fixed amount, a clear price step, or a known bill type within the variable-amount threshold. Two observations and ambiguous processors go to review. The monthly estimate uses the latest fixed or stepped amount and the median of variable bills. Verified coverage beyond a missed billing window makes the result tentative. All timing and amount rules are provisional until tested on the intended issuers.
- **Savings review.** A pure browser module derives up to three suggestions on every render: price increases of at least $5 or 10%, overlapping video services, unidentified processor charges, then variable bills at least 25% and $5 above the median. A clean increase is checked before utility keywords without changing estimate calculations. The editable display-name catalog distinguishes video from music. The lowest-priced on-demand video member is a consistent example; the user decides which service they value or rarely use. Kept and dismissed findings are excluded. Recommendations are never saved, summed into a promised saving, or acted on by the app. See [savings-review-notes.md](savings-review-notes.md) for precise evidence rules, rendered results and verification.
- **Persistence.** The browser saves the ledger, source text, accepted and partial coverage, and review choices. The server deletes its temporary PDF copy after each read. The current batch displays transient progress and failures. A review choice is a reminder for the user and does not contact a provider or change money totals. Clear this site's data in the browser to remove the saved prototype records.

Before using full unredacted statements, validate the target issuers against labeled redacted samples, decide how access and deletion will work, and verify the deployment and data-handling choices. Scans, live OpenAI interpretation, sign-in, and long-term savings tracking are outside this version.
