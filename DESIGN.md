---
name: Classroom Local
description: "A source-led workspace for weekly course materials and bilingual reading."
colors:
  action-teal: "#28665f"
  action-pressed: "#214f4b"
  link-teal: "#285e56"
  rail: "#213b3a"
  selected: "#e1eee7"
  sand: "#eeeee7"
  paper: "#fefdf7"
  control: "#e8ebe1"
  ink: "#222e2b"
  muted: "#52615b"
  line: "#d7d9cf"
  separator: "#c7cfc3"
  reading-paper: "#fcfcfa"
  reading-ink: "#29312d"
  reading-muted: "#5b625e"
  reading-line: "#e1e4de"
  reading-scrollbar: "#c4cac4"
  ready-fill: "#def3e9"
  ready-ink: "#146448"
  danger: "#b4232b"
typography:
  caption:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    lineHeight: 1.6
  folio:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    lineHeight: "28px"
  reading-english:
    fontFamily: "Georgia, Segoe UI, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.9
  reading-body:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    lineHeight: 1.85
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "clamp(1.25rem, 2vw, 1.75rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.025em"
  reading-headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "1.2rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: ".9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: ".8125rem"
    fontWeight: 650
rounded:
  compact: "6px"
  field-inner: "4px"
  control: "8px"
  grouped-control: "9px"
  card: "14px"
  dialog: "16px"
  status: "10px"
spacing:
  toolbar-gap: "6px"
  group-gap: "12px"
  panel-padding: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-teal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.action-pressed}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  ask-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  nav-tab-selected:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  status-ready:
    backgroundColor: "{colors.ready-fill}"
    textColor: "{colors.ready-ink}"
    rounded: "{rounded.status}"
    padding: "2px 8px"
  library-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "24px"
  folio-control:
    backgroundColor: "transparent"
    textColor: "{colors.reading-ink}"
    rounded: "{rounded.grouped-control}"
    padding: "2px"
---

> **⚠ 已过时（2026-11-21 标注）。** 本文件记录的是 v2.25.10 前后的设计，之后界面已多次修改，且前端正准备重做。
> 不要把它当作当前设计依据；新的设计文档确定后会替换本文件。


# Design System: Classroom Local

## Overview

**Creative North Star: "Parallel Score"**

Parallel Score keeps the source page, bilingual reading and question scope in view as parts of the same task. Deep teal identifies the course rail, sand frames the workspace, and warm paper marks the surfaces where people read or write.

Compact controls leave room for the document. Tabular folios and quiet dividers make it easy to track the same page across panes. Course materials supply the imagery.

**Key Characteristics**

- Deep teal course rail with light text
- Warm paper for reading, writing and library surfaces
- Compact system controls and tabular folios

## Colors

### Primary

- **Deep Teal** gives the course rail a distinct edge. The active week uses a lighter teal fill and light text.
- **Action Teal** fills primary buttons and outlines keyboard focus. Pressed Teal deepens the button fill on hover and press.
- **Link Teal** identifies links. Selected Mint marks the active workspace tab.

### Secondary

- **Ready Mint and Ready Green** identify completed material and classroom work. Destructive Red fills confirmation buttons for deletion.

### Neutral

- **Workspace Sand** surrounds the library and reading workspace. **Warm Paper** holds reading text, Ask and library cards.
- **Control Stone** groups folio controls and frames Ask scope. **Quiet Rule** separates rows and panes. **Control Rule** gives form fields and interactive borders definition.
- **Ink** carries primary text. **Muted Ink** carries metadata and hints.

**The Paper Rule.** Use warm paper for reading, composition and grouped materials. Use sand for the workspace around them.

## Typography

The workspace uses the system stack, with Segoe UI Variable and Microsoft YaHei among its fallbacks. Titles and controls use compact sizing. Bilingual text opens to a line height of 1.72. English slide translation keeps the Georgia-based reading style. Chinese translation uses a subdued ink tone, and transcript paragraphs cap at 75ch.

- **Workspace title** uses weight 650 and a fluid size from 1.25rem to 1.75rem.
- **Reading title** uses the same weight at 1.2rem. The Ask title uses 1.125rem.
- **Workspace copy** uses .9375rem with a 1.55 line height. Folio headings use .8125rem at weight 650. Supporting labels and file metadata use .75rem.

**The Folio Rule.** Use tabular numerals and the shared five-column page control. Keep page identity in the toolbar and continuous-page boundaries; pane headings name the columns.

