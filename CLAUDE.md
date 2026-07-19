# ARX Tools

Self-contained, **offline** browser tools for checking CAD-exported engineering
drawings (spelling, title block / drawing-number rules, formatting, revision
fields), plus companion checkers that run inside Revit (pyRevit) and
Civil 3D / AutoCAD (COM). One rules JSON schema drives all three tools.

## Layout
- `src/` — web Drawing Checker (ES modules): `rulesEngine.js`, `pdfExtractor.js`,
  `spellChecker.js`, `titleBlockLocator.js`, `src/ui/`
- `src/hy8/` — HY-8 CSV Importer (ES modules): `hy8File.js` (line-preserving
  .hy8 parser/patcher), `csvCulverts.js`, `units.js`, `mapper.js`, `differ.js`,
  `flowUpdater.js`, `applyImport.js`, `src/hy8/ui/`
- `index.template.html`, `hy8-importer.template.html` + `build.js` — esbuild
  bundling into single HTML files
- `revit/` — pyRevit extension (Python); `civil3d/` — Civil 3D/AutoCAD checker (Python)
- `tests/` — Node test suite; `revit/tests/`, `civil3d/tests/` — Python suites
- `tests/fixtures/hy8/` — real Table1.csv / Section_1.hy8 fixtures for the HY-8 importer
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
