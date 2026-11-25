import { accountId as ledgerAccountId, dollars } from "./ledger.mjs";
import { merchantKey, monthlyPair, processorName } from "./recurrence.mjs";
import { catalogEntry, findingName, merchantCatalog } from "./catalog.mjs";

const fullMonth = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const fullDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortMoney = cents => cents % 100 === 0 ? dollars(cents).replace(/\.00$/, "") : dollars(cents);
export const naturalList = values => values.length < 3 ? values.join(" and ") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
const byDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const complete = row => row.sources.some(source => source.status === "complete");
const monthly = rows => rows.length >= 2 && rows.every((row, index) => !index || monthlyPair(rows[index - 1], row));

function scopeRange({ start, end }) {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${monthDay.format(new Date(start))} – ${monthDay.format(new Date(end))}, ${end.slice(0, 4)}`
    : `${fullDay.format(new Date(start))} – ${fullDay.format(new Date(end))}`;
}

export function coverageSentence(coverage, documents = []) {
  const accounts = [...coverage].sort((a, b) => a.key.localeCompare(b.key)).map(({ account, ranges, partials }) => {
    const institution = account.institution.replace(/ CARD SERVICES$/i, "").toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
    const periods = [...ranges.map(period => ({ ...period, partial: false })), ...partials.map(period => ({ ...period, partial: true }))]
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || Number(a.partial) - Number(b.partial));
    return `${institution} ${account.kind === "card" ? "card" : "checking"} ••${account.lastFour}, ${periods.map(period => `${period.partial ? "partial " : ""}${scopeRange(period)}`).join("; ")}`;
  });
  const keys = new Set(coverage.map(account => account.key));
  const partialNames = [...new Set(documents.filter(doc => doc.status === "partial" && keys.has(ledgerAccountId(doc.account))).map(doc => doc.name))].sort();
  return `Based on your ${accounts.join("; your ")}. ${partialNames.length ? `Incomplete ${partialNames.length === 1 ? "statement" : "statements"}: ${naturalList(partialNames)}. ` : ""}Bills paid from other accounts aren't included.`;
}

function months(rows) {
  const format = new Set(rows.map(row => row.date.slice(0, 4))).size > 1 ? monthYear : fullMonth;
  return naturalList(rows.map(row => format.format(new Date(row.date))));
}

function cadence(rows) {
  if (!monthly(rows)) return `${rows.length} times between ${monthYear.format(new Date(rows[0].date))} and ${monthYear.format(new Date(rows.at(-1).date))}`;
  const sameYear = rows[0].date.slice(0, 4) === rows.at(-1).date.slice(0, 4);
  const format = sameYear ? fullMonth : monthYear;
  return `every month from ${format.format(new Date(rows[0].date))} through ${format.format(new Date(rows.at(-1).date))}`;
}

function cleanIncrease(rows) {
  if (rows.length < 3 || !monthly(rows)) return null;
  const previous = -rows[0].amountCents;
  const firstNew = rows.findIndex(row => -row.amountCents !== previous);
  if (firstNew < 2) return null;
  const current = -rows[firstNew].amountCents;
  if (current <= previous || rows.slice(firstNew).some(row => -row.amountCents !== current)) return null;
  return { previous, current, firstNew, delta: current - previous };
}

function base(item, type, tier, rows, catalog) {
  const incomplete = rows.some(row => !complete(row));
  return {
    id: `${type}:${item.id}`,
    findingId: item.id,
    accountId: item.latest.accountId,
    type, tier,
    name: findingName(item, catalog),
    baselineCents: null,
    currentCents: item.latestCents,
    monthlyCents: null,
    yearlyCents: null,
    rowIds: rows.map(row => row.id),
    groups: [{ findingId: item.id, name: findingName(item, catalog), rowIds: rows.map(row => row.id) }],
    incomplete,
  };
}

