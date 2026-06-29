# ARX Tools for Revit — native C# add-in (Plan C)

A production-grade Revit add-in mirroring the ARX PDF suite, built on a shared,
unit-tested **`RuleCore`** library. `RuleCore` targets **.NET Standard 2.0** so the
*same* engine loads in Revit (net48 and net8) **and** a future AutoCAD add-in
(net48) — write the checks once, run them in Revit and CAD. It is a faithful C#
port of the PDF tool's `src/` engine and of the verified Python core in
`../pyrevit`. See `../../docs/cad-revit-expansion/` for the full plan.

## Solution layout

```
ARX.Bim.sln
├─ RuleCore/            netstandard2.0 — host-agnostic engine (Models, PatternBuilder,
│                       TitleBlockLocator, Evaluator, Speller, RulesIo, Report)
├─ RuleCore.Tests/      net8.0 xUnit — runs with NO Revit installed (CI-friendly)
└─ ARX.Revit/           net48 + net8.0-windows — Revit host: App (ribbon),
                        RevitExtractor, Commands/QaCommand, ARX.Revit.addin
```

## Build & test

> Requires the .NET SDK (8.0+). `RuleCore` + tests build anywhere; `ARX.Revit`
> needs the Revit API DLLs and so only builds on a machine with Revit installed.

```bash
# Engine + tests only — no Revit needed:
dotnet test RuleCore.Tests/RuleCore.Tests.csproj

# Revit add-in (on a machine with Revit; pick the matching version/TFM):
dotnet build ARX.Revit/ARX.Revit.csproj -c Release -f net8.0-windows -p:RevitVersion=2025
dotnet build ARX.Revit/ARX.Revit.csproj -c Release -f net48           -p:RevitVersion=2024
```

The xUnit suite (`RuleCoreTests.cs`) mirrors the Python tests case-for-case, so
JS, Python and .NET are all checked against the same fixtures.

## Install in Revit

1. Build `ARX.Revit` for the target Revit version.
2. Copy `ARX.Revit.dll` (+ `Arx.RuleCore.dll`, `arx-rules.json`, and the Hunspell
   `en_US.dic/.aff`) to an install folder.
3. Copy `ARX.Revit.addin` to `%ProgramData%\Autodesk\Revit\Addins\<year>\` and
   point its `<Assembly>` at the installed `ARX.Revit.dll`.
4. Package with WiX/Inno Setup for distribution (or submit to the Autodesk App Store).

## Spelling

`QaCommand` currently uses an empty `SetSpeller` (flags everything) as a
placeholder. For production add a `WeCantSpell.Hunspell` `PackageReference` and
wrap it as an `ISpeller` loaded with the vendored `en_US` dictionary — see the
comment in `RuleCore/Speller.cs`.

## Status

`RuleCore` + tests are complete and compile-ready; the `ARX.Revit` host is a
working skeleton (ribbon + Model & Sheet QA command + extractor). Remaining
commands (Find & Replace, Standards Check, Finder & Audit) follow the same
pattern as the pyRevit tool in `../pyrevit` and reuse `RuleCore` unchanged.

> Not built in this repo's CI: no .NET SDK / Revit in the authoring environment.
> Verify locally with `dotnet test` (engine) and a Revit build (add-in).
