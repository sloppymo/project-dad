# PDF.js 6.5.438

Unmodified compatibility-build text-reader assets from Mozilla's official [6.5.438 release](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438), licensed under Apache-2.0 (see `LICENSE`). Font and CMap license notices are retained in their directories. Only `build/pdf.mjs`, `build/pdf.worker.mjs`, `web/standard_fonts/` and `web/cmaps/` are included; the viewer, scripting sandbox, render worker and image decoders are not used.

Release archive SHA-256: `55138aa33b5f1f6f68809895338b947f395f344eb6381d424b2420d6daa6a844`.

`manifest.json` records the upstream release and each vendored file's SHA-256. `npm run build:pages` verifies those hashes. The app loads these files from its own origin; it makes no CDN request and never uploads selected PDFs.
