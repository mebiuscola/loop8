# Classroom Local

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single user studying comparative literature, working primarily in a desktop browser on a Windows 11 computer. Current interface work prioritizes desktop widths.

## Product Purpose

Organize each week's teaching materials, read original pages with bilingual translations and explanations, reconstruct recorded classes, develop course analysis, and ask questions grounded in the week's sources.

## Positioning

The organizing unit is a weekly course project with shared original materials and separate Lecture or Seminar records. Original pages, translations, classroom speech and AI analysis stay identifiable rather than being presented as interchangeable evidence.

## Operating Context

- The application runs through a local Node.js server and browser UI. The local service must stay running while tasks execute.
- The user first uploads the week's Blackboard information, courseware and references, then adds each class's SmartSub SRT and optional recording after attending.
- Courseware can be PPT/PPTX or PDF; it receives bilingual translation and page explanation. References receive bilingual translation.
- MinerU cloud parsing and AI material processing supply normalized work files. User-provided parsing JSON can also be imported.
- The user generates classroom transcripts, each class's Deep Dive and the whole week's Deep Dive as separate actions.
- Ask can target the course, a courseware file or a reference, including the current page where applicable.

## Capabilities and Constraints

- Preserve original source files and original filenames; different contents with the same name receive a numbered filename rather than silently replacing an original.
- Preserve the link between original page, bilingual paragraphs, interpretation and question scope. Retain slide/page/timestamp coordinates where available.
- Do not fabricate lecturer speech from readings or slides. Preserve classroom order and student discussion; distinguish Lecturer, Student and Unclear speaker when appropriate.
- Keep generation and parsing in the background so the user can continue reading and navigating. User-started ACP tasks automatically advance and approve offered one-action permissions; a stop control remains available. Official account authentication still requires the user when necessary.
- Feature-specific model assignments and editable Skill files control AI behavior. Existing local course data, credentials and provider settings must survive interface changes.
- Preserve the transcript player's controls, timestamp navigation and playback-position recovery.
- Current material storage uses Source, Parsed and Output. Original material is evidence; parsing results are AI work files.

## Brand Commitments

The product is named Classroom. The user chose a unified deep-teal and light-sand visual direction and rejected decorative illustrations. Current reading-area refinement should reduce visual and notification noise; its detailed, not-yet-implemented brief belongs in the surface record rather than the current visual tokens.

## Evidence on Hand

- Existing application: server.mjs, public/, lib/, skills/ and test/.
- Local course sources and outputs: data/classes/; these are private user materials, not distributable sample assets.
- Current implemented design: the new frontend in web/ (tokens in web/src/styles/tokens.css; information architecture in docs/IA-PROPOSAL.md). The old interface's design records (DESIGN.md, .impeccable/) were deleted on 2026-11-23.
- Representative browser captures from v2.25.9 are kept in the workspace's work/v2259-layout/ directory.
- The user's confirmed workflow and constraints are recorded in this conversation. Do not invent testimonials, customers, benchmarks or licensing claims.

## Product Principles

- Source fidelity: keep original evidence, translation, classroom speech and analysis distinct.
- Reading continuity: source comparison and questioning should remain usable while work runs.
- User control: generate transcripts and the two analysis scopes only when requested; preserve completed work when stopping.
- Editable behavior: keep teaching rules in clear Skill files, with application code handling orchestration and storage.
- Visual coherence: use one consistent interface language and prioritize the material over interface decoration.