## Layout

A fixed course rail anchors the desktop workspace. The library groups file rows and classroom records in separate paper cards. Reading uses tighter chrome, with a compact title row and a shared material toolbar with a 50px minimum height on desktop. The material selector and folio share the toolbar. Slide reading aligns original pages and their corresponding text in rows, while the reference reader pairs original and translation panes. One-pixel rules mark the boundaries.

Ask reserves its own column in parallel mode from 1101px. At intermediate widths, floating Ask is capped at 45vw and the reading controls can use the space beside it. At 760px and below, reading panes stack, the controls wrap, and Ask can fill nearly the viewport width. The standalone reference page stacks its panes at 850px.

## Elevation & Depth

Paper cards and the docked Ask panel sit flat. Border rules and tonal differences separate adjacent surfaces. Floating Ask and dialogs use a diffuse two-layer shadow. File menus use the floating-panel shadow. Reading More menus use `0 8px 28px #26372f18`. Material-reading tabs are flat, with an underline for selection. Compact display toggles inside More retain their existing selected treatment. When reduced transparency or higher contrast is requested, the translucent chrome uses solid warm paper.

**The Flat Surface Rule.** Keep cards flat at rest. Use soft shadows on floating Ask, dialogs and menus to show that they sit above the workspace.

## Shapes

Controls use gentle corners (8px). Grouped navigation around a folio uses a slightly rounder frame (9px). Library cards (14px) and dialogs (16px) soften larger surfaces. Compact status chips use a 10px radius. Reading panes meet along straight rules so page boundaries stay easy to scan.

## Components

### Buttons and Fields

Primary buttons use a filled teal treatment, while secondary buttons keep a light fill and a visible outline. Destructive confirmations use red. Focus is marked by an offset teal outline. The Ask composer uses a warm-paper textarea with a defined border and can be resized vertically.

### Navigation and Status

Workspace tabs pair outlined icons with short labels. A tinted fill, border and heavier text mark the active tab. Status chips pair a colored fill with a short state label. File rows retain a type badge, filename, metadata and the actions that apply to the file.

### Library Cards and Folios

Library cards use warm paper, a fine border and desktop padding of 24px. The folio groups previous and next controls with a tabular current page and total. Reading pane headings name the columns; the centered folio and continuous-page boundary identify the page. Ask keeps the current scope visible above the conversation and composer.


### Material Reading — Implemented in v2.25.10

Page navigation shares public/folio.css across courseware, references and citation views. Navigation uses a five-column grid: 28px arrow, 40px current-page field, 12px slash, 40px total, 28px arrow; gaps and outer padding are 2px. Numeric text uses 14px type, tabular numerals and 28px line height. Arrow icons are inline SVG.

The centered folio sits between equal-width toolbar regions. File selection is on the left; courseware-guide or reference-translation generation remains in the same toolbar on the right. Both material selectors are 34px high. Preview and display options live in More. Below 900px of available toolbar width, secondary actions move into More; below 680px, material-type tabs move there as well. These thresholds use actual toolbar width, including space reserved for Ask.

Courseware and reference panes share Reading Paper #fcfcfa, Reading Ink #29312d, Reading Muted #5b625e and Reading Line #e1e4de. Original documents retain their native colors. Extra preview padding and gray-green frames are removed. Courseware separators retain an 8px pointer target and a quiet 1px line, with no visible handle; hover and keyboard focus emphasize the line. Body text starts at consistent pane insets. Chinese translation and analysis use 15px type with 1.85 line height.

Routine pending/completion badges, automatic guidance strips and task-ended notices are removed. Nonblocking material notes are available under More → Material details. Real read/generation errors appear inline and can be dismissed; dismissal is stored per material and issue. Read errors offer Reload; failed translation can be retried from the toolbar. Empty translation slots do not repeat a missing-result message for every paragraph. Background task details start collapsed and disappear silently on successful completion.


Reference reading uses one continuous scroll area, with an original page and bilingual text paired in each row. The centered folio and page question scope follow the visible row. Nearby PDF canvases are rendered on demand, capped at three retained pages and two simultaneous render jobs. Translation updates replace text without rebuilding the PDF or resetting scroll. Unlocated source text appears in a separately labeled section.

## Do's and Don'ts

- Do keep the file and folio together in the reading controls.
- Do pair status color with a readable label.
- Do give keyboard focus a 2px teal outline with a 3px offset.
- Don't add decorative illustrations to the workspace.
