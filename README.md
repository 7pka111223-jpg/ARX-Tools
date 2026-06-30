# ARX Tools

A small collection of self-contained, offline browser tools for ARX.

## Engineering Drawing Checker

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
