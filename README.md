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
rules) must match a field's *entire* value — not just part of it. Rather than
writing that regex by hand, the rule editor leads with a **"Build the
pattern from an example"** helper:

- Paste one real, complete value into **Example value** — e.g. a drawing
  number like `J2501-JPD-EBH-DG-20103`.
- In **Variable part**, enter just the bit of that value that changes from
  drawing to drawing — e.g. `20103`.
- The **Pattern** field fills in automatically: everything outside the
  variable part is kept as fixed literal text, and the variable part becomes
  "N digits" / "N letters" for each run of digits/uppercase/lowercase letters
  it contains. For the example above this produces a pattern that requires
  the literal text `J2501-JPD-EBH-DG-` followed by exactly 5 digits, and an
  explanation of the match is shown right below the fields.
- If the variable text appears more than once in the example, a warning
  says so (the first occurrence is used); if it isn't found in the example
  at all, or either field is empty, the field explains what to fix — your
  saved Pattern is left untouched until the inputs make sense.

A **"Quick patterns, or write your own"** section underneath stays available
for everything the builder doesn't cover:

- One-click **preset chips** fill in ready-made patterns for common fields:
  drawing numbers like `AB-123` or `AB-1234`, a single revision letter or
  number, ISO dates, initials, or a catch-all "any non-empty value" — plus a
  Find/Valid preset for catching US-style dates that should be ISO format.
- A cheat-sheet explains the regex building blocks (`^`/`$` anchors,
  `[A-Z]`, `\d{n}`, `.*`, etc.) in plain English, and explains the
  difference between Pattern (exact match) and Find/Valid (scan-and-flag,
  used by formatting rules).

A live **"Try it"** tester sits under both the Pattern field and the
Find/Valid fields: type a sample value (or sample line of text) and get
immediate ✓ Matches / ✗ Does not match feedback, including a readable
message if the regex itself is invalid — all before you save the rule.

### How the checker finds title-block, revision, and project fields

For a rule that has a **Pattern**, the checker simply searches the entire
drawing for any text that satisfies that Pattern — no label, title-block
corner, or position is required. If you build a Pattern from the example
`J2501-JPD-EBH-DG-20103` (variable part `20103`), the checker looks for the
text `J2501-JPD-EBH-DG-` followed by exactly five digits *anywhere* on the
page, and the field passes as long as such text exists. The value can be in
its own box, sit right after a label like `DWG NO: J2501-JPD-EBH-DG-20103`,
or be split across adjacent text — all of those match. The digit/letter
counts are still exact: a six-digit number would *not* satisfy a five-digit
Pattern, and the fixed prefix won't match in the middle of a longer word.

Presence-only rules (a **Label** with no Pattern, e.g. `REV`) still pass as
long as the label appears somewhere on the drawing with a value beside it.

When a Pattern rule fails, the checker points the report (and the PDF
comment, below) at the offending text: the value next to a matching label
if there is one, otherwise any text that begins with the Pattern's fixed
prefix.

### Add comments to the PDFs

In the **Rules check** card, **Download PDFs with comments** re-runs the
rule checks and saves a copy of each drawing (`<name>-comments.pdf`) with
every error and warning written onto it:

- a coloured highlight box and a sticky **comment** are placed on the
  offending text (red for errors, orange for warnings) — e.g. a drawing
  number that doesn't match its rule gets a note saying so, attached right
  at the number;
- a field that is missing entirely (no text on the page satisfies its rule)
  is listed as a stacked comment in the page's top-left corner.

The comments are standard PDF text annotations, so they also appear in the
comments/markup panel of Acrobat, Preview, and other PDF readers. Everything
runs locally — the PDFs never leave your machine.
