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

### Rules check

The **Rules check** section runs a dedicated pass over just the title-block,
revision, project, and formatting rules — no spelling. Click **Check rules**
to see a PASS/FAIL summary with error/warning counts per file, then export
an HTML or CSV report of the rule violations found. Both checks reuse the
files you last added; no need to re-drop them.

### Writing patterns for drawing number, revision, and other fields

The rule editor's **Pattern** field (used by titleBlock/revision/project
rules) must match a field's *entire* value — not just part of it. To make
this easier to get right:

- An expandable **"Need help writing a pattern?"** cheat-sheet explains the
  regex building blocks (`^`/`$` anchors, `[A-Z]`, `\d{n}`, `.*`, etc.) in
  plain English, and explains the difference between Pattern (exact match)
  and Find/Valid (scan-and-flag, used by formatting rules).
- One-click **preset chips** fill in ready-made patterns for common fields:
  drawing numbers like `AB-123` or `AB-1234`, a single revision letter or
  number, ISO dates, initials, or a catch-all "any non-empty value" — plus a
  Find/Valid preset for catching US-style dates that should be ISO format.
- A live **"Try it"** tester sits under both the Pattern field and the
  Find/Valid fields: type a sample value (or sample line of text) and get
  immediate ✓ Matches / ✗ Does not match feedback, including a readable
  message if the regex itself is invalid — all before you save the rule.
