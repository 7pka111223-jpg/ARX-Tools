# ARX Revit Drawing Checker

A [pyRevit](https://pyrevitlabs.io) extension that checks the sheets and
drawings of the **open Revit model** against the ARX drawing standards —
fully offline, nothing leaves the machine.

For every (non-placeholder) sheet it checks:

- **Drawing number format** — the sheet number against a regex rule
  (default `AA-000`, e.g. `AR-101`).
- **Revision / authorship fields** — Current Revision, Sheet Issue Date,
  Drawn By, Checked By, Approved By must be filled in.
- **Project information** — Project Name / Project Number / Client Name
  must match the expected values in the rules file.
- **Naming conventions** — optional regexes for sheet names, the names of
  views placed on sheets, and schedule titles.
- **Formatting rules** — find/valid regex pairs (e.g. dates must be
  ISO `YYYY-MM-DD`) over all drawing text and sheet parameters.
- **Spelling** — every text note (on sheets and inside placed views),
  sheet name, view name and schedule title is spell-checked against a
  bundled 121k-word English dictionary plus a drafting-abbreviations list
  (DIA, TYP, GALV, …) and your own custom dictionary.

Clicking **Check Model** opens the checker window with three tabs:

- **Results** — the issue grid (severity, category, sheet, found text,
  message). Double-click a row (or *Zoom to Mistake*) to select and zoom
  to the offending element in Revit. *Add Word to Dictionary* whitelists
  the selected spelling issue's word and saves it to the rules file;
  *Export CSV* writes the same columns as the web Drawing Checker.
  *Export Annotated PDF* prints all checked sheets to one combined PDF
  (Revit 2022+ native PDF export) with the mistakes marked in red on the
  drawings — a `>>` marker beside every flagged text note plus a summary
  block per sheet for its other issues. The markers are temporary
  annotations created just for the export and deleted right after; the
  model is left unchanged.
- **Rules** — the same rule management as the web tool: an editable
  grid of all rules (ID, category titleBlock/revision/formatting, label,
  pattern, find/valid regexes, severity error/warn, message, enabled)
  with *New Rule* / *Delete Selected Rule*, plus project name/number/
  client, sheet/view/schedule naming patterns, and the custom
  dictionary. *Save Rules and Re-run* validates everything and writes
  the shared rules.json (never the bundled defaults — user rules go to
  `%APPDATA%\ARX-Tools\rules.json` or the Shift+Click configured path).
  *Import/Export Rules* moves the rules file between machines and the
  web tool; *Import/Export Dictionary* does the same for the plain-text
  word list.
- **Find & Replace** — search every text note on sheets and in placed
  views, preview the matches, and replace across the whole model in one
  undoable transaction (match-case optional; the find text is literal,
  not a regex).

## Install

1. Install [pyRevit](https://github.com/pyrevitlabs/pyRevit/releases)
   (free, open source).
2. Register this folder as an extensions directory:

       pyrevit extensions paths add "<path-to-repo>\revit"
       pyrevit reload

   (or in Revit: pyRevit tab → Settings → Custom Extension Directories →
   add `<path-to-repo>\revit`, then Reload.)
3. An **ARX** tab appears in the Revit ribbon with **Check Model**.

## Usage

Open a project and click **ARX → Check Model**. The report window lists
issues per sheet, errors first; the overall verdict is **FAIL** if any
error-severity issue exists (spelling and naming issues are warnings and
never fail a check).

### Pointing it at your project rules

The checker looks for its configuration in this order:

1. The paths picked via **Shift+Click** on the button (rules file and
   custom dictionary).
2. `%APPDATA%\ARX-Tools\rules.json` and
   `%APPDATA%\ARX-Tools\custom_dictionary.txt`.
3. The bundled defaults
   (`DrawingChecker.extension/lib/drawingchecker/data/default_rules.json`).

The rules file uses the **same JSON schema as the web Drawing Checker**
(`dist/drawing-checker.html`), so you can maintain one rules file for
both tools — export it from the web tool's Rules panel or edit the JSON
directly. Two notes:

- `titleBlockRegion` is PDF-specific and ignored in Revit (parameters are
  read directly from the sheets).
- The optional `revit` block adds Revit-only settings; the web tool
  imports/exports it untouched:

```json
"revit": {
  "sheetNamePattern": "^[A-Z0-9 \\-]+$",
  "viewNamePattern": null,
  "scheduleNamePattern": null,
  "paramMap": { "CHECKED BY": "Checker Initials" },
  "skipViewsNotOnSheets": true
}
```

`paramMap` maps a rule label to the sheet parameter name used by your
title block family, for firms whose title blocks use custom shared
parameters instead of Revit's built-in Drawn By/Checked By/… parameters.

The custom dictionary is a plain text file, one word per line, `#` for
comments — add project names, abbreviations and local terms the spell
checker should accept.

## Development

The extension is split so the Revit API surface stays thin:

- `DrawingChecker.extension/lib/drawingchecker/` — pure-Python core
  (tokenizer, spell checker, rules store/engine, results model, CSV
  exporter). Written in Python 2/3-compatible style because pyRevit runs
  scripts under IronPython 2.7 while the tests run under CPython 3.
- `.../lib/drawingchecker/revit_adapter.py` — the only module that touches
  the Revit API; it builds a plain-dict snapshot of the model that the
  core consumes (its imports are deferred so the package imports
  headlessly).
- `ARX.tab/.../Check Model.pushbutton/script.py` — thin orchestration +
  report printing; `config.py` is the Shift+Click configuration.

Run the unit tests headlessly (no Revit needed) from the repo root:

    npm run test:py        # python3 -m unittest discover -s revit/tests -t revit

`data/words_en.txt` is generated from the same `dictionary-en` package the
web tool bundles, so both tools share vocabulary. To regenerate:

    npm install
    pip install spylls
    python3 revit/tools/build_wordlist.py
