# Installing the ARX Revit/CAD Tools

All run **entirely on your machine** (nothing is uploaded) and are **Windows-only**
(Revit requirement). Pick by how much you want to depend on outside the tool:

| You want… | Use | External dependency |
|---|---|---|
| The installed tool to need **nothing but Revit** | **Track A — self-contained add-in** (`standalone-addin/`) | none (one DLL; build needs the free .NET SDK once) |
| **Zero build, nothing installed at all** | **Track A → Revit Macro** (`standalone-addin/macro/`) | none — Revit's built-in editor compiles it |
| The simplest **no-compile** rollout with full features | **Track B — pyRevit** | the free pyRevit app |
| A branded, multi-feature compiled product | **Track C — full C# solution** | .NET SDK |

**If your priority is "no external libraries or apps," use Track A** — see
[`standalone-addin/README.md`](standalone-addin/README.md). The installed add-in
links against only Revit's API + the .NET base class library; end users drop a
single DLL (+ manifest) into the Revit add-ins folder and nothing else.

---

## Track B — pyRevit extension (recommended, no compiling)

### What you get
A ZIP, `ARX-pyRevit-extension.zip`, containing the whole `ARX.extension` folder
with the rule set and a 121k-word English dictionary already bundled — it works
the moment it loads.

> Build the ZIP yourself any time with:
> `cd revit-cad/pyrevit && python3 tools/build_package.py`
> (output in `dist/`). It is also attached to the chat message that delivered this.

### Prerequisites
1. **Revit 2021 or newer** (Windows).
2. **pyRevit** — free. Download the installer from
   <https://github.com/eirannejad/pyRevit/releases> and run it. Launch Revit once
   so the **pyRevit** ribbon tab appears.

### Install (3 steps)
1. **Unzip** `ARX-pyRevit-extension.zip` to a permanent location, e.g.
   `C:\ARX\ARX.extension` (keep the folder named `ARX.extension`).
2. **Register the folder** with pyRevit, either way:
   - **UI:** Revit → *pyRevit* tab → *Settings* → *Custom Extension Directories* →
     **＋** add the folder that **contains** `ARX.extension` (i.e. `C:\ARX`) →
     *Save Settings and Reload*. **or**
   - **CLI:** `pyrevit extensions paths add "C:\ARX"` then `pyrevit reload`.
3. Revit now shows an **ARX** tab with a **Review** panel and four buttons:
   **Model & Sheet QA**, **Find & Replace**, **Standards Check**, **Finder & Audit**.

### Configure for your project
- Open `ARX.extension\arx-rules.json` and edit the project code, drawing-number
  example/variable, formatting rules, and `spelling.custom` (project acronyms).
  Re-run a tool to pick up changes (no reload needed for rule edits).
- Format of a rule is documented in `pyrevit/README.md`. The friendly
  *example + variable* form (e.g. example `J2501-JPD-EBH-DG-20100`, variable
  `20100`) is compiled to a regex automatically.

### Use
- **Model & Sheet QA** — open a model, click it: checks every sheet's title block,
  formatting and spelling; offers **Export** to HTML + CSV.
- **Find & Replace** — preview matches in TextNotes, then apply in one undo.
- **Standards Check** — validates sheet/view names against your patterns.
- **Finder & Audit** — find a family type across the model, or list model warnings.

### Update / uninstall
- **Update:** replace the `ARX.extension` folder with a newer ZIP, `pyrevit reload`.
- **Uninstall:** remove the folder from pyRevit's extension paths (or delete it),
  then reload.

### Troubleshooting
| Symptom | Fix |
|---|---|
| No **ARX** tab | Confirm pyRevit itself loads; check you added the *parent* of `ARX.extension`; *Reload*. |
| "arx-rules.json not found" prompt | Keep `arx-rules.json` at the `ARX.extension` root (the ZIP already does), or pick it when asked. |
| Everything flagged as misspelled | `lib\arx_rulecore\data\en_US.txt` is missing — re-unzip; don't strip the `data` folder. |
| CPython features wanted | Set the bundle engine to CPython and `pip install pyspellchecker`; any object with `.correct(word)` works. |

---

## Track C — native C# add-in (compiled, branded)

A compiled add-in cannot be shipped prebuilt from this repo because it must link
against **your installed Revit version's** API DLLs. Build it once per Revit
version on a Windows machine.

### Prerequisites
1. **Windows** with the target **Revit** installed (e.g. Revit 2024 and/or 2025).
2. **.NET SDK 8.0+** — <https://dotnet.microsoft.com/download>.

### Verify the engine (optional, no Revit needed)
```powershell
dotnet test revit-cad\dotnet\RuleCore.Tests\RuleCore.Tests.csproj
```

### Build + install (one command per version)
```powershell
cd revit-cad\dotnet
./build-and-install.ps1 -RevitVersion 2024      # uses .NET Framework 4.8
./build-and-install.ps1 -RevitVersion 2025      # uses .NET 8
```
The script builds `ARX.Revit`, copies the DLLs + `arx-rules.json` + `en_US.txt`
to `%APPDATA%\ARX\Revit\<version>\`, and writes the `.addin` manifest to
`%ProgramData%\Autodesk\Revit\Addins\<version>\`. Start Revit → an **ARX** ribbon
tab appears.

> If a build fails to find `RevitAPI.dll`, pass the install path:
> `dotnet build ARX.Revit\ARX.Revit.csproj -f net48 -p:RevitVersion=2024 -p:RevitDir="C:\Program Files\Autodesk\Revit 2024"`

### Uninstall
```powershell
./uninstall.ps1 -RevitVersion 2024
```

### Optional: a one-click installer (.exe)
Wrap the built output with [Inno Setup](https://jrsoftware.org/isinfo.php). Minimal
`installer\ARX.iss`:
```ini
[Setup]
AppName=ARX Tools for Revit
AppVersion=0.1.0
DefaultDirName={userappdata}\ARX\Revit\2024
DisableDirPage=yes
OutputBaseFilename=ARX-Revit-2024-Setup
[Files]
Source: "..\ARX.Revit\bin\Release\net48\*.dll"; DestDir: "{app}"
Source: "..\ARX.Revit\arx-rules.json";          DestDir: "{app}"
Source: "..\..\pyrevit\ARX.extension\lib\arx_rulecore\data\en_US.txt"; DestDir: "{app}"
Source: "ARX.Revit.addin";                       DestDir: "{commonappdata}\Autodesk\Revit\Addins\2024"
```
Then `iscc installer\ARX.iss` produces `ARX-Revit-2024-Setup.exe` to hand out.

### Status
`RuleCore` + xUnit tests + a working **Model & Sheet QA** command are complete;
the other three commands follow the same pattern as the pyRevit tool and reuse
`RuleCore` unchanged. See `dotnet/README.md`.

---

## Which should I use?

| | Track B · pyRevit | Track C · C# add-in |
|---|---|---|
| Install effort | Unzip + register folder | Build per Revit version, then run script |
| Needs compiler | No | Yes (.NET SDK) |
| Spelling out of the box | Yes (bundled) | Yes (bundled) |
| Edit model (Find & Replace) | Yes | Yes (QA command ships; others to wire) |
| Best for | Fast rollout, scripting, all Revit versions at once | Branded, single-binary, App Store / installer |