// Derived only: no storage, clock, network, or mutations of ledger/findings.
// accountId optionally evaluates an account independently of the global top-three cap.
export function findSavings(ledger, recurring, catalog = merchantCatalog, { accountId } = {}) {
  const ledgerIds = new Set(ledger.rows.map(row => row.id));
  const eligible = recurring.findings.filter(item => !item.dismissed && item.review.assessment !== "dismissed" &&
    item.review.action !== "Keep" && (!accountId || item.latest.accountId === accountId) &&
    item.rows.every(row => ledgerIds.has(row.id) && !row.overlapConflict));
  const candidates = [];
  for (const item of eligible) {
    const rows = [...item.rows].sort(byDate);
    const name = findingName(item, catalog);
    // Check a clean price change before considering a variable utility bill.
    // Both price levels must independently be supported by complete monthly rows.
    const step = cleanIncrease(rows);
    const verified = cleanIncrease(rows.filter(complete));
    if (item.canConfirm && step && verified && step.previous === verified.previous && step.current === verified.current &&
        (step.delta >= 500 || step.delta * 100 >= step.previous * 10)) {
      candidates.push({
        ...base(item, "price-increase", 1, rows, catalog),
        baselineCents: step.previous,
        currentCents: step.current,
        monthlyCents: step.delta,
        yearlyCents: step.delta * 12,
        headline: `Call ${name} about the price.`,
        evidence: `You paid ${shortMoney(step.previous)} in ${months(rows.slice(0, step.firstNew))}, then ${shortMoney(step.current)} in ${months(rows.slice(step.firstNew))}.`,
        action: "Ask what changed and whether they'll restore your previous rate.",
        savings: `If they do, that's ${shortMoney(step.delta)} a month, or ${shortMoney(step.delta * 12)} a year before fees.`,
      });
    } else if (processorName.test(merchantKey(item.latest.description))) {
      const descriptor = merchantKey(item.latest.description);
      const history = descriptor.startsWith("APPLE.COM/BILL") ? "your Apple purchase history" :
        descriptor.startsWith("PAYPAL") ? "your PayPal activity" : "the receipt or your purchase history";
      candidates.push({
        ...base(item, "unidentified", 3, rows, catalog),
        headline: `Identify the ${shortMoney(item.latestCents)} ${name} charge.`,
        evidence: `It appeared ${cadence(rows)}.`,
        action: `Check ${history} to see what it covers.`,
        savings: "The description alone gives us too little to recommend canceling it or estimate a saving.",
      });
    } else if (item.variable && item.canConfirm && item.latestCents * 100 >= item.typicalCents * 125 &&
        item.latestCents - item.typicalCents >= 500) {
      candidates.push({
        ...base(item, "variable-jump", 4, rows, catalog),
        baselineCents: item.typicalCents,
        headline: `Check why your ${name} bill jumped.`,
        evidence: `Your latest bill was ${shortMoney(item.latestCents)}, compared with the median bill of ${shortMoney(item.typicalCents)} across ${rows.length} bills.`,
        action: "Check the latest bill for usage changes or new fees.",
        savings: "We can't estimate a saving until you know what caused the higher bill.",
      });
    }
  }

  const video = eligible.filter(item => item.included && item.canConfirm &&
    ["on-demand video", "live TV"].includes(catalogEntry(item, catalog)?.kind) &&
    item.rows.filter(complete).length >= 3 && monthly([...item.rows].filter(complete).sort(byDate)) && complete(item.latest));
  // Group by observed complete months, so an older account cannot hide a newer overlap.
  const observedMonths = [...new Set(video.flatMap(item => item.rows.filter(complete).map(row => row.date.slice(0, 7))))].sort();
  const cohorts = new Map();
  for (const month of observedMonths) {
    const members = video.filter(item => item.rows.some(row => complete(row) && row.date.startsWith(month)))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (members.length >= 3) cohorts.set(JSON.stringify(members.map(item => item.id)), members);
  }
  const maximal = [...cohorts.values()].filter(members => ![...cohorts.values()].some(other =>
    other.length > members.length && members.every(item => other.includes(item))))
    .sort((a, b) => b.length - a.length || JSON.stringify(a.map(item => item.id)).localeCompare(JSON.stringify(b.map(item => item.id))));
  const pickedIds = new Set();
  for (const cohort of maximal) {
    const picked = cohort.filter(item => catalogEntry(item, catalog).kind === "on-demand video")
      .sort((a, b) => a.latestCents - b.latestCents || a.id.localeCompare(b.id))[0];
    if (!picked || pickedIds.has(picked.id)) continue;
    pickedIds.add(picked.id);
    const members = [picked, ...cohort.filter(item => item !== picked)];
    const name = findingName(picked, catalog);
    const groups = members.map(item => ({
      findingId: item.id, name: findingName(item, catalog), rowIds: [...item.rows].sort(byDate).map(row => row.id),
    }));
    candidates.push({
      ...base(picked, "overlap", 2, members.flatMap(item => item.rows), catalog),
      baselineCents: picked.latestCents,
      monthlyCents: picked.latestCents,
      yearlyCents: picked.latestCents * 12,
      rowIds: groups.flatMap(group => group.rowIds),
      groups,
      headline: `Check whether you still use ${name}.`,
      evidence: `You pay ${shortMoney(picked.latestCents)} a month for ${name} alongside ${naturalList(groups.slice(1).map(group => group.name))}.`,
      action: `Check which of these video services you rarely open.`,
      savings: `If ${name} is the one you rarely open, canceling it would save ${dollars(picked.latestCents * 12)} over 12 months at the current price.`,
    });
  }

  return candidates.sort((a, b) => a.tier - b.tier ||
    (a.tier <= 2 ? b.yearlyCents - a.yearlyCents : a.tier === 3 ? b.currentCents - a.currentCents :
      (b.currentCents - b.baselineCents) - (a.currentCents - a.baselineCents)) || a.id.localeCompare(b.id))
    .slice(0, 3).map(item => ({ ...item,
      evidence: item.evidence + (item.incomplete ? " Based in part on an incomplete statement." : ""),
    }));
}
