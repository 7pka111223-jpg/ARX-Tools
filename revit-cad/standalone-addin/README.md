# ARX Tools — self-contained Revit add-in (no external libraries or apps)

This is the **recommended way to run the tool in Revit without depending on
anything external** — no pyRevit, no NuGet packages, no runtime. The installed
tool is a single dependency-free DLL that Revit loads natively; users drop two or
three files into Revit's add-ins folder and that's it.

> Why this exists: the pyRevit track (`../pyrevit`) needs the pyRevit app
> installed. This track removes every external dependency from the *installed*
> tool — it links against nothing but Revit's own API and the .NET base class
> library.

## What ships

| File | Purpose |
|---|---|
| `ARX.Revit.Standalone.dll` | the whole tool — engine + UI in one DLL, **zero third-party libraries** |
| `ARXTools.addin` | Revit manifest |
| `en_US.txt` | spelling word list (omit it and spelling is simply skipped) |

It compiles the pure-BCL engine from `../dotnet/RuleCore` straight into the DLL
and excludes `RulesIo.cs` (the only file that used a JSON library) — the rule set
is embedded in `ARXStandalone.cs` instead.

---

## Option 1 — compiled add-in (recommended; end users install nothing)

**Only the person building needs the free [.NET SDK](https://dotnet.microsoft.com/download).**
Everyone else just receives the three files.

```powershell
cd revit-cad\standalone-addin

# Revit 2024 and earlier (.NET Framework 4.8):
./build.ps1 -RevitVersion 2024 -Install

# Revit 2025+ (.NET 8):
./build.ps1 -RevitVersion 2025 -Install
```

`-Install` copies the output into `%AppData%\Autodesk\Revit\Addins\<version>\`.
Start Revit → an **ARX** ribbon tab appears with **Model & Sheet QA**. Omit
`-Install` to just get the files in `.\out\` and copy them yourself.

To configure for your project, edit the rules in `EmbeddedRules.Default()` inside
`ARXStandalone.cs` and rebuild.

### Manual install (no script)
1. Build once: `dotnet build ARX.Revit.Standalone.csproj -c Release -f net48 -p:RevitVersion=2024`
2. Copy `ARX.Revit.Standalone.dll`, `ARXTools.addin` and `en_US.txt` into
   `%AppData%\Autodesk\Revit\Addins\2024\`.
3. Start Revit.

---

## Option 2 — Revit Macro (truly zero build, nothing external at all)

If you don't want even a compiler, use Revit's **built-in** Macro Manager — Revit
compiles the code in-process, so this needs **only Revit, any version**.

1. Revit → **Manage** → **Macro Manager** → under *Application* click **Create**
   (choose **C#**). Revit's built-in editor opens.
2. Paste the method + helpers from [`macro/ARXMacro.cs`](macro/ARXMacro.cs) into
   the `ThisApplication` class, add the `using` lines, and **Build**.
3. In Macro Manager select **ARX_QA** → **Run** (allow macros if prompted via
   *Manage → Macro Security*).

The macro is a compact, dependency-free subset (title-block + drawing-number
format checks across every sheet). For spelling, find & replace and audit, use
the compiled add-in above — same engine, fuller feature set.

---

## Compatibility notes

- **Windows only** (Revit). Runs entirely locally; nothing is uploaded.
- The compiled add-in is the only artifact end users touch, and it depends on
  **nothing but Revit** — no pyRevit, no NuGet, no extra runtime.
- Revit 2025+ runs on .NET 8; 2024 and earlier on .NET Framework 4.8. `build.ps1`
  selects the right target automatically.
- Not built in this repo's CI (no .NET SDK / Revit in the authoring environment);
  build locally per the steps above. The engine itself is covered by the xUnit
  tests in `../dotnet/RuleCore.Tests` and the Python tests in `../pyrevit/tests`.
