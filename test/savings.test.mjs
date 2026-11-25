import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractPdf } from "../lib/pdf.mjs";
import { accountId, addDocument, buildLedger, emptyState } from "../public/ledger.mjs";
import { findRecurring } from "../public/recurrence.mjs";
import { catalogEntry, findingName, merchantCatalog } from "../public/catalog.mjs";
import { coverageSentence, findSavings } from "../public/savings.mjs";
import { handleRequest } from "../server.mjs";
import { changeReview, openStore, storageKey } from "../public/workflow.mjs";

const paths = {
  cardiff: "output/pdf/cardiff-credit-card-statement.pdf",
  checking: "public/samples/harbor-checking-jan-mar.pdf",
  card: "public/samples/summit-card-jan-mar.pdf",
};
const extracted = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) =>
  [key, await extractPdf(await readFile(new URL(`../${path}`, import.meta.url)))])));
const imported = (keys = ["cardiff"]) => keys.reduce((state, key) =>
  addDocument(state, paths[key].split("/").at(-1), extracted[key]).state, emptyState());
function model(state) {
  const ledger = buildLedger(state.documents);
  const recurring = findRecurring(ledger, state.reviews);
  return { ledger, recurring, savings: findSavings(ledger, recurring) };
}

function synthetic(descriptor, amounts, { status = "complete", dates } = {}) {
  const last = dates?.at(-1) ?? `2026-${String(amounts.length + 6).padStart(2, "0")}-05`;
  const end = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return {
    id: `synthetic-${descriptor}-${amounts.join("-")}-${status}`,
    account: { institution: "FICTIONAL TEST CARD", kind: "card", lastFour: "0000", currency: "USD" },
    period: { start: "2026-07-01", end }, status, pageCount: 1, issues: [],
    rows: amounts.map((amount, index) => ({ date: dates?.[index] ?? `2026-${String(index + 7).padStart(2, "0")}-05`,
      description: descriptor, amountCents: -amount, page: 1, line: index + 1,
      excerpt: `${descriptor} $${(amount / 100).toFixed(2)}` })),
  };
}
function fromDocs(...docs) {
  // Merchants observed on the same synthetic statement share its complete row set.
  const statements = new Map();
  for (const doc of docs) {
    const key = JSON.stringify([doc.account, doc.period, doc.status]);
    const previous = statements.get(key);
    statements.set(key, previous ? { ...previous, id: `${previous.id}+${doc.id}`, rows: [...previous.rows, ...doc.rows] } : doc);
  }
  return [...statements.values()].reduce((state, doc) => addDocument(state, `${doc.id}.pdf`, doc).state, emptyState());
}

test("Cardiff keeps every baseline and ranks Coastline, Hulu, Apple with the exact source trail", () => {
  const { ledger, recurring, savings } = model(imported());
  assert.equal(extracted.cardiff.status, "complete");
  assert.equal(extracted.cardiff.pageCount, 4);
  assert.deepEqual(extracted.cardiff.period, { start: "2026-07-01", end: "2026-10-31" });
  assert.equal(ledger.rows.length, 79);
  assert.equal(ledger.purchaseCents, 1825527);
  assert.equal(ledger.excludedPaymentCount, 4);
  assert.equal(ledger.rows.filter(row => row.type === "payment").reduce((sum, row) => sum + row.amountCents, 0), 1964291);
  assert.deepEqual(ledger.rows.filter(row => row.type === "credit").map(row => row.amountCents), [7825]);
  assert.equal(recurring.monthlyCents, 149440);
  assert.equal(recurring.included.length, 11);
  assert.equal(recurring.findings[0].name, "Coastline Fiber");
  assert.deepEqual(savings.map(item => [item.name, item.type, item.tier]),
    [["Coastline Fiber", "price-increase", 1], ["Hulu", "overlap", 2], ["Apple", "unidentified", 3]]);
  const [coastline, hulu, apple] = savings;
  assert.equal(coastline.baselineCents, 11900);
  assert.equal(coastline.currentCents, 14900);
  assert.equal(coastline.monthlyCents, 3000);
  assert.equal(coastline.yearlyCents, 36000);
  assert.equal(hulu.baselineCents, 1899);
  assert.equal(hulu.yearlyCents, 22788);
  assert.equal(apple.monthlyCents, null);
  assert.equal(apple.yearlyCents, null);
  assert.ok(!savings.some(item => /golf/i.test(item.name)));
  const trail = item => item.rowIds.map(id => ledger.rows.find(row => row.id === id).sources.map(source => [source.page, source.line]));
  assert.deepEqual(trail(coastline), [[[1, 24]], [[2, 24]], [[3, 24]], [[4, 24]]]);
  assert.deepEqual(trail(apple), [[[1, 32]], [[2, 31]], [[3, 31]], [[4, 32]]]);
  assert.deepEqual(hulu.groups.map(group => group.name), ["Hulu", "Netflix", "YouTube TV"]);
  for (const item of savings) {
    assert.equal(item.id, `${item.type}:${item.findingId}`);
    assert.ok(item.rowIds.every(id => ledger.rows.some(row => row.id === id)));
  }
});

