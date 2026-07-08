# ARX Drawing Checker for Civil 3D / AutoCAD

The same offline drawing checker as the Revit and web PDF tools, for
**Civil 3D and plain AutoCAD**. It connects to the running Civil 3D
session (COM automation — nothing is installed inside Civil 3D) and
checks every paper-space **layout** (sheet):

- **Drawing number format** — the DWG NO title-block attribute (or the
  layout name when there is none) against the regex rule.
- **Title block fields** — REV, DATE, DRAWN BY, CHECKED BY, APPROVED BY
  attributes must be filled in; attribute tags are matched to the rule
  labels automatically (`DWG NO` ≈ `DWG_NO` ≈ `DWGNO`), with a
  `paramMap` override in the rules file for unusual tag names.
- **Project information** — PROJECT NAME / PROJECT NO / CLIENT
  attributes against expected values.
- **Layout naming** — optional regex for layout (sheet) names.
- **Formatting rules** — find/valid regex pairs over all drawing text.
- **Spelling** — every TEXT and MTEXT entity on the layouts (MText
  inline formatting codes are stripped before checking).

It shares the **same rules.json and custom dictionary** as the web
Drawing Checker and the Revit checker — maintain one standards file for
all three.

The window has the familiar tabs:

- **Results** — issue grid; double-click (or *Zoom to Mistake*) jumps to
  the offending object in Civil 3D; *Add Word to Dictionary*; CSV
  export; **Export Annotated PDF** — plots every layout via
  `DWG To PDF.pc3` with temporary red `>>` markers on the mistakes and
  combines them into one PDF (the drawing itself is left unchanged).
- **Rules** — the rule list + editor (ID, category, label, pattern,
  find/valid, severity, message, enabled) exactly like the web tool,
  plus the example-based **pattern builder** (`AA-001` + variable `001`
  → `^AA\-\d{3}$`) and rules import/export.
- **Project & Dictionary** — project fields, layout name pattern,
  custom dictionary with import/export.
- **Find & Replace** — search all text on the layouts, zoom to a match,
  replace across the drawing (one undo step; MTEXT formatting is
  preserved).

## Install (once)

1. Install **Python 3** from https://www.python.org/downloads/ (keep
   the *py launcher* option ticked). Everything else is bundled.
2. Unzip the tool anywhere (e.g. `C:\ARX-Tools\civil3d`).

## Run

1. Start Civil 3D and open the drawing.
2. Double-click **`ARX Civil3D Checker.bat`** — the first run installs
   the two bundled libraries (pywin32, pypdf) offline, then the checker
   window opens and checks the active drawing.

## Notes

- The tool talks to the **active document** in the running Civil 3D.
  Keep the drawing open while the checker window is up.
- Replace and marker operations are wrapped in an undo mark: one
  Ctrl+Z (U) in Civil 3D reverts a Replace All.
- The rules file resolution matches the other tools:
  `%APPDATA%\ARX-Tools\rules.json` (created on first save) or an
  imported file; the bundled defaults are used until then.

## Development

Pure logic lives in the shared `drawingchecker` library
(`revit/DrawingChecker.extension/lib`); this folder adds only the COM
adapter, actions, and the tkinter window. Tests:

    python3 -m unittest discover -s civil3d/tests -t civil3d

## Native plugin (NETLOAD) — Civil 3D / AutoCAD 2025+

`civil3d/plugin/` contains a C#/.NET 8 version of the checker that loads
directly into Civil 3D with `NETLOAD` (command **ARXCHECK**) — no Python
required. It embeds the shared wordlist and default rules and reads the
same `%APPDATA%\ARX-Tools\rules.json`. Build with the .NET 8 SDK:

    dotnet build civil3d/plugin -c Release
    # -> civil3d/plugin/bin/Release/ArxDrawingChecker.dll

Headless smoke tests for the ported core:

    ARX_DATA_DIR=revit/DrawingChecker.extension/lib/drawingchecker/data \
      dotnet run --project civil3d/plugin-tests -c Release

The plugin targets AutoCAD.NET 25.x (2025/2026). For 2024 and older use
the COM-based checker above.

### Batch (multiple drawings)

The plugin's **Batch Files** tab processes many DWGs at once without
opening them in the editor (each is read as a side database):

- Add individual **files** or a whole **folder** (optionally including
  subfolders).
- **Run Checks on All Files → CSV** writes one combined report with a
  leading `file` column, covering every layout of every drawing (files
  that fail to open are listed with the error).
- **Batch Find & Replace on All Files** applies the pairs from the
  Find & Replace → Multiple (batch) tab to every file. When it runs you
  choose the save mode: **overwrite in place** or **save edited copies
  to a folder**. Files with no matches are left untouched. The currently
  open drawing is skipped (edit it from the Find & Replace tab instead).
