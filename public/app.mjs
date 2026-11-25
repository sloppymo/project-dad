import { accountLabel, actions, buildLedger, dollars, emptyState, formatDay, typeLabels } from "./ledger.mjs";
import { findRecurring } from "./recurrence.mjs";
import { findingName } from "./catalog.mjs";
import { coverageSentence, findSavings } from "./savings.mjs";
import { changeReview, extractFile, importBatch, openStore, storageKey } from "./workflow.mjs";

const $ = id => document.getElementById(id);
const html = value => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const titleCase = value => value.toLowerCase().replace(/\b[a-z]/g, char => char.toUpperCase());
const rangeLabel = ({ start, end }) => `${formatDay(start)} to ${formatDay(end)}`;
const extract = document.documentElement.dataset.reader === "browser"
  ? async file => (await import("./pdf-browser.mjs")).extractBrowserFile(file)
  : extractFile;
const lock = update => navigator.locks ? navigator.locks.request(storageKey, update) : update();
const store = openStore({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
}, lock);

let state = emptyState();
let model;
let savings = [];
const openCharges = new Set();
let findingFilter = "all";
let ledgerFilter = "all";
let openFinding = null;
let editing = false;
let busy = false;

function announce(message) {
  $("announcer").textContent = message;
}

function storageError(message) {
  $("storage-error").hidden = !message;
  $("storage-error").textContent = message;
}

function reloadState() {
  try {
    state = store.load();
    storageError("");
  } catch {
    storageError("This browser could not load your saved reviews. Check its local storage settings.");
  }
}

function estimateMarkup(ledger, recurring) {
  if (!state.documents.length) {
    return `<div class="overview empty-overview">
      <p class="overview-label">Monthly estimate</p>
      <h2>Start with your statements</h2>
      <p>Include several months of activity so repeated charges stand out.</p>
    </div>`;
  }
  return `<div class="panel estimate-context">
    <p class="overview-label">Estimated repeating charges</p>
    <p class="estimate-amount"><strong id="monthly-total">${recurring.included.length ? dollars(recurring.monthlyCents) : "—"}</strong><span>a month · ${plural(recurring.included.length, "charge")}</span></p>
    <p class="estimate-count">${recurring.needsReview.length ? `${plural(recurring.needsReview.length, "charge")} awaiting confirmation. ` : ""}Variable bills use the median amount.</p>
    <p class="scope-sentence">${html(coverageSentence(ledger.coverage, state.documents))}</p>
  </div>`;
}

function savingsChargesMarkup(recommendation, rowsById) {
  return recommendation.groups.map(group => `<div class="charge-group">
    ${recommendation.type === "overlap" ? `<h4>${html(group.name)}</h4>` : ""}
    <ul class="savings-charges">${group.rowIds.map(id => {
      const row = rowsById.get(id);
      return `<li class="savings-charge" data-row-id="${html(row.id)}">
        <div class="evidence-top">
          <div><strong>${html(group.name)}</strong><span class="original-descriptor">${html(row.description)}</span>
            <time datetime="${row.date}">${formatDay(row.date)}</time></div>
          <strong class="row-amount">${dollars(-row.amountCents)}</strong>
        </div>
        ${[...row.sources].sort((a, b) => a.documentId.localeCompare(b.documentId) || a.page - b.page || a.line - b.line).map(source => `
          <div class="charge-source"><p>${html(source.name)} · page ${source.page} · line ${source.line}${source.status === "partial" ? " · partial import" : ""}</p>
          <pre>${html(source.excerpt)}</pre></div>`).join("")}
      </li>`;
    }).join("")}</ul>
  </div>`).join("");
}

