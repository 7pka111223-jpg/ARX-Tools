# Plan B — pyRevit Extension (Revit QA suite in Python)

**Goal:** the fastest path to a *real* Revit read+edit tool that mirrors the ARX
PDF suite — Model & Sheet QA, batch text find/replace, naming/standards rule
check, and an element/stamp finder + model audit — delivered as push-button
tools inside Revit.

**Why pyRevit:** it removes almost all of the friction of the raw Revit API —
no compiling, no per-version DLL juggling, a ready-made ribbon/UI system, a rich
HTML output console, and one-line distribution. It is the standard platform for
exactly this kind of QA/QC scripting.

---

## 1. Scope (MVP → full)

| # | Tool (button) | ARX analog | Reads | Writes |
|---|---|---|---|---|
| 1 | **Model & Sheet QA** | Drawing Checker | TextNotes, sheets, title blocks, params | — (report only) |
| 2 | **Find & Replace Text** | PDF Text Editor | TextNotes, tags, sheet fields, schedules | ✅ (in a transaction) |
| 3 | **Naming / Standards Check** | Rule Check | Sheet numbers, view/family/type names, params | — |
| 4 | **Finder & Audit** | Signature Checker | Families/types/stamps, `doc.GetWarnings()` | — |

MVP = tools 1 + 3 (read-only checkers, reuse the rule core). Then 2 (editing),
then 4 (audit).

---

## 2. Prerequisites & stack

- **pyRevit** (current release) installed on top of **Revit 2021–2025+**.
- Language: **IronPython 2.7** (default) — or set the bundle engine to
  **CPython 3** if you want `pyspellchecker`/modern libs. The rule core is
  written to run under both.
- Reuse from this repo: the **en_US Hunspell dictionary** (`dictionary-en`) and
  the **rule-from-example** logic (ported to `rulecore.py`).

> IronPython note: it cannot load C-extension wheels. The bundled speller is
> therefore pure-Python (dictionary set + edit-distance suggestions, a Norvig-
> style corrector seeded from the same word list). Under CPython mode you may
> swap in `pyspellchecker` instead.

---

## 3. Extension layout (pyRevit bundle convention)

```
ARX.extension/
└─ ARX.tab/
   ├─ Review.panel/
   │  ├─ Model & Sheet QA.pushbutton/   { script.py, icon.png, bundle.yaml }
   │  ├─ Find & Replace.pushbutton/     { script.py, icon.png }
   │  ├─ Standards Check.pushbutton/    { script.py, icon.png }
   │  └─ Finder & Audit.pushbutton/     { script.py, icon.png }
   └─ lib/                              # importable from every script
      ├─ rulecore.py                    # PORT: classify/to_runs/run_to_pattern + evaluator
      ├─ extract.py                     # Revit → abstract model (the integration boundary)
      ├─ speller.py                     # pure-Python Hunspell-ish checker + suggestions
      ├─ report.py                      # HTML (pyRevit output) + CSV writers
      └─ rules_io.py                    # load/save arx-rules.json
```

`lib/` is on pyRevit's import path automatically, so every button shares one
copy of the rule core — the same contract the PDF tool uses.

---

## 4. The extractor — Revit → abstract model (`extract.py`)

This is the *only* Revit-specific code. It converts model elements into the
`Page { items:[{text,x,y}] }` / `Word {text,page}` shapes the shared evaluator
already understands. Each sheet becomes a "page".

```python
from pyrevit import revit, DB

def collect_pages(doc):
    pages = []
    for sheet in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet):
        items = []
        # title-block instance parameters on this sheet
        tb = (DB.FilteredElementCollector(doc, sheet.Id)
                .OfCategory(DB.BuiltInCategory.OST_TitleBlocks)
                .FirstElement())
        if tb:
            for p in tb.Parameters:
                if p.HasValue and p.StorageType == DB.StorageType.String:
                    items.append({"text": p.AsString() or "", "x": 0, "y": 0,
                                  "label": p.Definition.Name})
        # text notes placed on the sheet's views
        for tn in (DB.FilteredElementCollector(doc, sheet.Id)
                     .OfClass(DB.TextNote)):
            box = tn.get_BoundingBox(None)
            x = box.Min.X if box else 0
            y = box.Min.Y if box else 0
            items.append({"text": tn.Text, "x": x, "y": y})
        pages.append({"number": sheet.SheetNumber, "name": sheet.Name,
                      "items": items})
    return pages
```

