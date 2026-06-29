# Plan C — Native Revit Add-in (C# / .NET)

**Goal:** a production-grade, installable Revit add-in that mirrors the ARX PDF
suite with a polished ribbon + dockable WPF UI, full model read/**write**, and a
reusable **.NET rule core** that is *also* the engine for a future AutoCAD add-in
— so CAD and Revit are first-class from the same codebase.

**Why native C#:** maximum fidelity and UX. Real transactions/undo, a dockable
panel that lives beside the model, robust handling of formatting/parameters, an
installer, and (optionally) Autodesk App Store distribution. This is the
"do-it-properly" counterpart to the pyRevit plan.

---

## 1. Scope

Same four tools as Plan B (Model & Sheet QA, Batch Find & Replace, Standards &
Naming Check, Finder & Audit), but compiled, with a richer UI and an installer.
The differentiator is the **shared `RuleCore` class library** that decouples all
checking logic from Revit so it can be unit-tested and reused in AutoCAD.

---

## 2. Solution architecture

```
ARX.Bim.sln
├─ RuleCore/                     (.NET Standard 2.0 — host-agnostic, unit-tested)
│   ├─ Model/          AbstractPage, TextItem, Word, Issue, RuleSet (POCOs)
│   ├─ PatternBuilder.cs         PORT of toRuns/runToPattern (example → regex)
│   ├─ Evaluator.cs              field + formatting + project rules
│   ├─ Speller.cs                wraps WeCantSpell.Hunspell (en_US .aff/.dic)
│   └─ RulesIo.cs                load/save arx-rules.json (System.Text.Json)
│
├─ ARX.Revit/                    (Revit add-in — references RuleCore)
│   ├─ App.cs                    IExternalApplication — builds ribbon on startup
│   ├─ Commands/                 IExternalCommand per tool (QaCommand, FindReplaceCommand, …)
│   ├─ RevitExtractor.cs         Revit elements → RuleCore.AbstractPage (the boundary)
│   ├─ RevitWriter.cs            applies edits inside Transaction/TransactionGroup
│   ├─ UI/                       WPF dockable pane + dialogs (MVVM)
│   └─ ARX.Revit.addin           manifest (per-version, see §6)
│
├─ ARX.AutoCAD/   (Phase 2 — references the SAME RuleCore; MText/attribute extractor)
│
└─ RuleCore.Tests/               (xUnit — runs in CI, no Revit required)
```

`RuleCore` targeting **.NET Standard 2.0** is the linchpin: it loads in Revit
≤2024 (net48), Revit 2025+ (net8.0-windows), *and* AutoCAD (net48) without
change. Write the checks once; host them anywhere.

---

## 3. Ribbon + UI (`App.cs`, `UI/`)

- `IExternalApplication.OnStartup` builds a **"ARX" ribbon tab** with a panel of
  `PushButton`s (one per tool), each wired to an `IExternalCommand`.
- Primary surface is an **`IDockablePaneProvider`** WPF pane (MVVM) that stays
  open beside the model: run checks, see a live, grouped, sortable issue list,
  and click a row to **select + zoom the offending element** in the active view
  (`uidoc.Selection.SetElementIds` + `uidoc.ShowElements`). This is the BIM
  analog of the PDF tool's annotations.
- Modeless dialogs for Find & Replace preview and rule editing.

---

## 4. Extractor & writer (the only Revit-coupled code)

**Read** — `RevitExtractor` mirrors Plan B's collector but strongly typed:
```csharp
public IReadOnlyList<AbstractPage> Collect(Document doc) {
    var pages = new List<AbstractPage>();
    foreach (var sheet in new FilteredElementCollector(doc)
                 .OfClass(typeof(ViewSheet)).Cast<ViewSheet>()) {
        var items = new List<TextItem>();
        var tb = new FilteredElementCollector(doc, sheet.Id)
                 .OfCategory(BuiltInCategory.OST_TitleBlocks).FirstElement();
        if (tb != null)
            foreach (Parameter p in tb.Parameters)
                if (p.HasValue && p.StorageType == StorageType.String)
                    items.Add(new TextItem(p.AsString() ?? "", 0, 0, p.Definition.Name));
        foreach (var tn in new FilteredElementCollector(doc, sheet.Id)
                     .OfClass(typeof(TextNote)).Cast<TextNote>()) {
            var bb = tn.get_BoundingBox(null);
            items.Add(new TextItem(tn.Text, bb?.Min.X ?? 0, bb?.Min.Y ?? 0)
                      { SourceId = tn.Id.IntegerValue });
        }
        pages.Add(new AbstractPage(sheet.SheetNumber, sheet.Name, items));
    }
    return pages;
}
```

**Write** — `RevitWriter` applies edits transactionally with single-undo batching:
```csharp
using var tg = new TransactionGroup(doc, "ARX Find & Replace");
tg.Start();
using (var t = new Transaction(doc, "Apply text edits")) {
    t.Start();
    foreach (var hit in approvedHits) {
        var tn = (TextNote)doc.GetElement(new ElementId(hit.SourceId));
        tn.Text = hit.NewText;            // honor formatting-run caveats
    }
    t.Commit();
}
tg.Assimilate();
```
Same coverage roadmap as Plan B (tags, dimensions, schedules, rooms, names),
plus careful handling of `FormattedText` runs and parameter-driven tags.

---

## 5. Checking logic lives in `RuleCore` (Revit-free)

```csharp
var pages   = extractor.Collect(doc);
var rules   = RulesIo.Load("arx-rules.json");
var issues  = Evaluator.EvaluateAll(pages, rules);              // field/format/project
issues.AddRange(Speller.Check(Evaluator.WordsOf(pages), rules.Spelling));
```
`PatternBuilder` is a direct port of the JS `toRuns`/`runToPattern` so an
"example + variable" rule yields byte-for-byte the same regex as the PDF tool.
`Speller` wraps **WeCantSpell.Hunspell** (pure-managed) loaded with the *same*
en_US dictionary already vendored in this repo.

---

## 6. Multi-version build & manifest (the main native cost)

Revit's API DLLs change yearly; ship one binary per supported year.

- **Target frameworks:** `net48` for Revit 2019–2024, `net8.0-windows` for
  Revit 2025+. Use MSBuild conditions to multi-target a single csproj:
  ```xml
  <PropertyGroup>
    <TargetFrameworks>net48;net8.0-windows</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="RevitAPI"><Private>false</Private></Reference>
    <Reference Include="RevitAPIUI"><Private>false</Private></Reference>
  </ItemGroup>
  ```
  Reference `RevitAPI.dll` / `RevitAPIUI.dll` from each
  `C:\Program Files\Autodesk\Revit <year>\`, **CopyLocal = false**.
- **`.addin` manifest** is deployed per version to
  `%ProgramData%\Autodesk\Revit\Addins\<year>\`:
  ```xml
  <RevitAddIns>
    <AddIn Type="Application">
      <Name>ARX Tools</Name>
      <Assembly>ARX.Revit.dll</Assembly>
      <FullClassName>ARX.Revit.App</FullClassName>
      <AddInId>GUID-HERE</AddInId>
      <VendorId>ARX</VendorId>
    </AddIn>
  </RevitAddIns>
  ```
- Keep all version-specific concerns inside `ARX.Revit`; `RuleCore` never changes.

---

## 7. Distribution

- **Installer** (WiX or Inno Setup) that drops the correct DLL + `.addin` for
  every detected Revit version. Optionally publish to the **Autodesk App Store**.
- Self-contained/offline: everything runs locally in Revit; no network calls.

---

## 8. Testing

- **`RuleCore.Tests` (xUnit):** full coverage of pattern building, evaluator, and
  speller — runs in CI with **no Revit installed**. Seed it with the existing
  PDF tool's fixtures so all hosts produce identical issues.
- **Revit integration:** smoke tests via RevitTestFramework / a debug command on
  sample models; manual UX passes per supported version.

---

## 9. Milestones

| Milestone | Deliverable | Size |
|---|---|---|
| M1 | `RuleCore` lib (model, PatternBuilder, Evaluator, Speller) + xUnit green | M |
| M2 | `ARX.Revit` skeleton: ribbon, dockable pane, `RevitExtractor`, Tool 1 QA report | M |
| M3 | Click-to-select/zoom issue navigation; Standards & Naming check | S–M |
| M4 | Batch Find & Replace with preview + TransactionGroup undo + formatting caveats | M–L |
| M5 | Finder & Audit (warnings, rooms, templates, CAD links) | M |
| M6 | Multi-version build matrix + installer; (optional) App Store submission | M |
| M7 (opt) | `ARX.AutoCAD` reuses `RuleCore` → CAD parity from the same engine | M |

**Overall effort: L** (plus AutoCAD parity as M7). Heavier than Plan B, but the
result is a polished, distributable, fully-writable tool with a unit-tested core
that doubles as the CAD engine.

---

## 10. Pros / cons / risks

- ➕ Best UX and fidelity; ➕ real undo/transactions; ➕ unit-testable, reusable
  `RuleCore` that powers Revit *and* CAD; ➕ professional installer / App Store.
- ➖ Steepest ramp (Revit API + WPF/MVVM); ➖ **per-version build matrix** and
  manifest deployment; ➖ Windows-only; ➖ slower iteration than pyRevit.
- **Risk:** API surface drift between Revit years — isolate it in `ARX.Revit`,
  keep `RuleCore` clean. **Risk:** formatted-text / parameter-driven tag edits —
  handle in `RevitWriter`. **Risk:** installer signing/permissions for the App
  Store — budget time in M6.

---

## 11. Relationship to Plan B

Plan B (pyRevit) and Plan C are not mutually exclusive: **prototype the rule set
and extractor coverage in pyRevit (days), then harden into the C# add-in** once
the checks are proven. Both honor the same `arx-rules.json` and produce identical
results, so work carries over rather than being thrown away.
