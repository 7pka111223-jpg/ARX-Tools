---
name: revit-rules-schema
description: >
  Compatibility contract for the ARX rules JSON schema shared by the web
  Drawing Checker, the Revit (pyRevit) checker, and the Civil 3D/AutoCAD
  checker. Use whenever a change touches src/rulesStore.js,
  src/rulesEngine.js, revit/, civil3d/, DEFAULT_RULES, or a rules file's
  shape — adding rule fields, categories, severities, or new checks driven
  by the rules JSON.
---

# ARX Rules Schema — Compatibility Contract

One rules JSON file drives three independent tools: the web Drawing Checker
(`src/`), the Revit extension (`revit/`), and the Civil 3D/AutoCAD checker
(`civil3d/`). Users share a single rules file across all three, so a schema
change in one tool silently breaks the other two. This skill is the contract.

## The schema (as validated by `src/rulesStore.js`)

Top-level required keys — `validateRulesShape` throws if any is missing:

- `project`: array of `{id, label, value}` expected project-info fields
  (PROJECT NAME / PROJECT NO / CLIENT).
- `spelling`: `{language, customDictionary[], ignore[]}`.
- `titleBlockRegion`: `{corner, widthPct, heightPct}`.
- `rules`: array of rule objects.

Rule object fields:

- `id` (unique), `category` (`titleBlock` | `revision` | `formatting` | ...),
  `label`, `message`, `enabled` (bool), `severity` (`error` | `warn` ONLY —
  validated against `VALID_SEVERITIES`).
- Matching fields, all optional, all validated as compilable regex:
  `pattern` (value must match), or the pair `find` + `valid`
  (find candidates, flag those not matching `valid`).

## Rules for changing the schema

1. **New fields must be optional with safe defaults.** A rules file written
   by an older tool version must still load everywhere
   (`addRule` already defaults `enabled: true, severity: 'warn'` — follow
   that pattern). Never add a new required top-level key without a loader
   fallback in all three tools.
2. **Change all three consumers in the same commit** — `src/rulesStore.js` /
   `rulesEngine.js`, the Revit extension's rules loader, and the Civil 3D
   loader — or explicitly document in the commit why a consumer is exempt.
3. **`tests/revitRulesCompat.test.js` is the guard.** Extend it for every
   schema change; run `npm test` AND `npm run test:py` (Revit + Civil 3D
   unittest suites) before committing.
4. **Severities stay `error`/`warn`.** Adding a level means touching every
   result grid, CSV export, and filter in all three UIs — treat as a
   cross-tool feature, not a field tweak.
5. **Regexes are user-supplied JavaScript-flavor.** The Python consumers
   must keep translating/validating them the way the compat test encodes;
   don't introduce JS-only regex features into DEFAULT_RULES.
6. **CSV export columns are part of the contract** — the Revit and web
   checkers export the same columns; a rules change that adds a result
   dimension must update both exports identically.

## Quick verification

```
npm test              # JS suite incl. revitRulesCompat
npm run test:py       # revit/tests + civil3d/tests
```

Both must pass before any rules-schema commit.
