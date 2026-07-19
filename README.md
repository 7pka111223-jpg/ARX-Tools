# ARX Tools

A small collection of self-contained, offline browser tools for ARX.

## Engineering Drawing Checker

Checks CAD-exported PDF engineering drawings against an editable rules file
(spelling, title block / project naming, formatting, revision fields).

## Revit Drawing Checker

A pyRevit extension that runs the same kind of checks directly inside
Revit on the open model: sheet/drawing number format, project info,
revision fields, sheet/view/schedule naming conventions, and spelling of
all drawing text. It shares the rules JSON schema with the web Drawing
Checker, so one rules file drives both tools. See
[`revit/README.md`](revit/README.md) for install and usage.

## Civil 3D / AutoCAD Drawing Checker

The same checker for Civil 3D and AutoCAD drawings: connects to the
running session over COM and checks every layout's title block
attributes, drawing numbers, text spelling, naming and formatting —
with zoom-to-mistake, find & replace, and annotated PDF export. Shares
the rules JSON and dictionary with the other two tools. See
[`civil3d/README.md`](civil3d/README.md); build the distributable with
`civil3d/tools/build_package.sh`.

## HY-8 CSV Importer

Maps a culvert schedule — CSV or Excel `.xlsx` (SI units) — into an HY-8
`.hy8` project file (US customary units) and downloads an updated copy —
fully offline, single file. Both the culvert schedule and the design-flow
list accept CSV or `.xlsx` (first worksheet; legacy `.xls` is not supported).

- **Mapping modes**: match culverts by exact culvert name, or by nearest
  station within a configurable tolerance (default 15 m). Unmatched rows on
  either side are listed for manual review.
- **Station format**: chainages look like `X+YYY` (e.g. `12+727`). A minus
  sign immediately after the `+` (e.g. `0+-887`, `-2+-601`) marks the whole
  chainage negative — this is a quirk of the source CSV export, not a typo.
- **What gets imported**: for every mapped pair, `INVERTDATA` (inlet station
  0, USIL, outlet station = CSV length, DSIL), `BARRELDATA` span/rise
  (Manning's n is left untouched), `NUMBEROFBARRELS` (from CSV `Cells`), the
  `CHANNELGEOMETRY` invert elevation, and every `TWRATINGCURVE` constant
  tailwater elevation are all set from the CSV, converted to US units. The
  label from whichever mode wasn't used for matching is overwritten from the
  CSV too (name mode updates the crossing's station label; station mode
  updates the culvert name).
- **Roadway data**: every imported crossing also gets the standard roadway —
  crest elevation = USIL + cell height + cover, crest length 20 m, top width
  8 m, profile shape "constant roadway elevation", paved surface. The cover
  is taken from the schedule's `Average Cover (m)` column when present,
  falling back to 2 m when the column is absent. Roadway fields that would
  change appear in the differences report like any other field.
- **Differences report**: before importing, review every field that would
  change (tolerance ~0.003 m), shown as CSV value and current HY-8 value —
  both in SI, side by side. Click **Export differences as CSV** to download
  the full report (every mapped culvert, every differing field) as
  `<name>_differences.csv`.
- **Design flows**: paste `name, flow (m³/s)` pairs (or load a small CSV) to
  set `DISCHARGERANGE` and regenerate the 11 `DISCHARGEXYDESIGN_Y` points.
  Design = the entered flow, max = design + 5 m³/s, min = 0; values are
  converted to cfs on write.
- **Culvert summary (analysis)**: after import, a per-culvert summary table
  reports HW/D, normal depth, critical depth, headwater elevation, and
  outlet velocity — all in SI — with a CSV export. Two sources:
  - *Compute (approx. HDS-5)* runs an FHWA HDS-5 analysis in the browser on
    the imported geometry and design flows, following HY-8's method: inlet
    control from the Chart-8 nomograph equations with an energy-based floor
    at low flows, outlet control from a direct-step water-surface profile
    through the barrel (full-flow friction only when the crown is
    submerged), and outlet velocity from the profile's depth at the outlet
    (normal depth on steep barrels). Assumes box culverts, square-edge
    headwall inlet (ke = 0.5), constant tailwater, no roadway overtopping.
    Validated against HY-8's own summary tables (CU-JAS-06, all flows below
    roadway overtopping): headwater elevations within 0.16 m, exact at the
    design flow. Deep submergence follows HY-8's orifice extrapolation.
    Roadway overtopping is not modeled — above the overtopping flow HY-8
    caps the headwater at the roadway while this analysis keeps rising.
  - *Analyze all crossings (full flow table)* runs the same analysis at
    every flow in each crossing's flow list (as HY-8's "Analyze" does),
    producing a per-crossing performance table — headwater elevation, HW/D,
    inlet/outlet control depths, normal/critical/outlet depth, outlet
    velocity — with the design-flow row highlighted, and a CSV export of
    all crossings × all flows.
  - *Extract from loaded file* reads HY-8's own computed rating-curve
    results (headwater elevation, outlet velocity) from a `.hy8` file that
    HY-8 has analyzed and saved, interpolated at the design flow. Normal
    and critical depth aren't stored in the file, so those two columns are
    always computed from geometry. A file that HY-8 hasn't analyzed yet is
    flagged per row rather than showing zeros as results.
