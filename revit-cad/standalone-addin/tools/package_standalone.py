"""Assemble a fully self-contained, locally-buildable package of the standalone
add-in and zip it. Unlike the in-repo csproj (which references ../dotnet/RuleCore
and ../pyrevit for the dictionary), the packaged copy contains everything inside
one folder, so it travels and builds on its own.

    python3 tools/package_standalone.py   ->  dist/ARX-Revit-Standalone.zip
"""

import os
import shutil
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # standalone-addin/
REPO = os.path.dirname(os.path.dirname(HERE))                         # repo root
CORE = os.path.join(REPO, "revit-cad", "dotnet", "RuleCore")
DICT = os.path.join(REPO, "revit-cad", "pyrevit", "ARX.extension",
                    "lib", "arx_rulecore", "data", "en_US.txt")
DIST = os.path.join(HERE, "dist")
STAGE = os.path.join(DIST, "ARX-Revit-Standalone")

# Pure-BCL engine files (RulesIo.cs is intentionally excluded — uses System.Text.Json).
ENGINE = ["Models.cs", "PatternBuilder.cs", "TitleBlockLocator.cs",
          "Evaluator.cs", "Speller.cs", "Report.cs"]

CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">

  <!-- Self-contained, dependency-free Revit add-in: ONE DLL, no NuGet packages.
       SDK default globbing compiles every .cs under this folder (engine in src/
       + the host). Build (only the builder needs the free .NET SDK):
         dotnet build -c Release -f net48           -p:RevitVersion=2024
         dotnet build -c Release -f net8.0-windows  -p:RevitVersion=2025 -->
  <PropertyGroup>
    <TargetFrameworks>net48;net8.0-windows</TargetFrameworks>
    <RootNamespace>Arx.Revit.Standalone</RootNamespace>
    <AssemblyName>ARX.Revit.Standalone</AssemblyName>
    <LangVersion>latest</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <RevitVersion Condition="'$(RevitVersion)' == ''">2024</RevitVersion>
    <RevitDir>C:\\Program Files\\Autodesk\\Revit $(RevitVersion)</RevitDir>
  </PropertyGroup>

  <ItemGroup>
    <Reference Include="RevitAPI">
      <HintPath>$(RevitDir)\\RevitAPI.dll</HintPath>
      <Private>false</Private>
    </Reference>
    <Reference Include="RevitAPIUI">
      <HintPath>$(RevitDir)\\RevitAPIUI.dll</HintPath>
      <Private>false</Private>
    </Reference>
  </ItemGroup>

</Project>
"""

BUILD_PS1 = r"""<#  Build (and optionally install) the self-contained ARX add-in.
    Only the person building needs the free .NET SDK: https://dotnet.microsoft.com/download
    Examples:
      ./build.ps1 -RevitVersion 2024 -Install
      ./build.ps1 -RevitVersion 2025
#>
param(
  [Parameter(Mandatory = $true)][string]$RevitVersion,
  [switch]$Install,
  [string]$Configuration = "Release"
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$tfm = if ([int]$RevitVersion -ge 2025) { "net8.0-windows" } else { "net48" }

Write-Host "Building for Revit $RevitVersion ($tfm)..." -ForegroundColor Cyan
dotnet build "$root\ARX.Revit.Standalone.csproj" -c $Configuration -f $tfm -p:RevitVersion=$RevitVersion

$out = Join-Path $root "out"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item "$root\bin\$Configuration\$tfm\ARX.Revit.Standalone.dll" $out -Force
Copy-Item "$root\ARXTools.addin" $out -Force
Copy-Item "$root\en_US.txt" $out -Force
Write-Host "Self-contained output in $out (DLL + .addin + en_US.txt)." -ForegroundColor Green

if ($Install) {
  $addins = Join-Path $env:AppData "Autodesk\Revit\Addins\$RevitVersion"
  New-Item -ItemType Directory -Force -Path $addins | Out-Null
  Copy-Item "$out\*" $addins -Force
  Write-Host "Installed to $addins - start Revit and look for the ARX tab." -ForegroundColor Green
} else {
  Write-Host "To install, copy those three files into %AppData%\Autodesk\Revit\Addins\$RevitVersion\" -ForegroundColor Yellow
}
"""

STEPS = """ARX Tools - self-contained Revit add-in (no external libraries or apps)
=====================================================================

This folder is fully self-contained. Two ways to test locally:

A) INSTANT TEST, NO BUILD  (needs only Revit, any version 2021+)
   1. Open Revit -> Manage tab -> Macro Manager.
   2. Under "Application" click Create, choose C#, name it ARX.
   3. Paste the method + helpers from macro/ARXMacro.cs into the
      ThisApplication class, add the `using` lines at the top, Build,
      then run ARX_QA from Macro Manager. (Allow macros if prompted.)

B) FULL ADD-IN  (builder needs the free .NET SDK once; end users need nothing)
   1. Install .NET SDK 8+:  https://dotnet.microsoft.com/download
   2. In PowerShell here:
        ./build.ps1 -RevitVersion 2024 -Install      (or 2025 for .NET 8)
   3. Start Revit -> an "ARX" ribbon tab appears -> click Model & Sheet QA.
      (Without -Install, copy out\\*.* into
       %AppData%\\Autodesk\\Revit\\Addins\\<version>\\ yourself.)

Configure for your project: edit EmbeddedRules.Default() in
src/ARXStandalone.cs, then rebuild.

The installed DLL depends on NOTHING but Revit's API + the .NET base class
library - no pyRevit, no NuGet, no runtime.

Verify the engine logic without Revit (optional): the same rules engine has
passing tests in the repo (revit-cad/pyrevit/tests, revit-cad/dotnet/RuleCore.Tests).
"""


def main():
    if os.path.exists(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(os.path.join(STAGE, "src"))
    os.makedirs(os.path.join(STAGE, "macro"))

    for f in ENGINE:
        shutil.copyfile(os.path.join(CORE, f), os.path.join(STAGE, "src", f))
    shutil.copyfile(os.path.join(HERE, "ARXStandalone.cs"), os.path.join(STAGE, "src", "ARXStandalone.cs"))
    shutil.copyfile(os.path.join(HERE, "ARXTools.addin"), os.path.join(STAGE, "ARXTools.addin"))
    shutil.copyfile(os.path.join(HERE, "macro", "ARXMacro.cs"), os.path.join(STAGE, "macro", "ARXMacro.cs"))
    shutil.copyfile(DICT, os.path.join(STAGE, "en_US.txt"))

    with open(os.path.join(STAGE, "ARX.Revit.Standalone.csproj"), "w") as fh:
        fh.write(CSPROJ)
    with open(os.path.join(STAGE, "build.ps1"), "w") as fh:
        fh.write(BUILD_PS1)
    with open(os.path.join(STAGE, "READ-ME-FIRST.txt"), "w") as fh:
        fh.write(STEPS)

    zip_path = os.path.join(DIST, "ARX-Revit-Standalone.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    n = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, _dirs, files in os.walk(STAGE):
            for f in files:
                full = os.path.join(base, f)
                zf.write(full, os.path.join("ARX-Revit-Standalone", os.path.relpath(full, STAGE)))
                n += 1
    print("packaged %d files -> %s (%.2f MB)"
          % (n, os.path.relpath(zip_path, HERE), os.path.getsize(zip_path) / 1048576.0))


if __name__ == "__main__":
    main()