function savingsMarkup(ledger) {
  const rowsById = new Map(ledger.rows.map(row => [row.id, row]));
  return `<div class="review-intro">
      <p class="eyebrow">A few things worth checking</p>
      <h2 id="savings-heading" tabindex="-1">Your savings review</h2>
      <p class="scope-sentence">${html(coverageSentence(ledger.coverage, state.documents))}</p>
    </div>
    ${savings.length ? `<ol class="recommendations">${savings.map((item, index) => {
      const expanded = openCharges.has(item.id);
      return `<li class="recommendation" data-recommendation-id="${html(item.id)}">
        <span class="recommendation-number" aria-hidden="true">${index + 1}</span>
        <div class="recommendation-content">
          <h3>${html(item.headline)}</h3>
          <p class="recommendation-evidence">${html(item.evidence)}</p>
          <p>${html(item.action)}</p>
          <p class="recommendation-savings">${html(item.savings)}</p>
          <button type="button" class="button secondary show-charges" data-action="show-charges" data-id="${html(item.id)}"
            aria-expanded="${expanded}" aria-controls="savings-charges-${index}">Show charges<span class="chevron" aria-hidden="true"></span></button>
          <div id="savings-charges-${index}" class="charges-disclosure" ${expanded ? "" : "hidden"}>${savingsChargesMarkup(item, rowsById)}</div>
        </div>
      </li>`;
    }).join("")}</ol>` : `<div class="panel empty-state"><div><h3>No suggestions from these statements yet</h3>
      <p>Add more months, or check the full list of repeating charges below. Kept and dismissed charges stay out of this review.</p></div></div>`}
    <p class="quiet-note">You take any action yourself. Project Dad doesn't contact providers, cancel services or move money.</p>`;
}

function evidenceSources(row) {
  const [first, ...others] = row.sources;
  return `<details class="evidence-sources">
    <summary><span>${html(first.name)} · page ${first.page}${others.length ? ` (+${plural(others.length, "source")})` : ""}</span></summary>
    <ul>${row.sources.map(source => `<li>
      <p>${html(source.name)} · page ${source.page} · line ${source.line}${source.status === "partial" ? " · partial import" : ""}</p>
      <pre>${html(source.excerpt)}</pre>
    </li>`).join("")}</ul>
  </details>`;
}

function evidenceRow(row) {
  return `<li class="evidence-row">
    <div class="evidence-top">
      <div><strong>${html(row.description)}</strong><span>${formatDay(row.date)}${row.sources.some(source => source.status === "complete") ? "" : " · Partial import"}</span></div>
      <strong class="row-amount">${dollars(-row.amountCents)}</strong>
    </div>
    ${evidenceSources(row)}
  </li>`;
}

function correctionMarkup(item) {
  const current = item.review.assessment ?? "";
  return `<form id="correction-form" data-id="${html(item.id)}" class="correction-form">
    <label for="edit-name">Merchant name</label>
    <input id="edit-name" name="merchant" maxlength="80" value="${html(item.review.name ?? "")}" placeholder="${html(item.originalName)}">
    <label for="edit-assessment">Recurring assessment</label>
    <select id="edit-assessment" name="assessment">
      <option value="" ${!current ? "selected" : ""}>Use the app’s assessment</option>
      <option value="confirmed" ${current === "confirmed" ? "selected" : ""} ${item.canConfirm ? "" : "disabled"}>Confirm as monthly</option>
      <option value="dismissed" ${current === "dismissed" ? "selected" : ""}>Dismiss as a recurring expense</option>
    </select>
    ${item.canConfirm ? "" : "<p>Review the statement coverage or conflicting charges before confirming.</p>"}
    <div class="form-buttons">
      <button type="submit" class="button primary">Save correction</button>
      <button type="button" class="button secondary" data-action="close-edit">Back</button>
      ${current || item.review.name ? `<button type="button" class="text-button" data-action="undo-correction" data-id="${html(item.id)}">Undo correction</button>` : ""}
    </div>
  </form>`;
}

