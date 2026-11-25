import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { extractPdf, maxFileBytes } from "./lib/pdf.mjs";
import { ImportError } from "./lib/statement.mjs";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ...["app", "ledger", "recurrence", "workflow", "catalog", "savings"].map(name =>
    [`/${name}.mjs`, [`${name}.mjs`, "text/javascript; charset=utf-8"]]),
  ...[
    "harbor-checking-jan-mar",
    "summit-card-jan-mar",
    "summit-card-feb-apr",
    "unsupported-statement",
    "harbor-checking-apr-partial",
  ].map(name => [`/samples/${name}.pdf`, [`samples/${name}.pdf`, "application/pdf"]]),
]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: securityHeaders });
}

async function readBody(request) {
  if (Number(request.headers.get("content-length")) > maxFileBytes) {
    throw new ImportError("Select a PDF that is 12 MB or smaller.");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.body ?? []) {
    bytes += chunk.length;
    if (bytes > maxFileBytes) throw new ImportError("Select a PDF that is 12 MB or smaller.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

let activeImports = 0;

export async function handleRequest(request) {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return json({ error: "Open the app on localhost." }, 403);
  if (request.method === "POST" && url.pathname === "/api/extract") {
    const origin = request.headers.get("origin");
    if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ error: "Select files from the Project Dad tab." }, 403);
    }
    if (request.headers.get("content-type") !== "application/pdf") {
      return json({ error: "Select a PDF statement." }, 415);
    }
    if (activeImports >= 2) return json({ error: "The reader is busy. Select this file again in a moment." }, 429);
    activeImports++;
    try {
      return json(await extractPdf(await readBody(request)));
    } catch (error) {
      if (error instanceof ImportError) return json({ error: error.message }, 422);
      return json({ error: "The local PDF reader could not finish. Try the file again." }, 500);
    } finally {
      activeImports--;
    }
  }
  const asset = request.method === "GET" && assets.get(url.pathname);
  if (!asset) return json({ error: "Page not found." }, 404);
  try {
    const [file, type] = asset;
    const bytes = await readFile(new URL(`./public/${file}`, import.meta.url));
    return new Response(bytes, { headers: { ...securityHeaders, "Content-Type": type } });
  } catch {
    return json({ error: "This app file could not be loaded." }, 500);
  }
}

export function startServer(port = 4173) {
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.host !== req.headers.host) {
        res.writeHead(403, securityHeaders).end();
        return;
      }
      const upload = req.method === "POST";
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(upload ? { body: Readable.toWeb(req), duplex: "half" } : {}),
      });
      const response = await handleRequest(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(400, securityHeaders);
      res.end();
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 4173);
  const server = startServer(port);
  server.on("listening", () => console.log(`Project Dad is ready at http://127.0.0.1:${server.address().port}`));
  server.on("error", error => {
    console.error(`Could not start Project Dad on 127.0.0.1:${port} (${error.code}).`);
    process.exitCode = 1;
  });
}
