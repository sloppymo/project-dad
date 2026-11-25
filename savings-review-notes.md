# Ranked savings review

Built and verified November 25, 2026 using only the fictional PDFs and synthetic test documents.

## What was built

Imports automatically open the ranked review. **Find ways to save** re-derives it, focuses the heading and announces the count. The drop zone supports dragging and keyboard file selection. Each suggestion gives evidence, a user action, conditional savings and **Show charges** with file/page/line/excerpt evidence. Opening charges preserves button focus.

Below are the collapsed repeating-charge list and secondary estimate. Catalog names retain original descriptors; user renames win. Both review and estimate show account-specific coverage and partial filenames. The phone review precedes import in visual and keyboard order. No savings total is shown.

## Exact rules

All calculations use integer cents. Findings marked **Keep** or dismissed are excluded, as are findings with conflicting overlap rows. Results are ordered by tier, then the measure below, then stable finding ID to break ties. At most three appear across all imported accounts.

| Tier | Evidence required | Figure and ordering |
| --- | --- | --- |
| 1: price went up | A clean earlier run of at least two identical monthly charges followed by one or more identical higher charges. Consecutive calendar months, with 21–40 days between charges, and no covered missing billing window. Complete rows must independently establish both runs; the full observed pattern must agree. Increase is at least 500 cents **or** 10% of the earlier amount. This check precedes utility treatment. | `(current − earlier) × 12`, largest first. Earlier price is `baselineCents`; current price is `currentCents`. Copy says restoring the old rate is conditional and before fees. |
| 2: overlapping video | At least three eligible included video findings, each with at least three consecutive complete monthly rows and a completely sourced latest charge. Members must share an observed complete calendar month. Catalog kinds are **on-demand video** and **live TV**; music and news are excluded. Identical monthly groups and contained subgroups are consolidated. | The lowest-priced on-demand member is named, with finding ID breaking price ties. Its current price × 12 is conditional on canceling it, over 12 months at that price. Current price is also `baselineCents`. Distinct groups sort by this yearly figure, largest first. |
| 3: unidentified charge | An existing repeating finding matches the existing processor matcher: Apple, PayPal, SQ, Square or Stripe. Confirmation or a rename alone does not identify what the descriptor covers. A qualifying price increase takes precedence for that same finding. | No monthly/yearly savings figure (`null`). Larger current monthly charge first. Check the relevant purchase history or receipt. |
| 4: variable bill jumped | An existing variable finding with a confirmable monthly pattern has a latest bill at least 125% of its median **and** at least 500 cents above it. A clean price increase takes precedence. | No savings figure (`null`). Larger excess over the median first. Check usage or fees. `baselineCents` is the median. |

Partial-only evidence produces no tier 1 or tier 2 suggestion, even if the user confirms it as monthly. Partial rows can supplement complete support. Any recommendation using rows with no complete source explicitly says **“Based in part on an incomplete statement.”** Tiers 3 and 4 may use partial-only evidence with that label. One complete multi-cycle PDF can support multiple monthly observations; the code does not count files as months.

Objects retain stable `type:findingId` IDs, `findingId`, `accountId`, `baselineCents`, `currentCents` and supporting `rowIds`, grouped by service for video. They are never persisted. Storage remains `project-dad:v1`, version 1, with the same shape.

**Overlap assumption the user can override:** cheapest on-demand is only a consistent example, not evidence of viewing habits or value. The user chooses what to keep/cancel in the existing controls; Keep excludes that member. No new preference is stored.

## Cardiff output, copied from the browser

> Based on your Pacific Crest card ••7814, July 1 – October 31, 2026. Bills paid from other accounts aren't included.

1. **Call Coastline Fiber about the price.** You paid $119 in July and August, then $149 in September and October. Ask what changed and whether they'll restore your previous rate. If they do, that's $30 a month, or $360 a year before fees. **Show charges**
2. **Check whether you still use Hulu.** You pay $18.99 a month for Hulu alongside Netflix and YouTube TV. Check which of these video services you rarely open. If Hulu is the one you rarely open, canceling it would save $227.88 over 12 months at the current price. **Show charges**
3. **Identify the $29.99 Apple charge.** It appeared every month from July through October. Check your Apple purchase history to see what it covers. The description alone gives us too little to recommend canceling it or estimate a saving. **Show charges**

> You take any action yourself. Project Dad doesn't contact providers, cancel services or move money.

Secondary estimate: **$1,494.40 a month · 11 charges**, with one charge awaiting confirmation. Golf is present only in the full list. Coastline's rows are pages 1–4, line 24; Apple's are p1 L32, p2 L31, p3 L31, p4 L32. Hulu's disclosure includes all 12 Hulu/Netflix/YouTube TV rows, grouped by service and chronological within each group. Spotify is music and is excluded from that group.

## Sample output, copied from the browser

> Based on your Harbor Community Bank checking ••1185, January 1 – March 31, 2026; your Summit card ••2046, January 1 – March 31, 2026. Bills paid from other accounts aren't included.

1. **Call Lantern Streaming about the price.** You paid $12.99 in January and February, then $15.99 in March. Ask what changed and whether they'll restore your previous rate. If they do, that's $3 a month, or $36 a year before fees. **Show charges**
2. **Identify the $8.99 PAYPAL \*PINECONE charge.** It appeared every month from January through March. Check your PayPal activity to see what it covers. The description alone gives us too little to recommend canceling it or estimate a saving. **Show charges**

Those are the entire sample recommendation list. Lantern qualifies through the 10% rule (300/1299, about 23.1%). Firefly's $99 latest bill is about 20.7% above its $82 median, below 25%; Northline is unchanged. There are fewer than three video findings. The secondary estimate remains **$162.49**; confirming Pinecone changes it to **$171.48**, and undo restores **$162.49**.

