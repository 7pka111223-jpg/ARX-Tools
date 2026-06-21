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
files onto it, edit the rules from the dropdown if needed, and export a
report.
