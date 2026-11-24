# PPT layout patches (v2.4)

Upstream @aiden0z/pptx-renderer 1.4.0 is pinned by npm SHA-512 and original browser artifact SHA-256 in provenance.json. Every source transform must match exactly once. Rebuild using `runtime/node.exe scripts/build-pptx-renderer.mjs --upstream <original browser artifact>` or omit --upstream to fetch and verify the official archive.

## Text

Reuse the upstream resolved font of the first visible run for the paragraph strut. This preserves the font/style cascade for mixed runs, explicit fonts and theme fallbacks, and prevents a host font from inflating line boxes. Empty paragraphs retain upstream handling. A zero bullet margin with only an inherited negative indent retains its hanging gutter; explicitly authored negative indents are unchanged.

For ordinary horizontal normAutofit boxes, text-layout.mjs participates in the renderer async readiness lifecycle. It waits for fonts, then searches font sizes at the fixed authored width, reflowing after every step. The clipping box is not scaled. Explicit fontScale has already been applied by upstream and is retained as the search baseline. noAutofit and spAutoFit retain their distinct upstream semantics; rotated/vertical text uses the existing upstream path. Minimum supported extra shrink is 0.1; remaining overflow is reported. App-side settle never changes text dimensions or scale.

## Tables

Preserve authoredFrame before upstream replaces model size with grid sums. table-layout.mjs uses the authored frame as the coordinate boundary and the authored rows as minimum heights. Office-style default table line-height is 1.2; explicit source line spacing has priority. HTML collapsed borders consume half their widths on either side of a cell: compensate padding and outer offsets so row boundaries match native border-center coordinates without stretching text. Merged cells retain rowspan/colspan behavior. Oversized content is clipped at the authored frame and reported instead of moving neighboring elements. Rotations/groups remain on the positioning wrapper.

The host calls layoutTables only after fonts/media and scheduled text fits settle. No first-mount or font-loading event performs competing table mutations. Unresolved overflow is a warning, not a claimed successful repair.

## Verification

- Unit checks pin all distributed artifacts and independent authored/grid geometry.
- test/fixtures/table-layout.pptx: 10 cases, including row/column merges, unequal rows, groups, rotation and intentionally undersized frames. Undersized frames must warn rather than silently expand.
- test/fixtures/text-layout.pptx: soft breaks, genuine normAutofit, matching noAutofit opt-out, explicit fontScale and mixed fonts. Optional Python generators are developer tools only.
- Actual native comparison: all 12 pages of the supplied course PPTX against its PowerPoint PDF. Validate text clipping, table frames/row boundaries and footnotes at native, reduced and enlarged sizes. Boundary checks alone do not prove visual fidelity.
