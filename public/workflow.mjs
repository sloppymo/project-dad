import { addDocument, emptyState } from "./ledger.mjs";

export const storageKey = "project-dad:v1";

export function openStore(storage, lock = update => update()) {
  function load() {
    const saved = storage.getItem(storageKey);
    if (!saved) return emptyState();
    const state = JSON.parse(saved);
    if (state.version !== 1 || !Array.isArray(state.documents) || !state.reviews) {
      throw new Error("This browser has unreadable saved data.");
    }
    return state;
  }
  function update(change) {
    return lock(() => {
      const previous = load();
      const next = change(previous);
      if (next !== previous) storage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }
  return { load, update };
}

export function checkPdfFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    throw new Error("Select a PDF statement.");
  }
  if (file.size > 12 * 1024 * 1024) throw new Error("Select a PDF that is 12 MB or smaller.");
}

export async function extractFile(file, request = fetch) {
  checkPdfFile(file);
  let response;
  try {
    response = await request("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
  } catch {
    throw new Error("The local reader is unreachable. Check that Project Dad is running and try again.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "This file could not be read.");
  return result;
}

export async function importBatch(files, { store, extract = extractFile, onProgress, onSaved }) {
  const receipt = files.map(file => ({ name: file.name, status: "queued", message: "Waiting" }));
  onProgress(receipt);
  for (const [index, file] of files.entries()) {
    const row = receipt[index];
    row.status = "reading";
    row.message = "Reading PDF…";
    onProgress(receipt);
    try {
      const extraction = await extract(file);
      let duplicate;
      let saved;
      try {
        saved = await store.update(state => {
          const result = addDocument(state, file.name, extraction);
          duplicate = result.duplicate;
          return result.state;
        });
      } catch {
        throw new Error("The browser could not save this statement. Check your available browser storage.");
      }
      row.status = duplicate ? "duplicate" : extraction.status;
      row.message = duplicate ? "Already imported" : extraction.status === "partial"
        ? `Partial import · ${extraction.rows.length} readable rows`
        : `Imported · ${extraction.rows.length} rows`;
      onSaved(saved);
    } catch (error) {
      row.status = "failed";
      row.message = error.message || "The file could not be imported.";
    }
    onProgress(receipt);
  }
  return receipt;
}

export function changeReview(state, id, changes) {
  const review = { ...state.reviews[id], ...changes };
  const reviews = { ...state.reviews };
  if (review.name || review.assessment || review.action) reviews[id] = review;
  else delete reviews[id];
  return { ...state, reviews };
}
