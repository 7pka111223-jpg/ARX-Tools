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

Maps a culvert schedule CSV (SI units) into an HY-8 `.hy8` project file (US
customary units) and downloads an updated copy — fully offline, single file.

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
- **Differences report**: before importing, review every field that would
  change (tolerance ~0.003 m), shown as CSV value and current HY-8 value —
  both in SI, side by side. Click **Export differences as CSV** to download
  the full report (every mapped culvert, every differing field) as
  `<name>_differences.csv`.
- **Design flows**: paste `name, flow (m³/s)` pairs (or load a small CSV) to
  set `DISCHARGERANGE` and regenerate the 11 `DISCHARGEXYDESIGN_Y` points.
  Design = the entered flow, max = design + 5 m³/s, min = 0; values are
  converted to cfs on write.
- **Units**: the whole UI — file labels, the differences panel, and the
  exported CSV — is SI throughout (meters, m³/s). The `.hy8` file itself
  always stores US customary units (feet, cfs) regardless of its `UNITS`
  flag, since that's the format HY-8 expects; the tool converts on import
  (1 m = 1/0.3048 ft, 1 m³/s = 1/0.3048³ cfs) and converts back to SI only
  for display, so you never have to read a foot or cfs value in the browser.

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
