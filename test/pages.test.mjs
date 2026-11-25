import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import { extractPdf } from "../lib/pdf.mjs";
import { addDocument, buildLedger, emptyState } from "../public/ledger.mjs";
import { findRecurring } from "../public/recurrence.mjs";
import { findSavings } from "../public/savings.mjs";
import { textLines } from "../public/pdf-text.mjs";

await promisify(execFile)(process.execPath, ["scripts/build-pages.mjs"], { cwd: new URL("../", import.meta.url) });
const { extractBrowserFile } = await import("../dist/pdf-browser.mjs");
const names = ["harbor-checking-jan-mar", "summit-card-jan-mar", "summit-card-feb-apr", "harbor-checking-apr-partial", "cardiff-credit-card-statement"];
const files = Object.fromEntries(await Promise.all(names.map(async name => {
  const path = name.startsWith("cardiff") ? `output/pdf/${name}.pdf` : `public/samples/${name}.pdf`;
  return [name, new File([await readFile(new URL(`../${path}`, import.meta.url))], `${name}.pdf`, { type: "application/pdf" })];
})));
const extracted = Object.fromEntries(await Promise.all(names.map(async name => [name, await extractBrowserFile(files[name])])));
const imported = keys => keys.reduce((state, key) => addDocument(state, files[key].name, extracted[key]).state, emptyState());

test("the Pages artifact is browser-only, self-hosted, and works below a repository subpath", async () => {
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(index, /data-reader="browser"/);
  assert.match(index, /PDFs are read on this device and are never uploaded/);
  assert.match(index, /connect-src 'self'/);
  assert.doesNotMatch(index, /(?:src|href)="\//);
  assert.doesNotMatch(index, /https?:\/\//);
  assert.match(index, /samples\/cardiff-credit-card-statement.pdf/);
  assert.equal(await readFile(new URL("../dist/.nojekyll", import.meta.url), "utf8"), "");
  assert.deepEqual(await readFile(new URL("../dist/statement.mjs", import.meta.url)), await readFile(new URL("../lib/statement.mjs", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../dist/vendor/pdfjs/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "6.5.438");
  assert.equal(manifest.build, "legacy");
  assert.ok(Object.keys(manifest.files).includes("pdf.worker.mjs"));
});

test("browser PDF text preserves all native dates, descriptors, cents, source pages, reconciliation and SHA IDs", async () => {
  for (const name of names) {
    const native = await extractPdf(Buffer.from(await files[name].arrayBuffer()));
    const browser = extracted[name];
    assert.equal(browser.id, native.id, name);
    assert.equal(browser.status, native.status, name);
    assert.deepEqual(browser.account, native.account, name);
    assert.deepEqual(browser.period, native.period, name);
    assert.deepEqual(browser.reconciliation, native.reconciliation, name);
    const facts = rows => rows.map(({ date, description, amountCents, page }) => ({ date, description, amountCents, page }));
    assert.deepEqual(facts(browser.rows), facts(native.rows), name);
    assert.ok(browser.rows.every(row => row.line >= 1 && row.excerpt.includes(row.description)));
  }
});

test("browser extraction gives Cardiff's exact ledger, estimate, ranking and native recommendation objects", async () => {
  const state = imported(["cardiff-credit-card-statement"]);
  const ledger = buildLedger(state.documents);
  const recurring = findRecurring(ledger, {});
  const savings = findSavings(ledger, recurring);
  assert.equal(ledger.rows.length, 79);
  assert.equal(ledger.purchaseCents, 1825527);
  assert.equal(recurring.monthlyCents, 149440);
  assert.equal(recurring.included.length, 11);
  assert.deepEqual(savings.map(item => item.name), ["Coastline Fiber", "Hulu", "Apple"]);
  const native = await extractPdf(Buffer.from(await files["cardiff-credit-card-statement"].arrayBuffer()));
  const nativeLedger = buildLedger(addDocument(emptyState(), files["cardiff-credit-card-statement"].name, native).state.documents);
  assert.deepEqual(savings, findSavings(nativeLedger, findRecurring(nativeLedger, {})));
  assert.equal(addDocument(state, "same-renamed.pdf", native).duplicate, true);
});

test("browser extraction preserves samples and partial overlap results in either import order", () => {
  const baseline = buildLedger(imported(["harbor-checking-jan-mar", "summit-card-jan-mar"]).documents);
  assert.equal(baseline.rows.length, 29);
  assert.equal(baseline.purchaseCents, 65307);
  const recurring = findRecurring(baseline, {});
  assert.equal(recurring.monthlyCents, 16249);
  assert.deepEqual(findSavings(baseline, recurring).map(item => item.name), ["Lantern Streaming", "PAYPAL *PINECONE"]);
  const keys = names.slice(0, 4);
  const results = [keys, [...keys].reverse()].map(order => {
    const ledger = buildLedger(imported(order).documents);
    assert.equal(ledger.rows.length, 35);
    assert.equal(ledger.purchaseCents, 77705);
    const findings = findRecurring(ledger, {});
    assert.equal(findings.monthlyCents, 16249);
    return findSavings(ledger, findings);
  });
  assert.deepEqual(results[0], results[1]);
});

test("browser reader fails visibly for unsupported, corrupt, non-PDF and oversized input", async () => {
  const unsupported = await readFile(new URL("../public/samples/unsupported-statement.pdf", import.meta.url));
  await assert.rejects(extractBrowserFile(new File([unsupported], "unsupported.pdf")), /Unsupported statement layout/);
  await assert.rejects(extractBrowserFile(new File(["%PDF-1.5\nbad document"], "corrupt.pdf")), /could not be read/);
  await assert.rejects(extractBrowserFile(new File(["plain text"], "plain.pdf")), /not a readable PDF/);
  await assert.rejects(extractBrowserFile(new File(["plain text"], "plain.txt")), /Select a PDF statement/);
  await assert.rejects(extractBrowserFile(new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.pdf")), /12 MB or smaller/);
});

test("text layout sorts real positions and retains column boundaries without inventing row content", () => {
  const text = (str, x, y, width) => ({ str, width, dir: "ltr", transform: [10, 0, 0, 10, x, y] });
  assert.deepEqual(textLines([text("$149.00", 500, 600, 40), text("07/05", 50, 600, 30),
    text("COASTLINE FIBER", 180, 600, 100), text("END OF ACTIVITY", 50, 570, 100)]),
    ["07/05  COASTLINE FIBER  $149.00", "END OF ACTIVITY"]);
  assert.throws(() => textLines([{ ...text("rotated", 10, 10, 50), transform: [0, 10, -10, 0, 10, 10] }]), /upright/);
  assert.throws(() => textLines([{ ...text("bad", 10, 10, 50), width: NaN }]), /positions/);
});
