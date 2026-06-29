<#
.SYNOPSIS
  Build the ARX Revit add-in and install it for one Revit version.

.DESCRIPTION
  Requires: .NET SDK 8+ and the target Revit installed (for its API DLLs).
  Builds RuleCore + ARX.Revit, copies the binaries + rule set + dictionary to a
  per-version install folder, and writes the .addin manifest into the Revit
  Addins directory so the ARX ribbon appears on next launch.

.EXAMPLE
  ./build-and-install.ps1 -RevitVersion 2024
  ./build-and-install.ps1 -RevitVersion 2025
#>
param(
  [Parameter(Mandatory = $true)][string]$RevitVersion,
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Revit 2025+ moved to .NET 8; 2024 and earlier use .NET Framework 4.8.
$tfm = if ([int]$RevitVersion -ge 2025) { "net8.0-windows" } else { "net48" }

Write-Host "Building ARX.Revit for Revit $RevitVersion ($tfm)..." -ForegroundColor Cyan
dotnet build "$root\ARX.Revit\ARX.Revit.csproj" -c $Configuration -f $tfm `
  -p:RevitVersion=$RevitVersion

$buildOut = Join-Path $root "ARX.Revit\bin\$Configuration\$tfm"
$installDir = Join-Path $env:APPDATA "ARX\Revit\$RevitVersion"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Write-Host "Installing to $installDir" -ForegroundColor Cyan
# Binaries + their dependencies (e.g. Arx.RuleCore.dll, System.Text.Json.dll)
Copy-Item "$buildOut\*.dll" $installDir -Force
Copy-Item "$root\ARX.Revit\arx-rules.json" $installDir -Force

# Bundle the affix-expanded dictionary so spelling works out of the box.
$dict = Join-Path $root "..\pyrevit\ARX.extension\lib\arx_rulecore\data\en_US.txt"
if (Test-Path $dict) { Copy-Item $dict $installDir -Force }

# Write the .addin pointing at the installed DLL.
$addinsDir = Join-Path $env:ProgramData "Autodesk\Revit\Addins\$RevitVersion"
New-Item -ItemType Directory -Force -Path $addinsDir | Out-Null
$dllPath = Join-Path $installDir "ARX.Revit.dll"
(Get-Content "$root\ARX.Revit\ARX.Revit.addin") `
  -replace "<Assembly>.*</Assembly>", "<Assembly>$dllPath</Assembly>" |
  Set-Content (Join-Path $addinsDir "ARX.Revit.addin")

Write-Host "Done. Start Revit $RevitVersion - look for the ARX ribbon tab." -ForegroundColor Green
