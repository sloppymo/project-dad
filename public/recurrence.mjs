import { dayMs, dollars, formatDay, formatMonth } from "./ledger.mjs";

export const processorName = /^(?:PAYPAL\b|APPLE\.COM\/BILL\b|SQ \*|SQUARE\b|STRIPE\b)/;
const utility = /\b(?:WATER|POWER|ELECTRIC|ENERGY|UTILITY|INTERNET|WIRELESS|INSURANCE|GAS SERVICE)\b/;
const everydayPurchase = /\b(?:MARKET|SUPERMARKET|GROCERY|CAFE|RESTAURANT|HARDWARE|FUEL|GAS STATION)\b/;

export function merchantKey(description) {
  return description.toUpperCase().replace(/\s+/g, " ").replace(/ ACH$/, "").trim();
}

function displayName(merchant) {
  if (processorName.test(merchant)) return merchant;
  return merchant.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function monthIndex(date) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
}

export function monthlyPair(earlier, later) {
  if (monthIndex(later.date) - monthIndex(earlier.date) !== 1) return false;
  const gap = (Date.parse(later.date) - Date.parse(earlier.date)) / dayMs;
  return gap >= 21 && gap <= 40;
}

function latestIncrease(rows, amounts) {
  const latest = amounts.at(-1);
  const firstNew = amounts.findLastIndex(amount => amount !== latest) + 1;
  if (firstNew < 2) return null;
  const older = amounts.slice(0, firstNew);
  const previous = older[0];
  if (latest <= previous || older.some(amount => amount !== previous)) return null;
  return { previous, latest, date: rows[firstNew].date, delta: latest - previous };
}

function coveredNextCharge(date, ranges) {
  const from = new Date(date);
  const endOfNextMonth = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 2, 0);
  const endOfWindow = Math.min(from.getTime() + 40 * dayMs, endOfNextMonth);
  const lastDay = new Date(endOfWindow).toISOString().slice(0, 10);
  return ranges.some(range => range.start <= date && range.end >= lastDay);
}

function assess(inputs, review, ranges) {
  const { id, merchant, rows } = inputs;
  const monthCounts = new Set(rows.map(row => monthIndex(row.date))).size;
  if (monthCounts < 2 || (!review?.assessment && !rows.some((row, i) => i > 0 && monthlyPair(rows[i - 1], row)))) {
    return null;
  }
  const latest = rows.at(-1);
  const amounts = rows.map(row => -row.amountCents);
  const latestCents = amounts.at(-1);
  const steady = amounts.every(amount => amount === latestCents);
  const ambiguous = processorName.test(merchant);
  const duplicatedMonth = monthCounts !== rows.length;
  const consecutive = !duplicatedMonth && rows.every((row, i) => i === 0 || monthlyPair(rows[i - 1], row));
  const conflicted = rows.some(row => row.overlapConflict);
  const laterGap = coveredNextCharge(latest.date, ranges);
  const increase = consecutive && !utility.test(merchant) ? latestIncrease(rows, amounts) : null;
  const supportsVariableBill = utility.test(merchant) && Math.max(...amounts) <= 2.5 * Math.min(...amounts);
  const variable = !steady && !increase;
  const sorted = [...amounts].sort((a, b) => a - b);
  const typicalCents = Math.round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2);
  const monthlyCents = variable ? typicalCents : latestCents;
  const canConfirm = consecutive && !conflicted && !laterGap;
  const confirmed = review?.assessment === "confirmed" && canConfirm;
  const fullySourced = rows.filter(row => row.sources.some(source => source.status === "complete")).length;
  const strong = canConfirm && fullySourced >= 3 && !ambiguous && (steady || increase || supportsVariableBill);
  const included = Boolean(strong || confirmed) && review?.assessment !== "dismissed";
  let explanation;
  if (conflicted) explanation = "Overlapping statements disagree about one or more charges. Check the original statements.";
  else if (laterGap) explanation = `Coverage extends into the next billing window after ${formatDay(latest.date)}, but no matching charge was found.`;
  else if (duplicatedMonth) explanation = "More than one charge appeared in a month. This could be separate services or repeat purchases.";
  else if (!consecutive) explanation = "Charges appear in different months, but the timing does not establish a steady monthly pattern.";
  else if (ambiguous) explanation = `${rows.length} charges appeared about a month apart. The payment processor description leaves the service unclear.`;
  else if (rows.length < 3) explanation = "Two charges are about a month apart. A third month would give a stronger comparison.";
  else if (fullySourced < 3 && !confirmed) explanation = "The charges look monthly. Fewer than three are backed by complete statement imports.";
  else if (increase) explanation = `The charge rose from ${dollars(increase.previous)} to ${dollars(increase.latest)} in ${formatMonth(increase.date)} after at least two months at the earlier price.`;
  else if (steady) explanation = `${rows.length} charges of ${dollars(latestCents)} appeared about a month apart.`;
  else if (supportsVariableBill) explanation = `${rows.length} monthly bills ranged from ${dollars(sorted[0])} to ${dollars(sorted.at(-1))}. The middle amount is ${dollars(typicalCents)}.`;
  else explanation = "The timing looks monthly, but the changing amounts could reflect repeat purchases.";
  const dismissed = review?.assessment === "dismissed";
  const label = dismissed ? "Dismissed" : confirmed ? "Confirmed by you" : !included ? "Needs review" :
    increase ? "Price increase" : variable ? "Variable bill" : "Fixed monthly";
  return {
    id,
    name: review?.name || displayName(merchant),
    originalName: displayName(merchant),
    account: latest.account,
    rows: [...rows].reverse(),
    latest,
    latestCents,
    typicalCents,
    monthlyCents,
    variable,
    increase,
    explanation,
    label,
    included,
    dismissed,
    canConfirm,
    review: review ?? {},
    priority: increase && included ? 0 : !included ? 1 : variable ? 2 : 3,
  };
}

export function findRecurring(ledger, reviews) {
  const groups = new Map();
  for (const row of [...ledger.rows].reverse()) {
    if (row.type !== "expense") continue;
    const merchant = merchantKey(row.description);
    const id = JSON.stringify([row.accountId, merchant]);
    if (everydayPurchase.test(merchant) && !reviews[id]) continue;
    if (!groups.has(id)) groups.set(id, { id, merchant, rows: [] });
    groups.get(id).rows.push(row);
  }
  const ranges = new Map(ledger.coverage.map(account => [account.key, account.ranges]));
  const findings = [...groups.values()]
    .map(group => assess(group, reviews[group.id], ranges.get(group.rows[0].accountId) ?? []))
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || b.monthlyCents - a.monthlyCents || a.name.localeCompare(b.name));
  const included = findings.filter(item => item.included);
  return {
    findings,
    included,
    needsReview: findings.filter(item => !item.included && !item.dismissed),
    monthlyCents: included.reduce((total, item) => total + item.monthlyCents, 0),
  };
}