function findingDetail(item, index) {
  const nextAction = item.increase ? "Compare the current plan or bill with the one before the increase." :
    !item.included ? "Check the provider receipt or account history to identify the charge." :
    item.variable ? "Check the latest bill for usage changes or new fees." : "Check whether you still use this service.";
  return `<div id="finding-detail-${index}" class="finding-detail">
    <h3>Why it was flagged</h3>
    <p>${html(item.explanation)}</p>
    <p class="included-note">${item.included
      ? `The monthly estimate includes ${dollars(item.monthlyCents)}${item.variable ? " based on the median bill" : " based on the latest charge"}.`
      : item.dismissed ? "You dismissed this finding." : "This charge is awaiting confirmation and is outside the estimate."}</p>
    <div class="action-panel">
      <fieldset>
        <legend>Your decision</legend>
        <p>${nextAction}</p>
        <div class="decision-buttons">
          ${actions.map(action => `<button type="button" class="button decision" data-action="decision"
            data-id="${html(item.id)}" data-value="${action}" aria-pressed="${item.review.action === action}">${action}</button>`).join("")}
          ${item.review.action ? `<button type="button" class="text-button" data-action="decision" data-id="${html(item.id)}" data-value="">Clear choice</button>` : ""}
        </div>
      </fieldset>
    </div>
    <div class="evidence-heading">
      <h3>Statement evidence <span>${item.rows.length}</span></h3>
      <button type="button" class="text-button" data-action="edit" data-id="${html(item.id)}" aria-expanded="${editing}">Correct finding</button>
    </div>
    ${editing ? correctionMarkup(item) : ""}
    <ul class="evidence-list">${item.rows.map(evidenceRow).join("")}</ul>
  </div>`;
}

function findingItem(item, index) {
  const isOpen = item.id === openFinding;
  const indicator = item.increase && item.included && !item.review.assessment
    ? `Price rose ${dollars(item.increase.delta)}` : item.label;
  const tone = item.dismissed ? "neutral" : !item.included || item.increase ? "attention" : "steady";
  return `<li class="finding ${isOpen ? "finding-open" : ""}">
    <button type="button" class="finding-toggle" data-action="toggle" data-id="${html(item.id)}"
      aria-expanded="${isOpen}" ${isOpen ? `aria-controls="finding-detail-${index}"` : ""}>
      <span class="finding-body">
        <span class="finding-name">${html(item.name)}</span>
        <span class="original-descriptor">${html(item.latest.description)}</span>
        <span class="finding-account">${accountLabel(item.account)}${item.canConfirm ? " · Monthly" : ""}</span>
        <span class="finding-tags">
          <span class="pill ${tone}">${indicator}</span>
          ${item.variable && item.included ? `<span class="typical">Typical ${dollars(item.typicalCents)}</span>` : ""}
          ${item.review.action ? `<span class="pill neutral">${html(item.review.action)}</span>` : ""}
        </span>
      </span>
      <span class="finding-price"><strong>${dollars(item.latestCents)}</strong><span>${formatDay(item.latest.date)}</span></span>
      <span class="chevron" aria-hidden="true"></span>
    </button>
    ${isOpen ? findingDetail(item, index) : ""}
  </li>`;
}

function findingsMarkup(recurring, open) {
  const active = recurring.findings.filter(item => !item.dismissed);
  const dismissed = recurring.findings.filter(item => item.dismissed);
  const filters = [
    ["all", "All", active],
    ["needs", "Needs confirmation", active.filter(item => !item.included)],
    ...(dismissed.length ? [["dismissed", "Dismissed", dismissed]] : []),
  ];
  if (!filters.some(([key]) => key === findingFilter)) findingFilter = "all";
  const items = filters.find(([key]) => key === findingFilter)[2];
  return `<details id="repeating-details" class="panel repeating-details" ${open ? "open" : ""}>
    <summary id="findings-heading">All repeating charges <span>${plural(active.length, "charge")}</span></summary>
    <div class="repeating-content">${recurring.findings.length ? `<div class="filters" aria-label="Filter expenses">
      ${filters.map(([key, label, entries]) => `<button type="button" class="filter" data-action="filter" data-value="${key}" aria-pressed="${key === findingFilter}">${label} <span>${entries.length}</span></button>`).join("")}
    </div>` : ""}
    ${items.length ? `<ul class="finding-list">${items.map(findingItem).join("")}</ul>` : `
    <div class="panel empty-state">
      <span class="empty-icon" aria-hidden="true"></span>
      <div><h3>${findingFilter === "needs" ? "Nothing awaiting confirmation" : state.documents.length ? "No recurring pattern in this view" : "No statements imported yet"}</h3>
      <p>${state.documents.length ? "Compare more months or change the filter to see other findings." : "Choose PDFs or try the sample statements."}</p></div>
    </div>`}</div></details>`;
}