test("Cardiff copy is generated from monthly rows, distinguishes music, and makes conditional claims", () => {
  const [coastline, hulu, apple] = model(imported()).savings;
  assert.match(coastline.evidence, /\$119 in July and August, then \$149 in September and October/);
  assert.equal(coastline.savings, "If they do, that's $30 a month, or $360 a year before fees.");
  assert.match(hulu.evidence, /Netflix and YouTube TV/);
  assert.doesNotMatch(JSON.stringify(hulu), /Spotify/);
  assert.equal(hulu.savings, "If Hulu is the one you rarely open, canceling it would save $227.88 over 12 months at the current price.");
  assert.equal(apple.evidence, "It appeared every month from July through October.");
  assert.equal(apple.action, "Check your Apple purchase history to see what it covers.");
  assert.match(apple.savings, /too little.*estimate a saving/);
});

test("the built-in samples recommend exactly Lantern's $3 increase then unidentified Pinecone", () => {
  const { recurring, savings } = model(imported(["checking", "card"]));
  assert.equal(recurring.monthlyCents, 16249);
  assert.deepEqual(savings.map(item => [item.name, item.type]),
    [["Lantern Streaming", "price-increase"], ["PAYPAL *PINECONE", "unidentified"]]);
  assert.equal(savings[0].monthlyCents, 300);
  assert.equal(savings[0].yearlyCents, 3600);
  assert.match(savings[0].evidence, /\$12.99 in January and February, then \$15.99 in March/);
  assert.equal(savings[1].yearlyCents, null);
  assert.ok(!savings.some(item => /Firefly/.test(item.name) || item.type === "overlap"));
});

test("a utility name cannot hide a clean increase, and recurrence estimate behavior is unchanged", () => {
  const { recurring, savings } = model(fromDocs(synthetic("COASTLINE FIBER INTERNET", [11900, 11900, 14900, 14900])));
  assert.equal(recurring.monthlyCents, 13400);
  assert.equal(recurring.findings[0].increase, null);
  assert.equal(savings.length, 1);
  assert.equal(savings[0].tier, 1);
  assert.equal(savings[0].yearlyCents, 36000);
});

test("materiality uses either $5 or 10%, with a stable earlier run and consecutive months", () => {
  assert.deepEqual(model(fromDocs(synthetic("SMALL CHANGE", [4000, 4000, 4100, 4100]))).savings, []);
  for (const amounts of [[4000, 4000, 4400, 4400], [10000, 10000, 10500, 10500]]) {
    assert.equal(model(fromDocs(synthetic("QUALIFYING CHANGE", amounts))).savings[0].tier, 1);
  }
  for (const amounts of [[4000, 4100, 4500, 4500], [4000, 4500, 4500, 4500], [4500, 4500, 4000, 4000]]) {
    assert.deepEqual(model(fromDocs(synthetic("UNCERTAIN CHANGE", amounts))).savings, []);
  }
  const gaps = synthetic("GAPPED CHANGE", [4000, 4000, 5000], { dates: ["2026-07-05", "2026-08-05", "2026-10-05"] });
  assert.deepEqual(model(fromDocs(gaps)).savings, []);
});

