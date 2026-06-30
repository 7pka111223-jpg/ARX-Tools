# ARX Tools — CAD & Revit expansion

Extends the ARX PDF review suite to **Revit** (and, via the shared engine, CAD).
Two delivery tracks, both driven by one **host-agnostic rule core** and one
shared `arx-rules.json`, so a rule set authored once runs identically in PDF,
Revit and a future AutoCAD add-in.

| Folder | Plan | Stack | Status |
|---|---|---|---|
| [`standalone-addin/`](standalone-addin/) | **A** — self-contained add-in (no external libs/apps) | C# single DLL + optional Revit macro | ✅ Dependency-free build of the engine + QA tool; macro alt; **recommended for "no external dependencies"** |
| [`pyrevit/`](pyrevit/) | **B** — pyRevit extension | Python (IronPython/CPython) | ✅ Core + 4 tools, **16 unit tests green**, headless demo runs |
| [`dotnet/`](dotnet/) | **C** — full native Revit add-in | C# (.NET Standard 2.0 core + Revit host) | ✅ `RuleCore` + xUnit + Revit skeleton (compile-ready; needs .NET SDK / Revit to build) |

**Easiest install with no external libraries or apps:** the
[`standalone-addin/`](standalone-addin/) track — see [`INSTALL.md`](INSTALL.md).

Design rationale, format constraints (why Revit has no offline-browser path) and
the shared-core strategy are in [`../docs/cad-revit-expansion/`](../docs/cad-revit-expansion/).

## Why a shared core

The PDF tool's `src/` engine already operates on an abstract `Page → {text,x,y}`
model, not on PDF internals. Both tracks port that engine faithfully and swap only
the **extractor** (Revit elements → pages). Result: CAD and Revit are weighted
equally — the same checks, the same `arx-rules.json`, three runtimes (JS, Python,
.NET), one set of test fixtures.

## Quick verify (Python track, no Revit/.NET needed)

```bash
cd pyrevit
PYTHONPATH=ARX.extension/lib python3 -m unittest discover -s tests   # 16 tests
PYTHONPATH=ARX.extension/lib python3 demo/run_headless.py            # full pipeline
```
