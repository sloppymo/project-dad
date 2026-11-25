import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractPdf, readPdf } from "../lib/pdf.mjs";
import { interpretStatement, validateStatement } from "../lib/statement.mjs";
import { addDocument, buildLedger, emptyState } from "../public/ledger.mjs";
import { findRecurring } from "../public/recurrence.mjs";
import { changeReview, extractFile, importBatch, openStore } from "../public/workflow.mjs";
import { handleRequest } from "../server.mjs";

const names = {
  checking: "harbor-checking-jan-mar.pdf",
  card: "summit-card-jan-mar.pdf",
  overlap: "summit-card-feb-apr.pdf",
  partial: "harbor-checking-apr-partial.pdf",
  unsupported: "unsupported-statement.pdf",
};
const expected = JSON.parse(await readFile(new URL("./expected-rows.json", import.meta.url), "utf8"));
const fixtures = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) =>
  [key, await readFile(new URL(`../public/samples/${name}`, import.meta.url))])));
const extracted = Object.fromEntries(await Promise.all(
  ["checking", "card", "overlap", "partial"].map(async key => [key, await extractPdf(fixtures[key])])));

function imported(keys = ["checking", "card"]) {
  return keys.reduce((state, key) => addDocument(state, names[key], extracted[key]).state, emptyState());
}

test("the PDF reader returns every labeled date, original descriptor, signed cents, and source page", () => {
  for (const [key, statement] of Object.entries(extracted)) {
    const rows = statement.rows.map(({ date, description, amountCents, page }) => ({ date, description, amountCents, page }));
    assert.deepEqual(rows, expected[names[key]], names[key]);
    assert.ok(statement.rows.every(row => row.excerpt.includes(row.description)));
    if (key === "partial") continue;
    assert.equal(statement.status, "complete");
    assert.equal(statement.reconciliation.netCents, statement.reconciliation.printed.netCents);
    assert.equal(statement.reconciliation.count, statement.reconciliation.printed.count);
  }
});

test("bad files fail and partial rows remain visible with the failed reconciliation", async () => {
  await assert.rejects(extractPdf(fixtures.unsupported), /unsupported statement layout/i);
  await assert.rejects(extractPdf(Buffer.from("plain text")), /not a readable PDF/i);
  await assert.rejects(extractPdf(Buffer.from("%PDF-1.5\nbad document")), /could not be read/i);
  assert.equal(extracted.partial.status, "partial");
  assert.ok(extracted.partial.issues.some(issue => issue.page === 2 && issue.excerpt.includes("FIREFLY WATER")));
  assert.ok(extracted.partial.issues.some(issue => issue.message.includes("2 of 3 rows")));
});

test("a proposed row, an altered amount, or missing source rows cannot silently enter a complete ledger", async () => {
  const { pages } = await readPdf(fixtures.checking);
  const proposal = interpretStatement(pages);
  const rows = proposal.rows.slice(0, -1);
  rows[0] = { ...rows[0], amountCents: 123456 };
  rows.push({ ...rows[1], page: 10 }, { ...rows[2] });
  const checked = validateStatement({ ...proposal, rows }, pages);
  assert.equal(checked.status, "partial");
  assert.equal(checked.rows.length, 13);
  assert.ok(checked.issues.some(issue => /2 readable transaction rows/.test(issue.message)));
  assert.throws(() => validateStatement({ ...proposal, account: {} }, pages), /could not be verified/i);
});

test("credit card dates use the statement window to resolve a December-to-January year change", () => {
  const pages = [[
    "SUMMIT CARD SERVICES", "CREDIT CARD STATEMENT",
    "Account ending in 2046  |  Currency USD", "Statement period 2025-12-15 to 2026-01-14",
    "POST DATE     MERCHANT / ACTIVITY     USD AMOUNT",
    "12/29     LANTERN STREAMING     $15.99", "01/06     PAYMENT - THANK YOU     ($15.99)",
    "END OF ACTIVITY", "Statement totals: 2 rows   |   Net activity +$0.00",
  ]];
  const result = validateStatement(interpretStatement(pages), pages);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.rows.map(row => row.date), ["2025-12-29", "2026-01-06"]);
});

test("same-file reimports are idempotent and overlap retains both same-day identical purchases", () => {
  const base = imported();
  const repeat = addDocument(base, "renamed.pdf", extracted.card);
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.state, base);

  for (const keys of [["checking", "card", "overlap"], ["overlap", "checking", "card"]]) {
    const ledger = buildLedger(imported(keys).documents);
    const paired = ledger.rows.filter(row => row.description === "COPPER MARKET" && row.date === "2026-03-21");
    assert.equal(ledger.rows.length, 33);
    assert.equal(ledger.purchaseCents, 71255);
    assert.equal(paired.length, 2);
    assert.deepEqual(paired.map(row => row.sources.map(source => source.page).sort()), [[2, 3], [2, 3]]);
    assert.ok(paired.every(row => !row.overlapConflict));
  }
});

test("conflicting overlap counts are flagged and withheld instead of losing copies", () => {
  const base = imported();
  const alternative = {
    ...extracted.overlap,
    rows: extracted.overlap.rows.filter((row, index, rows) => row.date !== "2026-03-21" || rows[index - 1].date !== row.date),
  };
  const ledger = buildLedger(addDocument(base, names.overlap, alternative).state.documents);
  const paired = ledger.rows.filter(row => row.description === "COPPER MARKET" && row.date === "2026-03-21");
  assert.equal(paired.length, 2);
  assert.ok(paired.every(row => row.overlapConflict));
  assert.equal(ledger.purchaseCents, 66755);
  assert.equal(ledger.uncertainCount, 3);
});