## Verification

- Before edits: **11/11 original tests passed** on Node 22.23.3/Poppler. Independently extracted every fixture. Confirmed Cardiff's complete four-page July–October statement, 79 rows, $18,255.27 purchases, four payments totaling $19,642.91, $78.25 return and $1,494.40/month across 11 included findings, plus unconfirmed Apple.
- Final **`npm test`: 27/27 pass**, including all 11 unchanged originals. New tests cover every requested scenario, boundary materiality, mixed partial/complete support, catalog-driven selection, v1 storage, per-account scope and module/security headers.
- Fresh Chrome 155.0.8059.79 contexts against loopback `PORT=4181 npm start`: actual PDF picker and browser drag events with actual Cardiff bytes; every one of the 20 supporting rows/excerpts/page-line references checked. Verified catalog names, original descriptors, automatic announcement, Tab/Enter/Space, heading focus and disclosure focus/ARIA state.
- **1280×900 and 390×844:** visually inspected screenshots; no horizontal overflow, reading text ≥16 px, visible controls ≥44×44 px. Checked open charges, finding detail and correction forms. Phone visual and keyboard order puts review before import.
- Browser baselines: samples **29 rows / $653.07 / $162.49**; Pinecone confirmation **$171.48**, undo **$162.49**. Overlap/partial/unsupported batch **35 rows / $777.05 / $162.49**, two readable partial rows and visible failures; partial filename/dates appear in scope. Also checked unsupported-only and partial-only profiles, duplicate Cardiff, identical reloads, persistent Renegotiate and Apple rename/Keep/clear/undo. No unexpected console or JavaScript errors.
- Not verified: actual screen-reader speech, physical phone, Safari, Windows or real statements. ARIA/accessibility output inspection does not replace a screen-reader session.

Screenshots and browser evidence, all outside `public/`:

- `/home/sloppymo/Documents/projectdad/output/playwright/cardiff-desktop.png` — full page at a 1280×900 viewport, Apple charges expanded.
- `/home/sloppymo/Documents/projectdad/output/playwright/cardiff-phone.png` — full page at a 390×844 viewport, Apple charges expanded.
- `/home/sloppymo/Documents/projectdad/output/playwright/cardiff-desktop-viewport.png` and `/home/sloppymo/Documents/projectdad/output/playwright/cardiff-phone-viewport.png` — corresponding viewport captures.
- `/home/sloppymo/Documents/projectdad/output/playwright/browser-checks.json`, `cardiff-rendered.txt` and `samples-rendered.txt` — browser measurements and unedited rendered text captures.

## Deviations and clarifications

- Price headlines say **“Call … about the price.”** so several price-increase candidates do not each say “first.” Required facts, order and conditional arithmetic are preserved.
- The global three-item cap conflicts with keeping the displayed Cardiff subset unchanged when another account adds a tier 1 candidate. Required tier ordering gives **Coastline, Lantern, Hulu** in the mixed batch. Reordered imports are globally identical; optional `{ accountId }` evaluation verifies Cardiff's full recommendations remain deep-equal independently. No selector or storage preference was added.
- Video groups require a shared observed complete month, preventing unrelated historical coverage from implying overlap. Complete support is conservative. Catalog keys are exact normalized descriptors; no identities or estimate calculations are changed.
- Kimi could not start in its read-only log directory; the Playwright CLI wrapper could not fetch its package. Used the already-installed Playwright runtime and isolated Chrome through approved execution, which resolved sandbox restrictions on loopback/Chrome. No dependency was installed or unrelated process stopped.

## Files changed

| File | Purpose |
| --- | --- |
| `public/savings.mjs` | Pure ranking, conditional copy, stable evidence fields and account-specific coverage sentences. |
| `public/catalog.mjs` | Editable display names/service kinds and rename precedence. |
| `public/recurrence.mjs` | Export three existing helpers for reuse; no heuristic or estimate behavior change. |
| `public/app.mjs` | Render review and disclosures, catalog names, source lines, positive charges, automatic focus/announcement, drop handling and the primary action; preserve finding controls. |
| `public/index.html` | Review placement, Find ways to save, accessible drop-zone button and introductory text. |
| `public/style.css` | Review cards, secondary estimate, drop feedback, 16 px reading text, 44 px controls and phone ordering. |
| `server.mjs` | Add only the two new modules to the static asset allow-list. |
| `test/savings.test.mjs` | Sixteen new feature/regression tests. |
| `package.json` | Run both original and savings tests with `npm test`; no dependencies added. |
| `README.md` | Current workflow, sample/Cardiff expected outputs and savings-rule summary. |
| `savings-review-notes.md` | This implementation and verification report. |
| `output/playwright/` (seven files listed above) | Four screenshots, browser-check JSON and two rendered-copy captures. |

PDFs, `lib/`, ledger/workflow behavior, original tests/expected rows, fixture generation, storage schema, loopback binding, Host checks and security headers are unchanged.

## Follow-up feature next steps

- Save a dated user decision with current-price baseline rows, target price, effective date and any one-time fee; keep it distinct from derived recommendations.
- Compare later complete billing cycles, showing one matching bill as provisional and two as confirmed.
- Check cancellation through complete covered billing windows; missing/partial statements cannot prove absence or savings.
- Link fees/refunds and show checkable actual savings separately from opportunities and changes in estimates.
- Add coverage-aware reminders, decision history and explicit Keep return rules, with a reviewed storage migration when needed.

## Open questions

1. Keep the cheapest on-demand service as the overlap example, or allow a preferred service to suggest first?
2. Keep price-change materiality at $5/month or 10%, and variable jumps at both 25% and $5?
3. Keep automatic opening after a successful or partial import, or require Find ways to save first?