- **HY-8 report extraction (DOCX)**: attach an HY-8 "Culvert Analysis
  Report" (.docx) together with the matching `.hy8` file, and the tool pulls
  each culvert's results at its design flow — headwater elevation, HW/D,
  normal depth, inlet control depth, outlet control depth, and outlet
  velocity — from the per-culvert "Culvert Summary Table" in the report.
  Culverts are matched by name and the design flow is read from the `.hy8`
  file's `DISCHARGERANGE`; the results table renders in SI (reports printed
  in either unit system are detected and converted) and exports as an Excel
  workbook `<name>_report_results.xlsx` with two sheets: **Hydraulic Results**
  (design flow, headwater elevation, HW/D, normal / inlet control / outlet
  control depths, outlet velocity) and **Geometric Data** (number of barrels,
  cell width and height, cover — from the loaded schedule's `Average Cover (m)`
  when present, else the file's roadway geometry — slope, upstream and
  downstream invert elevations, culvert length, skew). Cells that cross the
  review thresholds
  are highlighted red with real Excel conditional formatting — HW/D and outlet
  velocity on the hydraulic sheet, cover on the geometric sheet — using the
  thresholds set on the Checks tab. (Skew is not stored in the `.hy8` project
  format, so it is reported as 0°.) Missing tables, missing columns, or a
  design flow absent from the report's flow rows are flagged per row. HW/D is
  not taken from the report's printed column (HY-8's SI reports divide a depth
  in meters by the rise in feet there): it is computed as the governing
  headwater depth — max(inlet control depth, outlet control depth) — ÷
  rise, with the rise taken from the loaded culvert schedule (matched by
  culvert name) or from the `.hy8` file's `BARRELDATA` when no schedule is
  loaded.
- **Result checks**: the "Checks" tab flags culverts whose results cross
  review thresholds — **cover** (minimum, default 1 m), **HW/D** (maximum,
  default 1), and **outlet velocity** (maximum, default 4.5 m/s), all
  editable. HW/D and outlet velocity come from the loaded HY-8 report when one
  is present, otherwise from the in-browser HDS-5 analysis (selectable); cover
  is taken from the loaded culvert schedule's `Average Cover (m)` column
  (matched by culvert name), falling back to the file's own roadway/invert data
  (crest − USIL − cell height) for culverts not in the schedule. Failing values
  are shown red in the table and exported to `<name>_checks.xlsx` with the same
  conditional formatting. Editing a threshold re-runs the checks live.
