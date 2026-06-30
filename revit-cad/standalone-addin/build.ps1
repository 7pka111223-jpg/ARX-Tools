<#
.SYNOPSIS
  Build the self-contained ARX add-in and (optionally) install it.

.DESCRIPTION
  Produces ONE dependency-free DLL (no NuGet packages). Only the person building
  needs the free .NET SDK; end users install nothing but the output files.
  Revit 2025+ uses .NET 8; 2024 and earlier use .NET Framework 4.8.

.EXAMPLE
  ./build.ps1 -RevitVersion 2024            # build only -> .\out\
  ./build.ps1 -RevitVersion 2024 -Install   # build and copy into the Addins folder
#>
param(
  [Parameter(Mandatory = $true)][string]$RevitVersion,
  [switch]$Install,
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$tfm = if ([int]$RevitVersion -ge 2025) { "net8.0-windows" } else { "net48" }

Write-Host "Building self-contained add-in for Revit $RevitVersion ($tfm)..." -ForegroundColor Cyan
dotnet build "$root\ARX.Revit.Standalone.csproj" -c $Configuration -f $tfm -p:RevitVersion=$RevitVersion

$buildOut = Join-Path $root "bin\$Configuration\$tfm"
$out = Join-Path $root "out"
New-Item -ItemType Directory -Force -Path $out | Out-Null

Copy-Item "$buildOut\ARX.Revit.Standalone.dll" $out -Force
Copy-Item "$root\ARXTools.addin" $out -Force
$dict = Join-Path $root "..\pyrevit\ARX.extension\lib\arx_rulecore\data\en_US.txt"
if (Test-Path $dict) { Copy-Item $dict $out -Force }

Write-Host "`nSelf-contained output in: $out" -ForegroundColor Green
Write-Host "  ARX.Revit.Standalone.dll   (the tool — no other libraries)"
Write-Host "  ARXTools.addin             (manifest)"
Write-Host "  en_US.txt                  (spelling word list)"

if ($Install) {
  $addins = Join-Path $env:AppData "Autodesk\Revit\Addins\$RevitVersion"
  New-Item -ItemType Directory -Force -Path $addins | Out-Null
  Copy-Item "$out\*" $addins -Force
  Write-Host "`nInstalled to $addins — start Revit $RevitVersion and look for the ARX tab." -ForegroundColor Green
} else {
  Write-Host "`nTo install: copy those three files into" -ForegroundColor Yellow
  Write-Host "  %AppData%\Autodesk\Revit\Addins\$RevitVersion\"
}
