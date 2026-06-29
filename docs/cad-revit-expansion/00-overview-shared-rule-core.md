# ARX Tools → CAD & Revit Expansion — Overview & Shared Rule Core

This folder contains two independent build plans for extending the ARX review
suite from PDF to **CAD (AutoCAD DWG/DXF)** and **Revit (RVT/RFA)**:

- [`plan-B-pyrevit-extension.md`](plan-B-pyrevit-extension.md) — fast, scripted Revit tooling via pyRevit (Python).
- [`plan-C-revit-csharp-addin.md`](plan-C-revit-csharp-addin.md) — production-grade native Revit add-in (C#/.NET).

Both plans are designed so that **CAD and Revit are weighted equally** through a
single shared backbone described below. Read this file first; each plan then
stands on its own.

---

## 1. The key constraint that shapes everything

The current ARX tool works as a single offline HTML file because **PDF is an
open, browser-parsable format**. That does *not* hold for the new targets:

| Format | Read/write outside its host app? | Implication |
|---|---|---|
| DXF | Yes — open ASCII interchange, parsable anywhere | Offline tooling possible |
| DWG | No reliable open parser (proprietary binary) | Needs AutoCAD, or commercial ODA SDK |
| RVT / RFA | **No supported way at all** — undocumented OLE compound file | **Must run inside Revit, or use Autodesk cloud (APS), or ODA BimRv** |

Conclusion: there is **no offline-browser path for Revit**. The two plans here
therefore run *inside* Revit (pyRevit / C# add-in). CAD parity is achieved not by
forcing CAD into those Revit add-ins, but by sharing a **format-agnostic rule
core** that a companion AutoCAD add-in (and the existing PDF tool) all consume.

---

## 2. The shared rule core (the reason "both equally" is achievable)

The existing PDF codebase already proves the rule logic is **independent of PDF**.
`src/rulesEngine.js`, `src/spellChecker.js`, and `src/titleBlockLocator.js`
operate on an abstract model, not on PDF objects:

```
Rule definitions (data)         Abstract document model            Evaluator (pure)
─────────────────────────       ───────────────────────────       ───────────────────────
fieldRules:    required + regex  Page { number, width, height,     evaluateFieldRules()
formattingRules: find + valid       items:[ {text, x, y} ] }        evaluateFormattingRules()
projectRules:  expected value    Word  { text, page }              evaluateProjectRules()
spelling:      dictionary + custom                                  checkSpelling()
```

**Strategy:** freeze this contract as the *only* integration boundary. Each host
(PDF, Revit, CAD) supplies an **extractor** that produces the abstract model;
the rule definitions and evaluator stay identical everywhere.

```
                      ┌──────────────────────────────┐
   PDF tool (JS) ────►│                              │
   Revit add-in ─────►│  Extractor → Abstract model  │──► Shared Evaluator ──► Issues[]
   CAD add-in ───────►│                              │        + Spell + Rule-from-example
                      └──────────────────────────────┘
```

### Shared "rule-from-example" pattern builder (port of existing JS)
The PDF tool already turns *an example value + the part that varies* into a regex
(`toRuns` → `\d{n}` / `[A-Z]{n}` / `[a-z]{n}`, literal prefix/suffix). This is the
single most reusable asset. Port it once per language runtime:

- **Python** (Plan B): `rulecore.py` — `classify_ch`, `to_runs`, `run_to_pattern`.
- **.NET** (Plan C + future CAD add-in): `RuleCore` class library targeting
  **.NET Standard 2.0** so it loads in both Revit (net48 / net8) and AutoCAD
  (net48) — `RuleCore.PatternBuilder`, `RuleCore.Evaluator`, `RuleCore.Speller`.

### Shared rule files (one source of truth)
Express all rules as **JSON** so a rule set authored once runs in every host:

```jsonc
// arx-rules.json  — consumed by PDF tool, Revit add-in, and CAD add-in alike
{
  "fieldRules": [
    { "id": "dwgno", "label": "Drawing No", "category": "titleblock",
      "severity": "error", "example": "ARX-1234-A", "variable": "1234-A" }
  ],
  "formattingRules": [
    { "id": "rev", "find": "REV\\s*[A-Z]", "valid": "REV [A-Z]",
      "severity": "warn", "message": "Revision should read 'REV X'" }
  ],
  "projectFields": [ { "id": "proj", "label": "Project", "value": "RIYADH-METRO" } ],
  "spelling": { "language": "en_US", "custom": ["ARX", "rebar", "invert"] }
}
```

---

## 3. The four ARX tools, mapped to BIM/CAD

| ARX (PDF) tool | Revit / CAD equivalent | Notes |
|---|---|---|
| Drawing Checker | **Model & Sheet QA** | Title-block / sheet parameters, text spelling, formatting/standards |
| PDF Text Editor | **Batch Text Find & Replace** | TextNotes, tags, sheet name/number, schedules, room names |
| Rule Check | **Standards & Naming Rule Check** | Sheet numbering, view/family/type naming, parameter completeness — via the rule-from-example engine |
| Signature Checker | **Element / Stamp Finder + Model Audit** | Find a specific family/type/title-block stamp; audit `doc.GetWarnings()`, unplaced rooms, unused templates |

---

## 4. CAD coverage (how the two Revit plans still serve CAD equally)

1. **Shared rule core** means the same `arx-rules.json` and evaluator power a
   companion **AutoCAD add-in** (.NET `Database`/`MText`/`BlockReference`
   attribute extraction, or AutoLISP for lightweight batch text edits). This is
   the recommended Phase-2 sibling of whichever Revit plan ships first; because
   the rule core is shared, it is mostly an *extractor* + UI, not a rewrite.
2. **Within Revit**, linked/imported DWG (`ImportInstance`, CAD links) can be
   inventoried and partially checked (layer names, import counts) — useful but
   not a substitute for a native CAD add-in.
3. **DXF offline tool** (the original Plan A) remains the privacy-preserving CAD
   path and reuses the JS evaluator verbatim. It can be added later with no
   conflict because it reads the same JSON rules.

---

## 5. Cross-cutting decisions (apply to both plans)

- **Privacy/offline:** both run locally inside Revit — no upload, matching ARX's ethos. Windows-only (Revit constraint).
- **Spelling:** reuse the en_US Hunspell dictionary already vendored for the PDF tool. Plan B = pure-Python checker; Plan C = `WeCantSpell.Hunspell` (managed, same .aff/.dic).
- **Reporting:** keep ARX's HTML + CSV report formats so output looks consistent across PDF/Revit/CAD. Revit adds an in-app option to *select & isolate* offending elements in the active view (the BIM analog of PDF annotations).
- **Versioning:** Revit's API changes per year. Plan B (pyRevit) absorbs most of this for free; Plan C must multi-target (see that plan).