Coverage to expand over time: `DB.TextElement`, dimension overrides
(`Dimension.ValueOverride`), tags (`IndependentTag.TagText`), schedule cells,
room/space names, revision rows, view names, level/grid names.

---

## 5. Tool behaviours

### Tool 1 — Model & Sheet QA  (read-only)
```python
pages   = extract.collect_pages(revit.doc)
ruleset = rules_io.load("arx-rules.json")
issues  = rulecore.evaluate(pages, ruleset)            # field + formatting + project
issues += speller.check(rulecore.words_of(pages), ruleset["spelling"])
report.render_html(issues)                              # pyRevit output console
report.write_csv(issues, ask_save_path())
```
Output uses pyRevit's `output` window: a sortable HTML table with **clickable
element ids** (`output.linkify(id)`) so a reviewer jumps straight to the element.

### Tool 2 — Find & Replace Text  (writes)
- Preview first (same find/whole-word/case options as ARX), list every hit with
  its sheet + element link, then apply inside one transaction so it's a single
  undo:
```python
with revit.Transaction("ARX find & replace"):
    for tn in target_textnotes:
        new = apply_replace(tn.Text, find, repl, opts)
        if new != tn.Text:
            tn.Text = new
```
- Caveats to handle: `TextNote.Text` returns the flattened string but rich
  formatting runs (bold/underline segments) can split a word; replace on the
  flattened value and write back, and skip read-only/▢view-specific cases. Tags
  driven by parameters must be edited at the parameter, not the tag.

### Tool 3 — Naming / Standards Check  (read-only)
Drives the rule-from-example engine over *names*, not just sheet text: sheet
numbers, view names, family & type names, worksets, parameter completeness
(flag any required parameter that is empty). Pure `rulecore` — no new logic.

### Tool 4 — Finder & Audit  (read-only)
- **Finder:** locate a chosen family/type/title-block "stamp" across the model
  (the BIM analog of the signature finder) and list every placement.
- **Audit:** surface `doc.GetWarnings()`, unplaced/redundant rooms, unused view
  templates, imported-CAD inventory — a one-click model-health snapshot.

---

## 6. Distribution

- Publish the `ARX.extension` folder as a **git repo**; users add it via the
  pyRevit *Extensions* manager (URL) or `pyrevit extend ui ARX <git-url>`.
- Updates = `git pull` (pyRevit does this from its UI). No installer, no admin
  rights, works across all installed Revit versions at once.

---

## 7. Testing

- **Rule core** (`rulecore.py`, `speller.py`): plain pytest — no Revit needed.
  Reuse the existing PDF test cases as fixtures to guarantee identical results
  across hosts.
- **Extractor / tools**: manual against sample `.rvt` models, plus a tiny
  smoke-test journal. (Headless Revit testing is possible via RevitTestFramework
  but is overkill for Plan B.)

---

## 8. Milestones

| Milestone | Deliverable | Size |
|---|---|---|
| M1 | `lib/` rule core + speller ported; pytest green | S |
| M2 | `extract.py` (sheets/title blocks/TextNotes) + Tool 1 read-only QA with HTML/CSV report | S–M |
| M3 | Tool 3 standards/naming check (reuses core) | S |
| M4 | Tool 2 find & replace with preview + single-undo transaction | M |
| M5 | Tool 4 finder + warnings/model audit | M |
| M6 | Package as git extension, docs, sample rule set | S |

**Overall effort: S–M.** Realistic MVP (M1–M3) in a small number of focused days
for someone comfortable with Python + the Revit API.

---

## 9. Pros / cons / risks

- ➕ Fastest to a working Revit tool; ➕ no compiling/version DLLs; ➕ trivial
  distribution & updates; ➕ huge community + examples; ➕ shares rule core with
  PDF tool and a future CAD add-in.
- ➖ Requires Revit + pyRevit installed (not a single file); ➖ Windows-only;
  ➖ IronPython limits some libraries (mitigated by pure-Python speller / CPython
  mode); ➖ less polished than a compiled WPF UI.
- **Risk:** rich-text/formatted TextNotes and parameter-driven tags need careful
  edit handling — covered explicitly in Tool 2. **Risk:** very large models —
  scope collectors per active sheet/view and show progress.