test("fewer than three video services leave exactly Coastline then Apple; latest SDG&E is below median", () => {
  const state = imported();
  state.documents[0] = { ...state.documents[0], rows: state.documents[0].rows.filter(row => row.description !== "HULU *STREAMING") };
  const { savings } = model(state);
  assert.deepEqual(savings.map(item => item.name), ["Coastline Fiber", "Apple"]);
});

test("renames win over catalog names; Keep and dismiss remove candidates; clearing restores them", () => {
  let state = imported();
  const appleId = model(state).savings[2].findingId;
  state = changeReview(state, appleId, { name: "Apple One", action: "Keep" });
  assert.deepEqual(model(state).savings.map(item => item.name), ["Coastline Fiber", "Hulu"]);
  state = changeReview(state, appleId, { action: null });
  assert.equal(model(state).savings[2].name, "Apple One");
  state = changeReview(state, appleId, { assessment: "confirmed" });
  assert.equal(model(state).savings[2].type, "unidentified");
  state = changeReview(state, appleId, { assessment: "dismissed" });
  assert.equal(model(state).savings.length, 2);
  const huluId = model(state).savings[1].findingId;
  assert.equal(model(changeReview(state, huluId, { action: "Keep" })).savings.length, 1);
  assert.equal(findingName({ ...model(imported()).recurring.findings[0], review: { name: "My internet" } }), "My internet");
});

test("recommendations are deterministic across repeat imports and account evaluation in any import order", () => {
  const expected = model(imported()).savings;
  const cardiffAccount = accountId(extracted.cardiff.account);
  for (const keys of [["cardiff", "cardiff"], ["cardiff", "checking", "card"], ["card", "checking", "cardiff"]]) {
    const state = imported(keys);
    const snapshot = structuredClone(state);
    const { ledger, recurring, savings } = model(state);
    assert.deepEqual(findSavings(ledger, recurring), savings);
    assert.deepEqual(findSavings(ledger, recurring, merchantCatalog, { accountId: cardiffAccount }), expected);
    assert.deepEqual(state, snapshot);
  }
  const a = model(imported(["cardiff", "checking", "card"])).savings;
  const b = model(imported(["card", "checking", "cardiff"])).savings;
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(item => item.name), ["Coastline Fiber", "Lantern Streaming", "Hulu"]);
});

test("partial-only rows cannot support price or overlap recommendations, even after confirmation", () => {
  const partial = synthetic("COASTLINE FIBER INTERNET", [11900, 11900, 14900, 14900], { status: "partial" });
  assert.deepEqual(model(fromDocs(partial)).savings, []);
  let state = fromDocs(...["HULU *STREAMING", "NETFLIX.COM", "YOUTUBE TV"].map(name =>
    synthetic(name, [1899, 1899, 1899, 1899], { status: "partial" })));
  for (const item of model(state).recurring.findings) state = changeReview(state, item.id, { assessment: "confirmed" });
  assert.deepEqual(model(state).savings, []);
  const unknown = model(fromDocs(synthetic("SQ *UNIDENTIFIED", [999, 999, 999, 999], { status: "partial" }))).savings[0];
  assert.equal(unknown.incomplete, true);
  assert.match(unknown.evidence, /incomplete statement/);
  assert.equal(unknown.yearlyCents, null);
});

test("partial rows can supplement a completely supported increase, but cannot establish either price", () => {
  const full = synthetic("COASTLINE FIBER", [11900, 11900, 14900]);
  full.period.end = "2026-09-30";
  const partial = synthetic("COASTLINE FIBER", [11900, 11900, 14900, 14900], { status: "partial" });
  const result = model(fromDocs(full, partial)).savings[0];
  assert.equal(result.yearlyCents, 36000);
  assert.equal(result.incomplete, true);
  assert.match(result.evidence, /incomplete statement/);
  const beforeOnly = { ...full, rows: full.rows.slice(0, 2), period: { start: "2026-07-01", end: "2026-08-31" } };
  assert.deepEqual(model(fromDocs(beforeOnly, partial)).savings, []);
});

