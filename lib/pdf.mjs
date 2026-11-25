import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ImportError, interpretStatement, validateStatement } from "./statement.mjs";

const exec = promisify(execFile);
export const maxFileBytes = 12 * 1024 * 1024;
const maxPages = 24;

async function poppler(command, args) {
  try {
    return await exec(command, args, {
      encoding: "utf8",
      maxBuffer: 1_500_000,
      timeout: 8_000,
      env: { PATH: process.env.PATH, LC_ALL: "C" },
    });
  } catch (error) {
    if (error.code === "ENOENT") throw new ImportError("PDF reading requires Poppler. See the README for setup.");
    if (/password/i.test(error.stderr ?? "")) throw new ImportError("This PDF is password protected. Select an unlocked copy.");
    if (error.killed || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new ImportError("This PDF exceeded the local reading limit. Try a shorter statement.");
    }
    throw new ImportError("This PDF could not be read. Select a valid, unlocked statement PDF.");
  }
}

export async function readPdf(buffer) {
  if (buffer.length > maxFileBytes) throw new ImportError("Select a PDF that is 12 MB or smaller.");
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw new ImportError("This file is not a readable PDF.");
  }
  const dir = await mkdtemp(join(tmpdir(), "project-dad-"));
  try {
    const path = join(dir, "statement.pdf");
    await writeFile(path, buffer, { mode: 0o600 });
    const info = await poppler("pdfinfo", [path]);
    if (/^Encrypted:\s+yes\b/m.test(info.stdout)) throw new ImportError("This PDF is encrypted. Select an unlocked copy.");
    const pageCount = Number(/^Pages:\s+(\d+)/m.exec(info.stdout)?.[1]);
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new ImportError("The PDF page count could not be read.");
    if (pageCount > maxPages) throw new ImportError(`Select a PDF with ${maxPages} pages or fewer.`);
    const { stdout, stderr } = await poppler("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"]);
    const texts = stdout.split("\f");
    if (texts.at(-1) === "") texts.pop();
    if (texts.length !== pageCount) throw new ImportError("The PDF returned an unexpected number of source pages.");
    return {
      id: createHash("sha256").update(buffer).digest("hex"),
      pages: Object.freeze(texts.map(text => Object.freeze(text.split("\n")))),
      readerWarning: /(?:syntax (?:error|warning)|internal error)/i.test(`${info.stderr}\n${stderr}`),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extractPdf(buffer, interpret = interpretStatement) {
  const { id, pages, readerWarning } = await readPdf(buffer);
  const statement = validateStatement(await interpret(pages), pages);
  if (readerWarning) {
    statement.status = "partial";
    statement.issues.push({ page: null, message: "The PDF reader reported a document problem. Check the original statement." });
  }
  return { id, ...statement };
}
