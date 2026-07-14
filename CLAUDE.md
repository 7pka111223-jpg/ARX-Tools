# ARX Tools

Self-contained, **offline** browser tools for checking CAD-exported engineering
drawings (spelling, title block / drawing-number rules, formatting, revision
fields), plus companion checkers that run inside Revit (pyRevit) and
Civil 3D / AutoCAD (COM). One rules JSON schema drives all three tools.

## Layout
- `src/` — web Drawing Checker (ES modules): `rulesEngine.js`, `pdfExtractor.js`,
  `spellChecker.js`, `titleBlockLocator.js`, `src/ui/`
- `index.template.html` + `build.js` — esbuild bundling into a single HTML file
- `revit/` — pyRevit extension (Python); `civil3d/` — Civil 3D/AutoCAD checker (Python)
- `tests/` — Node test suite; `revit/tests/`, `civil3d/tests/` — Python suites
- `tools/license_admin.py` — offline licensing-gate admin
- `salary-calculator.html` — standalone unrelated tool, leave as is

## Commands
- `npm run build` — produces `dist/` single-file HTML apps (dist is gitignored)
- `npm test` — Node unit tests (`node --test`)
- `npm run test:py` — Revit + Civil 3D Python suites (unittest)

## Rules
- Everything must stay offline and self-contained: no CDN links, no network
  calls at runtime. Vendor or embed any new dependency.
- Keep the shared rules JSON schema backward compatible across web/Revit/Civil 3D
  (`tests/revitRulesCompat.test.js` guards this).
- Run `npm test` before committing; run `npm run test:py` when touching
  `revit/` or `civil3d/`.
- Commit sources only; never commit `dist/` build artifacts.
