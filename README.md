# Engineering Drawing Checker

Checks CAD-exported PDF engineering drawings against an editable rules file
(spelling, title block / project naming, formatting, revision fields).

## Development

    npm install
    npm test          # run the unit test suite
    npm run build      # produce dist/drawing-checker.html and dist/arx-tools.html

## Usage

Open `dist/drawing-checker.html` in a browser. No internet connection or
installation is required — it is a single self-contained file. Drag PDF
files onto it, add/edit/delete rules in the Rules list if needed, and
export a report.

## PDF Text Editor (find & replace)

`pdf-text-editor.html` is a separate, standalone single-file tool for
**editing** text inside PDF engineering drawings. Open the file directly in
a browser (no build, no install, no network — nothing is uploaded). Drop one
or more PDFs in, type the text to find and what to replace it with, preview
the matches, then download the edited files. The same find/replace is applied
to every loaded file; a single file downloads as a PDF, multiple files
download together as a ZIP (and each can be downloaded individually from the
list).

It edits the PDF's text content streams in place and writes the result as an
incremental update, so the **font, size, position and all other formatting
are preserved** — only the characters change. It works on PDFs with a real
text layer (most CAD exports); it cannot edit text that was exported as
vector outlines, which the built-in "Show all editable text" button helps
you confirm.

## Combined app (both tools in one file)

`npm run build` also produces **`dist/arx-tools.html`** — a single
self-contained file that contains both tools in two tabs:

* **Drawing Checker** — the title-block / spelling / formatting reviewer.
* **PDF Text Editor** — the batch find &amp; replace tool.

Each tool runs in its own isolated frame, so they never interfere. A shared
**"Choose download folder…"** control at the top lets you pick where edited
and exported files are written (using the browser's File System Access API in
Chrome/Edge); when no folder is chosen, files go to the browser's normal
Downloads folder. Open `dist/arx-tools.html` directly in a browser — no
install or internet connection required.
