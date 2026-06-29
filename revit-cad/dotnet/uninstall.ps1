<#
.SYNOPSIS  Remove the ARX Revit add-in for one Revit version.
.EXAMPLE   ./uninstall.ps1 -RevitVersion 2024
#>
param([Parameter(Mandatory = $true)][string]$RevitVersion)

$ErrorActionPreference = "SilentlyContinue"
Remove-Item (Join-Path $env:ProgramData "Autodesk\Revit\Addins\$RevitVersion\ARX.Revit.addin") -Force
Remove-Item (Join-Path $env:APPDATA "ARX\Revit\$RevitVersion") -Recurse -Force
Write-Host "Removed ARX add-in for Revit $RevitVersion." -ForegroundColor Green