function statementMarkup(statement) {
  const partial = statement.status === "partial";
  const check = partial ? `${plural(statement.rows.length, "verified row")} · check the import issues` :
    `${plural(statement.rows.length, "row")} reconciled with printed totals`;
  return `<li class="statement-entry">
    <div class="statement-title"><strong>${html(statement.name)}</strong><span class="pill ${partial ? "attention" : "steady"}">${partial ? "Partial" : "Complete"}</span></div>
    <p>${rangeLabel(statement.period)}</p><p>${check}</p>
    ${partial ? `<ul class="statement-issues">${statement.issues.map(issue => `<li>
      ${issue.page ? `Page ${issue.page} · ` : ""}${html(issue.message)}
      ${issue.excerpt ? `<pre>${html(issue.excerpt)}</pre>` : ""}
    </li>`).join("")}</ul>` : ""}
  </li>`;
}

function coverageMarkup(ledger, open) {
  return `<h2 id="coverage-heading">Statement coverage</h2>
    ${ledger.coverage.length ? `<ul class="coverage-list">${ledger.coverage.map(({ account, ranges, partials }) => `
      <li class="coverage-account">
        <span class="account-icon ${account.kind}" aria-hidden="true"></span>
        <div><strong>${html(titleCase(account.institution))}</strong>
          <p>${accountLabel(account)}</p>
          ${ranges.map(period => `<p class="covered">${rangeLabel(period)}</p>`).join("")}
          ${partials.map(period => `<p class="partial-range">Partial · ${rangeLabel(period)}</p>`).join("")}
        </div>
      </li>`).join("")}</ul>
      <details id="statement-details" class="coverage-details" ${open ? "open" : ""}>
        <summary>Imported statements <span>${state.documents.length}</span></summary>
        <ul class="statement-list">${state.documents.map(statementMarkup).join("")}</ul>
      </details>` : `<p class="panel-copy">Imported accounts and their statement periods will appear here.</p>`}`;
}

