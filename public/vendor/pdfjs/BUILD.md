# PDF.js distribution

Version: 6.4.299. Both `pdf.mjs` and `pdf.worker.mjs` are the unmodified
official **legacy** builds from `pdfjs-dist@6.4.299`, `legacy/build/`.
Package: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz

The legacy build embeds upstream compatibility in both realms. Use it for
every PDF viewer and render/export path. Do not replace either module with
the modern build or reintroduce individual API shims. Existing cmaps, fonts
and wasm assets are from the same version.

Regression: `test/pdf-compat.test.mjs` removes modern Map, Uint8Array and
Promise methods in the browser page and a real Worker, then verifies PDF
fingerprinting, text extraction and canvas rendering.
