import { ImportError, interpretStatement, validateStatement } from "./statement.mjs";
import { checkPdfFile } from "./workflow.mjs";
import { textLines } from "./pdf-text.mjs";

export async function extractBrowserFile(file) {
  checkPdfFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) {
    throw new ImportError("This file is not a readable PDF.");
  }
  if (!globalThis.crypto?.subtle) throw new ImportError("Open this site over HTTPS to read PDFs.");
  // Hash before PDF.js transfers its input to the worker. Same ID as Poppler mode.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  let pdfjs;
  try {
    pdfjs = await import("./vendor/pdfjs/pdf.mjs");
  } catch {
    throw new ImportError("The PDF reader could not load. Refresh the page and try again.");
  }
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
    cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href,
    cMapPacked: true,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    enableWebGPU: false,
    disableWorkerRendering: true,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void task.destroy(); }, 20_000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 24) throw new ImportError("Select a PDF with 24 pages or fewer.");
    if (await pdf.getPermissions() !== null) throw new ImportError("This PDF is encrypted. Select an unlocked copy.");
    const pages = [];
    const issues = [];
    let characters = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      try {
        const source = await pdf.getPage(page);
        const text = await source.getTextContent();
        const lines = textLines(text.items);
        characters += lines.reduce((sum, line) => sum + line.length, 0);
        if (characters > 1_500_000) throw new ImportError("This PDF exceeded the reading limit. Try a shorter statement.");
        pages.push(lines);
        source.cleanup();
      } catch (error) {
        if (error instanceof ImportError || timedOut) throw error;
        pages.push([]);
        issues.push({ page, message: "This page's text could not be read. Check the original statement." });
      }
    }
    const statement = validateStatement(interpretStatement(pages), pages);
    if (issues.length) { statement.status = "partial"; statement.issues.push(...issues); }
    return { id, ...statement };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (timedOut) throw new ImportError("This PDF exceeded the reading limit. Try a shorter statement.");
    if (error.name === "PasswordException") throw new ImportError("This PDF is password protected. Select an unlocked copy.");
    throw new ImportError("This PDF could not be read. Select a valid, unlocked statement PDF.");
  } finally {
    clearTimeout(timeout);
    await task.destroy();
  }
}
