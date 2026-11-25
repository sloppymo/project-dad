import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const vendor = new URL("../vendor/pdfjs/", import.meta.url);
// Verify the pinned, self-hosted dependency before packaging. No CDN at runtime.
const manifest = JSON.parse(await readFile(new URL("manifest.json", vendor), "utf8"));
for (const [file, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(file, vendor));
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`PDF.js integrity check failed: ${file}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("public/", root), output, { recursive: true });
await cp(vendor, new URL("vendor/pdfjs/", output), { recursive: true });
await cp(new URL("lib/statement.mjs", root), new URL("statement.mjs", output));
await cp(new URL("output/pdf/cardiff-credit-card-statement.pdf", root), new URL("samples/cardiff-credit-card-statement.pdf", output));
let index = await readFile(new URL("index.html", output), "utf8");
index = index.replace('<html lang="en">', '<html lang="en" data-reader="browser">')
  .replace("<head>", `<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'">
  <meta name="referrer" content="no-referrer">`)
  .replace("Local prototype", "Saved on this device")
  .replace("The local reader discards PDF copies after reading.", "PDFs are read on this device and are never uploaded.")
  .replace('<ul>\n              <li><a href="./samples/', '<ul>\n              <li><a href="./samples/cardiff-credit-card-statement.pdf" download>Cardiff credit card, July to October (fictional)</a></li>\n              <li><a href="./samples/');
await writeFile(new URL("index.html", output), index);
await writeFile(new URL(".nojekyll", output), "");
console.log(`GitHub Pages files are ready in ${fileURLToPath(output)} (PDF.js ${manifest.version}).`);
