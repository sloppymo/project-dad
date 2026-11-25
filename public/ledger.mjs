export const dayMs = 86_400_000;

export const actions = ["Keep", "Cancel", "Renegotiate", "Investigate"];

export const typeLabels = {
  expense: "Purchase",
  payment: "Card payment",
  transfer: "Transfer",
  income: "Deposit",
  credit: "Credit or refund",
  unclear: "Unclear",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export const dollars = cents => money.format(cents / 100);
export const formatDay = date => day.format(new Date(date));
export const formatMonth = date => month.format(new Date(date));
export const accountId = account => JSON.stringify([account.institution.toUpperCase(), account.kind, account.lastFour]);
export const accountLabel = account => `${account.kind === "card" ? "Credit card" : "Checking"} • ${account.lastFour}`;

export function classify(row, kind) {
  const text = row.description.toUpperCase();
  if ((kind === "card" && row.amountCents > 0 && /^PAYMENT\s*-\s*THANK YOU$/.test(text)) ||
      (kind === "checking" && row.amountCents < 0 &&
        /\b(?:VISA|MASTERCARD|CREDIT CARD) (?:PAYMENT|AUTOPAY) \d{4}$/.test(text))) {
    return "payment";
  }
  if (kind === "checking" && /^(?:ONLINE )?TRANSFER (?:TO|FROM) (?:SAVINGS|CHECKING) \d{4}$/.test(text)) {
    return "transfer";
  }
  if (row.amountCents > 0) return kind === "checking" && /\b(?:DEPOSIT|PAYROLL)\b/.test(text) ? "income" : "credit";
  if (row.amountCents === 0 || /^(?:ACH )?(?:ONLINE )?(?:PAYMENT|TRANSFER)(?:\b|$)/.test(text)) return "unclear";
  return "expense";
}

export function emptyState() {
  return { version: 1, documents: [], reviews: {} };
}

export function addDocument(state, name, extraction) {
  if (state.documents.some(document => document.id === extraction.id)) return { state, duplicate: true };
  const document = { ...extraction, name };
  return { state: { ...state, documents: [...state.documents, document] }, duplicate: false };
}

function mergePeriods(periods) {
  const ranges = [];
  for (const period of [...periods].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = ranges.at(-1);
    if (last && Date.parse(period.start) <= Date.parse(last.end) + dayMs) {
      if (period.end > last.end) last.end = period.end;
    } else {
      ranges.push({ ...period });
    }
  }
  return ranges;
}

export function buildLedger(documents) {
  const accounts = new Map();
  const bySignature = new Map();
  for (const document of documents) {
    const key = accountId(document.account);
    if (!accounts.has(key)) accounts.set(key, { key, account: document.account, documents: [] });
    accounts.get(key).documents.push(document);
    for (const row of document.rows) {
      const signature = JSON.stringify([key, row.date, row.description, row.amountCents]);
      if (!bySignature.has(signature)) bySignature.set(signature, { row, key, sources: new Map() });
      const { sources } = bySignature.get(signature);
      if (!sources.has(document.id)) sources.set(document.id, []);
      sources.get(document.id).push({
        documentId: document.id,
        name: document.name,
        page: row.page,
        line: row.line,
        excerpt: row.excerpt,
        status: document.status,
      });
    }
  }

  const rows = [];
  for (const [signature, { key, row, sources }] of bySignature) {
    const account = accounts.get(key);
    const occurrences = [...sources.values()];
    const counts = account.documents
      .filter(document => document.period.start <= row.date && row.date <= document.period.end)
      .filter(document => document.status === "complete" || sources.has(document.id))
      .map(document => sources.get(document.id)?.length ?? 0);
    const overlapConflict = new Set(counts).size > 1;
    const multiplicity = Math.max(...occurrences.map(entries => entries.length));
    for (let index = 0; index < multiplicity; index++) {
      rows.push({
        id: `${signature}:${index + 1}`,
        accountId: key,
        account: account.account,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        type: classify(row, account.account.kind),
        sources: occurrences.map(entries => entries[index]).filter(Boolean),
        overlapConflict,
      });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const coverage = [...accounts.values()].map(({ key, account, documents: statements }) => ({
    key,
    account,
    ranges: mergePeriods(statements.filter(statement => statement.status === "complete").map(statement => statement.period)),
    partials: statements.filter(statement => statement.status === "partial").map(statement => statement.period),
  }));
  return {
    rows,
    coverage,
    purchaseCents: rows.reduce((total, row) => row.type === "expense" && !row.overlapConflict ? total - row.amountCents : total, 0),
    excludedPaymentCount: rows.filter(row => row.type === "payment").length,
    excludedTransferCount: rows.filter(row => row.type === "transfer").length,
    uncertainCount: rows.filter(row => row.type === "unclear" || row.overlapConflict).length,
  };
}
