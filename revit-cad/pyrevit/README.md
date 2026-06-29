# ARX Tools for Revit — pyRevit extension (Plan B)

A Revit QA suite mirroring the ARX PDF tools, built on
[pyRevit](https://github.com/eirannejad/pyRevit). All checking logic lives in the
host-agnostic `arx_rulecore` package (a faithful Python port of the PDF tool's
`src/` engine), so a rule set authored once runs identically in PDF, Revit and a
future AutoCAD add-in. See `../../docs/cad-revit-expansion/` for the full plans.

## Tools (ARX ribbon → Review panel)

| Button | ARX analog | What it does |
|---|---|---|
| **Model & Sheet QA** | Drawing Checker | Title-block/project-field + formatting rules + spelling over every sheet; HTML/CSV export. Read-only. |
| **Find & Replace** | PDF Text Editor | Preview + batch replace text in TextNotes, applied in one undo-able transaction. |
| **Standards Check** | Rule Check | Validates sheet/view names against rule-from-example patterns. Read-only. |
| **Finder & Audit** | Signature Checker | Find every placement of a family type; one-click `GetWarnings()` model audit. |

## Layout

```
ARX.extension/
  ARX.tab/Review.panel/<Tool>.pushbutton/script.py   # thin UI wrappers
  lib/arx_rulecore/                                   # shared engine (pure Python)
    util, pattern_builder, title_block, rules_engine,
    speller, rules_io, report                         # tested, Revit-free
    extract.py                                         # ONLY Revit-coupled module
sample/arx-rules.json                                 # the shared rule set
demo/run_headless.py                                  # end-to-end demo without Revit
tests/test_rulecore.py                                # unit tests (stdlib unittest)
```

## Develop / verify (no Revit needed)

```bash
cd revit-cad/pyrevit
PYTHONPATH=ARX.extension/lib python3 -m unittest discover -s tests   # 16 tests
PYTHONPATH=ARX.extension/lib python3 demo/run_headless.py            # full pipeline + reports
```

`arx_rulecore` is pure Python and imports without Revit; `extract.py` imports the
Revit API lazily so the rest of the package stays testable off-Revit.

## Install in Revit

1. Install pyRevit (Revit 2021–2025+).
2. Add this `ARX.extension` folder via pyRevit Settings → *Custom Extension
   Directories* (point at `revit-cad/pyrevit`), or
   `pyrevit extend ui ARX <git-url>`. Reload pyRevit.
3. Place `sample/arx-rules.json` (edited for your project) next to the button
   `script.py`, or pick it when prompted.

## Spelling dictionary

`Model & Sheet QA` loads `en_US.dic` if present next to its script (drop in the
Hunspell `.dic` already vendored for the PDF tool via `load_dic_speller`);
otherwise everything is flagged so you notice it is missing. Project-specific
codes/acronyms go in `spelling.custom` in `arx-rules.json`. Under IronPython the
bundled pure-Python speller is used; under CPython mode you may swap in
`pyspellchecker`/Hunspell — anything exposing `.correct(word)` works.

## Notes / limits

- Windows-only (Revit). Runs entirely locally — nothing is uploaded.
- Find & Replace edits flattened `TextNote.Text`; rich formatted runs and
  parameter-driven tag text are out of scope (documented in the plan).
