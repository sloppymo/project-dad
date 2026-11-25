export class ImportError extends Error {}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dollars = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}`;
const signedMoney = new RegExp(String.raw`^([+-])\$(${dollars})$`);
const cardMoney = new RegExp(String.raw`^(?:\$(${dollars})|\(\$(${dollars})\))$`);
const totalsPattern = new RegExp(String.raw`^Statement totals: (\d+) rows\s+\|\s+Net activity ([+-]\$${dollars})$`);
const headings = {
  checking: /^POSTED DATE\s+TRANSACTION DESCRIPTION\s+AMOUNT$/,
  card: /^POST DATE\s+MERCHANT \/ ACTIVITY\s+USD AMOUNT$/,
};

function isDate(value) {
  if (!datePattern.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function moneyToCents(value) {
  const cents = Number(value.replace(/[,.]/g, ""));
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000 ? cents : null;
}

function parseSignedMoney(value) {
  const match = signedMoney.exec(value);
  if (!match) return null;
  const cents = moneyToCents(match[2]);
  return cents === null ? null : match[1] === "-" ? -cents : cents;
}

function readHeader(lines) {
  const text = lines.map(line => line.trim()).filter(Boolean);
  const titleIndex = text.findIndex(line => /^(CHECKING|CREDIT CARD) STATEMENT$/.test(line));
  if (titleIndex < 1) return null;
  const institution = text[titleIndex - 1];
  const account = /^Account ending in (\d{4})\s+\|\s+Currency USD$/.exec(text[titleIndex + 1]);
  const period = /^Statement period (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(text[titleIndex + 2]);
  if (!/^[A-Za-z][A-Za-z .&'-]{2,59}$/.test(institution) || !account || !period) return null;
  const [, start, end] = period;
  if (!isDate(start) || !isDate(end) || start > end || Date.parse(end) - Date.parse(start) > 366 * 86_400_000) {
    return null;
  }
  return {
    account: {
      institution,
      kind: text[titleIndex] === "CHECKING STATEMENT" ? "checking" : "card",
      lastFour: account[1],
      currency: "USD",
    },
    period: { start, end },
  };
}

function cardDate(monthDay, { start, end }) {
  const [month, day] = monthDay.split("/");
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const candidates = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const date = `${String(year).padStart(4, "0")}-${month}-${day}`;
    if (isDate(date) && start <= date && date <= end) candidates.push(date);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function readRow(line, { account, period }) {
  const match = /^(\d{2}\/\d{2}(?:\/\d{4})?)\s{2,}(.+?)\s{2,}(\S+)$/.exec(line.trim());
  if (!match) return null;
  const [, printedDate, description, printedAmount] = match;
  if (!description.trim() || description.length > 180) return null;
  let date;
  let amountCents;
  if (account.kind === "checking") {
    const [month, day, year] = printedDate.split("/");
    date = `${year}-${month}-${day}`;
    amountCents = parseSignedMoney(printedAmount);
  } else {
    const value = cardMoney.exec(printedAmount);
    const cents = value ? moneyToCents(value[1] ?? value[2]) : null;
    amountCents = cents === null ? null : value[2] ? cents : -cents;
    date = printedDate.length === 5 ? cardDate(printedDate, period) : null;
  }
  if (!date || !isDate(date) || date < period.start || date > period.end || amountCents === null) return null;
  return { date, description, amountCents };
}

function addIssue(issues, page, message, excerpt) {
  issues.push({ page, message, ...(excerpt ? { excerpt: excerpt.slice(0, 220) } : {}) });
}

// Interpreters propose rows. The validator binds each proposal back to the
// independently extracted source lines, so proposals cannot create evidence.
export function interpretStatement(pages) {
  const headers = pages.map(readHeader);
  const header = headers.find(Boolean);
  if (!header) {
    const message = pages.some(lines => lines.some(line => line.trim()))
      ? "Unsupported statement layout. Try the sample checking or credit card PDF."
      : "No selectable text was found. This prototype requires a text PDF.";
    throw new ImportError(message);
  }
  const rows = [];
  const issues = [];
  const printedTotals = [];
  for (const [index, lines] of pages.entries()) {
    const page = index + 1;
    if (JSON.stringify(headers[index]) !== JSON.stringify(header)) {
      addIssue(issues, page, "This page could not be tied to the same account and period.");
      continue;
    }
    const start = lines.findIndex(line => headings[header.account.kind].test(line.trim()));
    if (start === -1) {
      addIssue(issues, page, "The transaction table heading could not be located.");
      continue;
    }
    const end = lines.findIndex((line, i) => i > start && line.trim() === "END OF ACTIVITY");
    if (end === -1) addIssue(issues, page, "The end of the transaction table could not be verified.");
    for (let lineIndex = start + 1; lineIndex < (end === -1 ? lines.length : end); lineIndex++) {
      const excerpt = lines[lineIndex].trim();
      if (!excerpt) continue;
      const row = readRow(excerpt, header);
      if (row) rows.push({ ...row, page, line: lineIndex + 1 });
      else addIssue(issues, page, "This transaction line could not be read.", excerpt);
    }
    for (const line of lines.slice(end === -1 ? lines.length : end + 1)) {
      const totals = totalsPattern.exec(line.trim());
      if (totals) printedTotals.push({ page, count: Number(totals[1]), netCents: parseSignedMoney(totals[2]) });
    }
  }
  return { ...header, rows, issues, printedTotals };
}

export function validateStatement(proposal, pages) {
  const source = interpretStatement(pages);
  const accountMatches = Object.entries(source.account).every(([key, value]) => proposal?.account?.[key] === value);
  const periodMatches = Object.entries(source.period).every(([key, value]) => proposal?.period?.[key] === value);
  if (!accountMatches || !periodMatches || !Array.isArray(proposal?.rows)) {
    throw new ImportError("The proposed account or statement period could not be verified from the PDF.");
  }
  const issues = [...source.issues];
  const accepted = [];
  const sourceRows = new Map(source.rows.map(row => [`${row.page}:${row.line}`, row]));
  for (const row of proposal.rows) {
    const original = sourceRows.get(`${row?.page}:${row?.line}`);
    if (!original || original.date !== row.date || original.amountCents !== row.amountCents ||
        original.description !== row.description) {
      addIssue(issues, Number.isInteger(row?.page) && pages[row.page - 1] ? row.page : null,
        "A proposed transaction could not be verified against its statement row.");
      continue;
    }
    sourceRows.delete(`${row.page}:${row.line}`);
    accepted.push({ ...original, excerpt: pages[row.page - 1][row.line - 1].trim() });
  }
  if (sourceRows.size) addIssue(issues, null, `${sourceRows.size} readable transaction rows were missing from the extraction.`);
  const netCents = accepted.reduce((sum, row) => sum + row.amountCents, 0);
  const printed = source.printedTotals.length === 1 ? source.printedTotals[0] : null;
  if (!printed) addIssue(issues, null, "A single set of printed statement totals could not be verified.");
  else if (printed.count !== accepted.length || printed.netCents !== netCents) {
    addIssue(issues, printed.page, `The extracted rows do not match the printed totals (${accepted.length} of ${printed.count} rows).`);
  }
  if (!accepted.length && (issues.length || printed?.count !== 0)) {
    throw new ImportError("No transaction rows could be verified. This statement was skipped.");
  }
  return {
    account: source.account,
    period: source.period,
    pageCount: pages.length,
    status: issues.length ? "partial" : "complete",
    rows: accepted.sort((a, b) => a.page - b.page || a.line - b.line),
    issues,
    reconciliation: { count: accepted.length, netCents, printed },
  };
}