function ledgerMarkup(ledger, open) {
  if (!state.documents.length) return "";
  const rows = ledger.rows.filter(row => ledgerFilter === "all" ||
    (ledgerFilter === "unclear" && (row.type === "unclear" || row.overlapConflict)) ||
    (ledgerFilter === "excluded" && ["payment", "transfer"].includes(row.type)));
  return `<details id="ledger-details" class="panel ledger-details" ${open ? "open" : ""}>
    <summary><span>Transaction ledger</span><span class="ledger-count">${plural(ledger.rows.length, "row")}${ledger.uncertainCount ? ` · ${ledger.uncertainCount} unclear` : ""}</span></summary>
    <div class="ledger-content">
      <div class="ledger-overview">
        <div><strong id="purchase-total">${dollars(ledger.purchaseCents)}</strong><span>Purchase debits across imported periods</span></div>
        <p>${plural(ledger.excludedPaymentCount, "card payment")} and ${plural(ledger.excludedTransferCount, "transfer")} excluded${ledger.uncertainCount ? `. ${plural(ledger.uncertainCount, "unclear row")} withheld.` : "."} Credits and refunds are listed separately.</p>
      </div>
      <label class="ledger-filter" for="ledger-filter">Show transactions
        <select id="ledger-filter">
          ${[["all", "All"], ["unclear", "Needs row review"], ["excluded", "Card payments and transfers"]].map(([key, label]) =>
    `<option value="${key}" ${ledgerFilter === key ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      ${rows.length ? `<ul class="ledger-rows">${rows.map(row => `<li class="ledger-row">
        <div class="evidence-top">
          <div><strong>${html(row.description)}</strong><span>${formatDay(row.date)} · ${accountLabel(row.account)} · ${typeLabels[row.type]}</span></div>
          <strong class="row-amount">${dollars(row.type === "expense" ? -row.amountCents : row.amountCents)}</strong>
        </div>
        ${row.overlapConflict ? "<p class='overlap-note'>Overlapping statements disagree about this row count. Check the originals.</p>" : ""}
        ${evidenceSources(row)}
      </li>`).join("")}</ul>` : "<p class='panel-copy'>No transactions match this filter.</p>"}
    </div>
  </details>`;
}

function render() {
  const ledger = buildLedger(state.documents);
  const recurring = findRecurring(ledger, state.reviews);
  savings = findSavings(ledger, recurring);
  model = { ...recurring, findings: recurring.findings.map(item => ({ ...item, name: findingName(item) })) };
  document.querySelector(".workspace").classList.toggle("has-statements", Boolean(state.documents.length));
  $("find-savings").hidden = !state.documents.length;
  $("savings-review").hidden = !state.documents.length;
  $("savings-review").innerHTML = state.documents.length ? savingsMarkup(ledger) : "";
  $("overview").innerHTML = estimateMarkup(ledger, recurring);
  $("findings").innerHTML = findingsMarkup(model, $("repeating-details")?.open);
  $("coverage").innerHTML = coverageMarkup(ledger, $("statement-details")?.open);
  $("ledger").innerHTML = ledgerMarkup(ledger, $("ledger-details")?.open);
}

function showSavings(focus = true) {
  if (!state.documents.length) return;
  if (focus) $("savings-heading").focus();
  announce(`${plural(savings.length, "way")} to save found`);
}

function focusFinding(id, action = "toggle", value) {
  const button = [...document.querySelectorAll("#findings button[data-id]")].find(element =>
    element.dataset.id === id && element.dataset.action === action &&
    (value === undefined || element.dataset.value === value));
  button?.focus({ preventScroll: true });
  return button;
}

function progress(receipt) {
  const done = receipt.filter(row => !["queued", "reading"].includes(row.status)).length;
  const failed = receipt.filter(row => row.status === "failed").length;
  const partial = receipt.filter(row => row.status === "partial").length;
  $("import-progress").textContent = `${done} of ${receipt.length} files checked${failed ? ` · ${failed} failed` : ""}${partial ? ` · ${partial} partial` : ""}`;
  $("import-receipts").hidden = false;
  $("import-receipts").innerHTML = receipt.map(row => `<li class="receipt ${row.status}">
    <strong>${html(row.name)}</strong><span>${html(row.message)}</span>
  </li>`).join("");
}

async function runImport(loadFiles, trigger) {
  if (busy) return;
  busy = true;
  $("choose-files").disabled = true;
  $("load-samples").disabled = true;
  $("drop-zone").disabled = true;
  $("find-savings").disabled = true;
  $("import-progress").hidden = false;
  $("import-progress").textContent = "Preparing PDFs…";
  $("import-receipts").hidden = true;
  $("import-result").hidden = true;
  let review = false;
  try {
    const files = await loadFiles();
    const receipt = await importBatch(files, {
      store,
      extract,
      onProgress: progress,
      onSaved: next => {
        state = next;
        storageError("");
        render();
      },
    });
    review = receipt.some(row => row.status === "complete" || row.status === "partial");
    const failed = receipt.filter(row => row.status === "failed").length;
    const partial = receipt.filter(row => row.status === "partial").length;
    if (failed || partial) {
      const details = [failed && `${plural(failed, "PDF")} could not be read`, partial && `${partial} partially imported`].filter(Boolean);
      $("import-result-text").textContent = `${details.join(" and ")}.`;
      $("import-result").hidden = false;
    }
  } catch {
    $("import-progress").textContent = "The sample files could not be loaded. Download them and choose the PDFs.";
  } finally {
    busy = false;
    $("choose-files").disabled = false;
    $("load-samples").disabled = false;
    $("drop-zone").disabled = false;
    $("find-savings").disabled = false;
  }
  const canFocus = !document.activeElement || [document.body, $("file-input"), trigger].includes(document.activeElement);
  if (review) showSavings(canFocus);
  else if (canFocus) $("import-progress").focus();
}

$("find-savings").addEventListener("click", () => { render(); showSavings(); });
$("choose-files").addEventListener("click", () => $("file-input").click());
$("drop-zone").addEventListener("click", () => $("file-input").click());
let dragDepth = 0;
$("drop-zone").addEventListener("dragenter", event => {
  event.preventDefault();
  if (!busy) { dragDepth++; $("drop-zone").classList.add("drag-over"); }
});
$("drop-zone").addEventListener("dragover", event => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
});
$("drop-zone").addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("drop-zone").classList.remove("drag-over");
});
$("drop-zone").addEventListener("drop", event => {
  event.preventDefault();
  dragDepth = 0;
  $("drop-zone").classList.remove("drag-over");
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) void runImport(() => files, $("drop-zone"));
});
$("file-input").addEventListener("change", event => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length) void runImport(() => files, $("choose-files"));
});
$("load-samples").addEventListener("click", () => runImport(async () => {
  const names = ["harbor-checking-jan-mar.pdf", "summit-card-jan-mar.pdf"];
  return Promise.all(names.map(async name => {
    const response = await fetch(new URL(`./samples/${name}`, import.meta.url));
    if (!response.ok) throw new Error("Sample unavailable");
    return new File([await response.blob()], name, { type: "application/pdf" });
  }));
}, $("load-samples")));

async function saveReview(id, changes, message) {
  try {
    state = await store.update(current => changeReview(current, id, changes));
    storageError("");
    announce(message);
    return true;
  } catch {
    storageError("The browser could not save this choice. Check its local storage settings.");
    return false;
  }
}

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id, value } = button.dataset;
  if (action === "decision") {
    if (value && !actions.includes(value)) return;
    if (!await saveReview(id, { action: value || null }, value ? `Saved “${value}”.` : "Choice cleared.")) return;
    render();
    focusFinding(id, "decision", value) ?? focusFinding(id);
    return;
  }
  if (action === "undo-correction") {
    if (!await saveReview(id, { name: null, assessment: null }, "Correction undone.")) return;
    findingFilter = "all";
    editing = false;
    render();
    focusFinding(id, "edit");
    return;
  }
  switch (action) {
    case "show-charges": {
      const expanded = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(expanded));
      $(button.getAttribute("aria-controls")).hidden = !expanded;
      if (expanded) openCharges.add(id);
      else openCharges.delete(id);
      break;
    }
    case "import-details":
      $("import-progress").focus();
      break;
    case "jump":
      findingFilter = "all";
      openFinding = id;
      editing = false;
      render();
      $("repeating-details").open = true;
      focusFinding(id)?.scrollIntoView({ block: "nearest" });
      break;
    case "toggle":
      openFinding = openFinding === id ? null : id;
      editing = false;
      render();
      focusFinding(id);
      break;
    case "edit":
      editing = !editing;
      render();
      if (editing) $("edit-name").focus();
      else focusFinding(id, "edit");
      break;
    case "close-edit":
      editing = false;
      render();
      focusFinding(openFinding, "edit");
      break;
    case "filter":
      findingFilter = value;
      openFinding = null;
      editing = false;
      render();
      document.querySelector("#findings button[aria-pressed='true']")?.focus();
      break;
  }
});

document.addEventListener("submit", async event => {
  if (event.target.id !== "correction-form") return;
  event.preventDefault();
  const id = event.target.dataset.id;
  const item = model.findings.find(finding => finding.id === id);
  const form = new FormData(event.target);
  const name = String(form.get("merchant") ?? "").trim();
  const assessment = form.get("assessment") || null;
  if (!item || (assessment === "confirmed" && !item.canConfirm)) return;
  if (!await saveReview(id, { name: name || null, assessment }, "Correction saved.")) return;
  findingFilter = assessment === "dismissed" ? "dismissed" : "all";
  editing = false;
  render();
  focusFinding(id, "edit");
});

document.addEventListener("change", event => {
  if (event.target.id !== "ledger-filter") return;
  ledgerFilter = event.target.value;
  $("ledger").innerHTML = ledgerMarkup(buildLedger(state.documents), true);
  $("ledger-filter").focus();
});

window.addEventListener("storage", event => {
  if (event.key !== storageKey) return;
  reloadState();
  render();
});
reloadState();
render();