test("variable jump needs both 25% and $5, and never promises a saving", () => {
  for (const amounts of [[7300, 8200, 9900], [900, 1000, 1300]]) {
    assert.deepEqual(model(fromDocs(synthetic("TEST WATER", amounts))).savings, []);
  }
  const item = model(fromDocs(synthetic("TEST WATER", [1900, 2000, 2500]))).savings[0];
  assert.equal(item.tier, 4);
  assert.equal(item.baselineCents, 2000);
  assert.equal(item.currentCents, 2500);
  assert.equal(item.yearlyCents, null);
  assert.match(item.savings, /can't estimate/);
});

test("overlap uses catalog kinds and lowest on-demand price, independent of names and live-TV price", () => {
  const state = fromDocs(synthetic("SERVICE A", [900, 900, 900, 900]),
    synthetic("SERVICE B", [800, 800, 800, 800]), synthetic("SERVICE C", [100, 100, 100, 100]));
  const { ledger, recurring } = model(state);
  const custom = { "SERVICE A": { name: "Video A", kind: "on-demand video" },
    "SERVICE B": { name: "Video B", kind: "on-demand video" }, "SERVICE C": { name: "TV C", kind: "live TV" } };
  const [result] = findSavings(ledger, recurring, custom);
  assert.equal(result.name, "Video B");
  assert.equal(result.yearlyCents, 9600);
  assert.equal(result.groups[0].name, "Video B");
  assert.equal(catalogEntry(recurring.findings[0], {}), undefined);
});

test("price candidates sort by yearly change and unidentified candidates by monthly amount, capped at three", () => {
  const state = fromDocs(synthetic("SMALL INCREASE", [1000, 1000, 1500, 1500]),
    synthetic("LARGE INCREASE", [1000, 1000, 2000, 2000]),
    synthetic("STRIPE UNKNOWN", [900, 900, 900, 900]), synthetic("PAYPAL *UNKNOWN", [800, 800, 800, 800]));
  assert.deepEqual(model(state).savings.map(item => item.name), ["Large Increase", "Small Increase", "STRIPE UNKNOWN"]);
});

test("legacy v1 saved data loads unchanged and recommendations never enter storage", () => {
  let state = imported();
  state = changeReview(state, model(state).savings[0].findingId, { action: "Renegotiate" });
  const saved = JSON.stringify(state);
  const store = openStore({ getItem: key => key === storageKey ? saved : null });
  assert.deepEqual(store.load(), state);
  assert.deepEqual(model(store.load()).savings, model(state).savings);
  assert.equal(saved, JSON.stringify(store.load()));
  assert.deepEqual(Object.keys(store.load()).sort(), ["documents", "reviews", "version"]);
});

test("scope names each account's actual ranges and incomplete statement files", () => {
  const state = imported();
  const ledger = model(state).ledger;
  assert.equal(coverageSentence(ledger.coverage, state.documents),
    "Based on your Pacific Crest card ••7814, July 1 – October 31, 2026. Bills paid from other accounts aren't included.");
  const partial = { ...extracted.checking, id: "partial-scope", status: "partial",
    period: { start: "2026-04-01", end: "2026-04-30" }, rows: [] };
  const mixed = addDocument(imported(["cardiff", "checking", "card"]), "partial-example.pdf", partial).state;
  const scope = coverageSentence(model(mixed).ledger.coverage, mixed.documents);
  assert.match(scope, /Harbor Community Bank checking ••1185, January 1 – March 31, 2026; partial April 1 – April 30, 2026/);
  assert.match(scope, /Summit card ••2046, January 1 – March 31, 2026/);
  assert.match(scope, /Pacific Crest card ••7814, July 1 – October 31, 2026/);
  assert.match(scope, /Incomplete statement: partial-example.pdf/);
  assert.doesNotMatch(scope, /January 1 – October 31/);
});

test("savings modules are served locally with the existing security headers", async () => {
  for (const name of ["savings", "catalog"]) {
    const response = await handleRequest(new Request(`http://127.0.0.1:4173/${name}.mjs`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  }
});