- **Create a new HY-8 file**: the "Create new HY-8" tab builds a complete
  `.hy8` project from scratch out of a culvert list — no starting HY-8 file
  needed. Click **Download Excel template (.xlsx)** to get a template with
  one row per culvert (SI units): name, design flow, cells, cell width and
  height, length, the inverts, and an optional `Average Cover (m)`. Give
  USIL & DSIL directly, or leave both blank and give a **Slope (m/m)**
  instead — the downstream invert is then written as 0 and the upstream
  invert as slope × length. Cover defaults to 2 m when its column is blank.
  Fill it in
  (CSV works too), load it back, review the parsed preview (including each
  crossing's derived roadway crest), name the file, and download. Every
  crossing is created as a concrete box culvert (square-edge headwall inlet,
  n = 0.015) with a constant tailwater at the outlet invert, an 11-point
  flow table (min 0, max = design + 5 m³/s, as on import), and the same
  standard roadway as above. Rows with problems (missing inverts and slope,
  only one invert, non-positive sizes, duplicate names) are listed and
  skipped rather than silently written. The created file opens in HY-8 and
  also loads straight back into the import tab for analysis.
- **Units**: the whole UI — file labels, the differences panel, the culvert
  summary, and the exported CSVs — is SI throughout (meters, m³/s). The
  `.hy8` file itself always stores US customary units (feet, cfs) regardless
  of its `UNITS` flag, since that's the format HY-8 expects; the tool
  converts on import (1 m = 1/0.3048 ft, 1 m³/s = 1/0.3048³ cfs) and
  converts back to SI only for display, so you never have to read a foot or
  cfs value in the browser.

No data leaves the browser — the CSV and `.hy8` file are read and written
entirely client-side, and the tool works from a double-clicked `file://`
copy of `dist/hy8-importer.html`.

### Try it

1. `npm run build` (or use an already-built `dist/hy8-importer.html`) and
   double-click the file to open it in a browser.
2. Load a known-good pair for a first test run:
   `tests/fixtures/hy8/Table1.csv` and `tests/fixtures/hy8/Section_1.hy8`.
   With the default "match by culvert name" mode this maps 83 of 83 CSV
   rows, leaving one HY-8 crossing (`CU-JSS-38`) unmatched — that's expected,
   it has no CSV row.
3. Open the **Differences** panel and check a few rows look sane before
   importing — every value is SI. Click **Export differences as CSV** if
   you want the full report to review outside the browser.
4. Optionally paste a design flow, e.g. `CU-JSS-01, 10`.
5. Click **Import & download** and confirm `Section_1_updated.hy8`
   downloads. Only the mapped crossings' lines should have changed —
   diff it against the original if you want to confirm.
6. For the real acceptance test, open the downloaded file in HY-8 itself
   and spot-check a culvert's USIL/DSIL/span/rise/length/barrels/tailwater/
   design flow, then save.

## Development

    npm install
    npm test          # run the JS unit test suite
    npm run test:py    # run the Revit checker's Python unit tests (no Revit needed)
    npm run build      # produce dist/drawing-checker.html and dist/hy8-importer.html

## Usage

Open `dist/drawing-checker.html` in a browser. No internet connection or
installation is required — it is a single self-contained file. Drag PDF
files onto it, add/edit/delete rules in the Rules list if needed, and
export a report.

Open `dist/hy8-importer.html` the same way to use the HY-8 CSV Importer
described above.

## ARX Salary Calculator

Computes an employee's net monthly salary in EGP. Open
`salary-calculator.html` directly in a browser — it is a single
self-contained file with no build step or dependencies.

Enter the base salary (EGP) plus the weekday/weekend overtime, excuse, and
deduction hours; the breakdown and net total update live. The pay rules are:

- Hourly rate = `base salary ÷ (30 days × 8 hours)`
- Weekday overtime is paid at ×1.35 of the hourly rate
- Weekend overtime is paid at ×2 of the hourly rate
- Excuses and deductions are charged at ×1 of the hourly rate

Net salary = base + weekday overtime + weekend overtime − excuses − deductions.

It is also installable on iPhone/iPad: open the file in Safari, tap **Share →
Add to Home Screen**, and it launches full-screen as a web app with its own
icon. (Safari's *Add to Home Screen* requires the page to be served over a URL,
e.g. GitHub Pages, rather than opened from a local file.)