test("card payments, transfers, unknown payments, credits and coverage stay distinct", () => {
  const ledger = buildLedger(imported(["checking", "card", "overlap", "partial"]).documents);
  assert.equal(ledger.rows.length, 35);
  assert.equal(ledger.excludedPaymentCount, 7);
  assert.equal(ledger.excludedTransferCount, 1);
  assert.equal(ledger.uncertainCount, 1);
  assert.equal(ledger.purchaseCents, 77705);
  assert.ok(ledger.rows.some(row => row.type === "credit" && row.amountCents === 1270));
  assert.deepEqual(ledger.coverage.find(account => account.account.kind === "checking").ranges,
    [{ start: "2026-01-01", end: "2026-03-31" }]);
  assert.deepEqual(ledger.coverage.find(account => account.account.kind === "checking").partials,
    [{ start: "2026-04-01", end: "2026-04-30" }]);
  assert.deepEqual(ledger.coverage.find(account => account.account.kind === "card").ranges,
    [{ start: "2026-01-01", end: "2026-04-30" }]);
});

test("recurrence explains a price increase, steady subscription, variable bill and ambiguous processor", () => {
  const state = imported();
  const ledger = buildLedger(state.documents);
  const result = findRecurring(ledger, state.reviews);
  assert.equal(result.monthlyCents, 16249);
  assert.equal(result.findings.length, 4);
  const [first, ambiguous, variable, fixed] = result.findings;
  assert.equal(first.name, "Lantern Streaming");
  assert.deepEqual(first.increase, { previous: 1299, latest: 1599, delta: 300, date: "2026-03-06" });
  assert.deepEqual(first.rows.map(row => row.sources[0].page), [3, 2, 1]);
  assert.equal(ambiguous.included, false);
  assert.match(ambiguous.explanation, /payment processor/);
  assert.equal(variable.latestCents, 9900);
  assert.equal(variable.monthlyCents, 8200);
  assert.equal(fixed.monthlyCents, 6450);
  assert.equal(fixed.label, "Fixed monthly");

  const confirmed = changeReview(state, ambiguous.id, { name: "Pinecone Membership", assessment: "confirmed" });
  assert.equal(findRecurring(ledger, confirmed.reviews).monthlyCents, 17148);
  const undone = changeReview(confirmed, ambiguous.id, { name: null, assessment: null });
  assert.equal(findRecurring(ledger, undone.reviews).monthlyCents, 16249);
  const dismissed = changeReview(state, fixed.id, { assessment: "dismissed" });
  assert.equal(findRecurring(ledger, dismissed.reviews).monthlyCents, 9799);
});

test("two months produce a review candidate and continuous later coverage can flag a missing charge", () => {
  const march = extracted.card.rows.filter(row => row.date.slice(0, 7) !== "2026-03");
  const two = { ...extracted.card, period: { start: "2026-01-01", end: "2026-02-28" }, rows: march };
  const tentative = findRecurring(buildLedger([{ ...two, name: "two.pdf" }]), {});
  assert.equal(tentative.monthlyCents, 0);
  assert.ok(tentative.needsReview.every(item => item.rows.length === 2));

  const partial = findRecurring(buildLedger([{ ...extracted.card, name: "partial.pdf", status: "partial" }]), {});
  assert.equal(partial.monthlyCents, 0);
  assert.match(partial.needsReview.find(item => item.name === "Lantern Streaming").explanation, /complete statement imports/);

  const state = imported();
  const extended = {
    ...extracted.overlap,
    rows: extracted.overlap.rows.filter(row => row.date !== "2026-04-06"),
  };
  const ledger = buildLedger(addDocument(state, names.overlap, extended).state.documents);
  const lantern = findRecurring(ledger, {}).findings.find(item => item.name === "Lantern Streaming");
  assert.equal(lantern.included, false);
  assert.match(lantern.explanation, /next billing window/);
});

test("the browser import controller reads PDFs through the API and isolates a failed file", async () => {
  const storage = new Map();
  const adaptStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const store = openStore(adaptStorage);
  const request = (path, options) => handleRequest(new Request(`http://127.0.0.1:4173${path}`, {
    ...options,
    headers: { ...options.headers, origin: "http://127.0.0.1:4173" },
  }));
  const files = ["checking", "unsupported", "card", "partial", "card"]
    .map(key => new File([fixtures[key]], names[key], { type: "application/pdf" }));
  const report = await importBatch(files, {
    store,
    extract: file => extractFile(file, request),
    onProgress() {},
    onSaved() {},
  });
  assert.deepEqual(report.map(entry => entry.status), ["complete", "failed", "complete", "partial", "duplicate"]);
  const state = store.load();
  assert.equal(state.documents.length, 3);
  const id = findRecurring(buildLedger(state.documents), state.reviews).included[0].id;
  await store.update(current => changeReview(current, id, { action: "Renegotiate" }));
  assert.equal(openStore(adaptStorage).load().reviews[id].action, "Renegotiate");
});

test("the local extraction endpoint accepts only the local origin and expects raw PDF input", async () => {
  const url = "http://127.0.0.1:4173/api/extract";
  const crossOrigin = await handleRequest(new Request(url, {
    method: "POST", headers: { origin: "http://example.test", "Content-Type": "application/pdf" }, body: fixtures.card,
  }));
  assert.equal(crossOrigin.status, 403);
  const wrongType = await handleRequest(new Request(url, { method: "POST", body: "plain text" }));
  assert.equal(wrongType.status, 415);
  const sample = await handleRequest(new Request(`http://127.0.0.1:4173/samples/${names.card}`));
  assert.equal(sample.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await sample.arrayBuffer()), fixtures.card);
});
