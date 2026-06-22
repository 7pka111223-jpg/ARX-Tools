# Engineering Drawing Checker

Checks CAD-exported PDF engineering drawings against an editable rules file
(spelling, title block / project naming, formatting, revision fields).

## Development

    npm install
    npm test          # run the unit test suite
    npm run build      # produce dist/drawing-checker.html

## Usage

Open `dist/drawing-checker.html` in a browser. No internet connection or
installation is required — it is a single self-contained file. Drag PDF
files onto it, add/edit/delete rules in the Rules list if needed, and
export a report.

### Spelling check

The **Spelling check** section runs a dedicated spelling-only pass over the
files you have added, independent of the title-block and formatting rules.
Click **Check spelling** to list every misspelled word with the page(s) it
appears on and suggested corrections, then export the findings as an HTML or
CSV spelling report. The custom dictionary and ignore list from the rules
file apply here too.
