# Plan: Offline HTML tool that imports culvert data from a CSV into an HY-8 project file

Date: 2026-07-15 · Source prompt: build an HTML tool that maps culverts between Table1.csv and Section_1.hy8 (by station or name), overwrites HY-8 geometry/elevation fields from the CSV with SI→US conversion, diffs the two files, and sets design flows.
Estimated sessions: 6 · Models used: Sonnet 5 (×4), Haiku 4.5 (×3)

## Objective

Build a fully-offline, single-file HTML tool (ARX-Tools house pattern) that
reads a culvert schedule CSV (SI units) and an HY-8 `.hy8` project file
(US customary units), maps culverts between them by station or by culvert
name, and produces a modified `.hy8` download in which geometry, elevations,
names/stations, and design flows come from the CSV. It also reports the
differences between the two files without modifying anything.

## Deliverables

- `src/hy8/hy8File.js` — line-preserving .hy8 parser/patcher (ES module)
- `src/hy8/csvCulverts.js`, `src/hy8/units.js` — CSV parser, station parser, SI→US conversion
- `src/hy8/mapper.js`, `src/hy8/differ.js` — culvert matching + differences report
- `src/hy8/flowUpdater.js` — design-flow update logic
- `hy8-importer.template.html` + build entry in `build.js` → `dist/hy8-importer.html` (gitignored, built by `npm run build`)
- `tests/hy8File.test.js`, `tests/hy8CsvUnits.test.js`, `tests/hy8Mapper.test.js`, `tests/hy8Flow.test.js`, `tests/hy8Integration.test.js` (node --test)
- Test fixtures (already committed with this plan): `tests/fixtures/hy8/Section_1.hy8`, `tests/fixtures/hy8/Table1.csv`
- README section documenting the tool

## Verified format facts (do not re-derive; measured from the real fixtures)

### HY-8 file (`tests/fixtures/hy8/Section_1.hy8`)

- ASCII text, **CRLF** line endings, header line `HY8PROJECTFILE80`.
- Keyword-value lines: keyword padded with spaces to column 22, then values.
  Floats are printed `%.6f` followed by 2–3 trailing spaces. Edited lines must
  reproduce this style; untouched lines must round-trip **byte-identical**.
- Structure: `NUMCROSSINGS 84`, then repeated blocks
  `STARTCROSSING "<name>"` … `ENDCROSSING "<name>"`, each containing
  `NUMCULVERTS 1` and one `STARTCULVERT "<name>"` … `ENDCULVERT "<name>"` block.
- All numeric values are stored in **US customary units** regardless of the
  `UNITS` flag (verified: `BARRELDATA 8.202100` ft = 2.5 m; `INVERTDATA`
  outlet station 237.204724 ft = 72.3 m).
- Per-crossing keywords this tool touches:
  - `INVERTDATA  <inletSta_ft> <USIL_ft> <outletSta_ft> <DSIL_ft>` (4 floats)
  - `BARRELDATA  <span_ft> <rise_ft> <n1> <n2>` — only first two change; keep Manning's n
  - `NUMBEROFBARRELS <int>`
  - `CHANNELGEOMETRY <f1> <f2> <f3> <f4> <invertElev_ft>` — only last value changes
  - `TAILWATERTYPE 6` (constant tailwater, all 84 crossings) with
    `NUMRATINGCURVE 12` and `TWRATINGCURVE` = 12 rows of 4 floats; rows 2–12
    are **continuation lines with no keyword** (leading whitespace). The
    constant tailwater elevation is the **first column of every row**.
  - `DISCHARGERANGE <min_cfs> <design_cfs> <max_cfs>`
  - `DISCHARGEXYDESIGN 11` followed by 11 pairs of
    `DISCHARGEXYDESIGN_Y <cfs>` / `DISCHARGEXYDESIGN_NAME "<s>"`. Observed
    generation rule: 11 values evenly spaced min→max, with the slot nearest
    the design flow replaced by the exact design flow.
  - `STARTCROSSING`/`ENDCROSSING "<crossing name>"` (must stay equal in a block),
    `STARTCULVERT`/`ENDCULVERT "<culvert name>"` (likewise).
  - There is also an indented `RATINGCURVE … END RATINGCURVE` sub-block
    (`FLOW`/`ELEVATION`/`VELOCITY` triplets) — **do not modify it**; HY-8
    recomputes results.
- Crossing names are stations like `"-2+592"`, `"-0+887"`, `"12+727"`.
- Culvert names: `CU-JSS-01` … `CU-JSS-80`; the file has one culvert
  (`CU-JSS-38`) that does not exist in the CSV — 84 vs 83.

### CSV (`tests/fixtures/hy8/Table1.csv`)

- Row 1 is a banner (`"Culverts Data", , , …`), row 2 is the header, rows
  3–85 are 83 culverts. Quoted fields, comma-separated. The degree symbol is
  mojibake (`�`) — read as-is, don't assume UTF-8 validity.
- Columns used: `Name`, `Station`, `Cells`, `Width (m)`, `Rise (m)`,
  `Length (m)`, `USIL (m)`, `DSIL (m)`. All SI. Elevations are negative
  (e.g. `-355.29`) — legitimate datum, no special handling.
- Station format `X+YYY` with a quirk: a minus **after** the plus marks the
  whole chainage negative (user-confirmed): `"0+-887"` → −887 m,
  `"-2+-601"` → −2601 m, `"1+409"` → +1409 m.
- CSV stations and HY-8 crossing names **genuinely disagree in value** for
  many rows (`9+868` vs `9+858`, `1+409` vs `1+410`), hence
  tolerance-based numeric matching (user-confirmed).

### Conversion constants (exact)

- meters → feet: × `1 / 0.3048` = 3.280839895013123
- m³/s → cfs: × `1 / 0.3048³` = 35.31466672148859
- Round-trip check: 72.3 m → 237.204724 ft; 10 m³/s → 353.146667 cfs
  (matches fixture values to 6 decimals).

## User decisions (answered 2026-07-15, treat as requirements)

1. **Station matching**: numeric with tolerance — parse both sides to meters,
   match each CSV row to the nearest HY-8 crossing within a UI-configurable
   tolerance (default ±15 m); unmatched rows listed for manual review.
2. **Station format**: `X+-YYY` means negative chainage (see above).
3. **Max flow**: design flow is entered in m³/s; max = (design + 5) m³/s;
   min = 0. Convert to cfs only when writing.
4. **Cells column**: update `NUMBEROFBARRELS` from CSV `Cells` on import AND
   include it in the differences report.

## Assumptions (made because the prompt did not specify)

- **Flow input format**: a textarea where two columns (culvert name, flow in
  m³/s) are pasted (tab/comma/space separated), plus an optional small CSV
  upload with the same two columns. Flow rows are keyed by **culvert name**
  regardless of the selected mapping mode. If wrong, affects tasks 1.4, 2.1.
- **DISCHARGEXYDESIGN regeneration**: when the design flow changes, rewrite
  the 11 `_Y` values as 11 evenly spaced values 0→max with the slot nearest
  the design flow replaced by the exact design flow, all `_NAME ""` —
  mirrors the observed rule in the fixture. If wrong, affects tasks 1.4, 3.1.
- **Diff tolerance**: numeric fields compare equal within 0.01 ft after
  converting CSV values to US units. If wrong, affects task 1.3.
- **Repo placement**: sources under `src/hy8/`, bundled by the existing
  `build.js` into `dist/hy8-importer.html`; `dist/` stays gitignored per
  CLAUDE.md (this overrides the offline-html-tool skill's "commit the
  standalone twin" rule — repo convention wins). If wrong, affects task 2.1.
- **Fixtures committed**: the user's two uploaded files are committed as test
  fixtures under `tests/fixtures/hy8/` (session upload paths are ephemeral).
  If the data must not live in the repo, tasks 1.1–3.1 need synthetic
  fixtures instead.
- **Only listed fields change**: slope, skewness, cover, wall lengths/angles,
  roadway data, scour blocks etc. are never written and not diffed.

## Open questions (answers change the plan)

- None remaining — all four blocking questions were answered by the user
  (see "User decisions"). New questions raised during execution must be
  added here, not improvised by executors.

## Phase 1 — Core logic modules (pure ES modules + unit tests)

### Task 1.1 [model: Sonnet 5 | effort: high]
**Context:** Everything else depends on reading and byte-safely rewriting the
.hy8 file. HY-8 is picky; an executor must preserve every line it doesn't
intentionally change, including CRLF and column padding.
**Inputs:** `tests/fixtures/hy8/Section_1.hy8`; format facts in this plan.
**Work:** Create `src/hy8/hy8File.js` exporting:
- `parseHy8(text)` → `{ lines, crossings }` where `lines` is the raw line
  array (line endings preserved or tracked) and `crossings` is
  `[{ name, startLine, endLine, culverts: [{ name, lineIndex map for each
  keyword: INVERTDATA, BARRELDATA, NUMBEROFBARRELS, CHANNELGEOMETRY,
  TWRATINGCURVE (all row line indexes), DISCHARGERANGE, DISCHARGEXYDESIGN_Y
  (all), STARTCULVERT/ENDCULVERT, and the parsed float values }] }]`.
  Handle TWRATINGCURVE continuation lines (rows 2..NUMRATINGCURVE have no
  keyword). Skip the indented RATINGCURVE sub-block content.
- `patchValues(doc, edits)` — replace values on specific keyword lines,
  formatting floats as `%.6f`, keyword column width 21, preserving the
  original spacing style of that line where feasible.
- `serializeHy8(doc)` → text with CRLF, byte-identical to input when no
  edits were made.
Scope fence: no CSV logic, no mapping logic, no UI, no unit conversion.
**Output:** `src/hy8/hy8File.js`, `tests/hy8File.test.js`.
**Acceptance:** `npm test` passes; a test asserts
`serializeHy8(parseHy8(fixture)) === fixture` byte-for-byte; a test patches
CU-JSS-01's INVERTDATA and asserts only the expected line(s) changed (diff
of line arrays has exactly the intended indices).
**Depends on:** none.

### Task 1.2 [model: Haiku 4.5 | effort: low] [P]
**Context:** The CSV side and the unit/station conversions are fully
specified above — mechanical implementation.
**Inputs:** `tests/fixtures/hy8/Table1.csv`; format facts + constants in this plan.
**Work:** Create `src/hy8/units.js` exporting `M_TO_FT`, `CMS_TO_CFS`,
`mToFt(x)`, `cmsToCfs(x)`, and `parseStationMeters(str)` implementing the
user-confirmed rule (`"0+-887"` → −887, `"-2+-601"` → −2601, `"1+409"` →
1409; also plain HY-8 forms `"-0+887"` → −887). Create
`src/hy8/csvCulverts.js` exporting `parseCulvertCsv(text)` → array of
`{ name, stationRaw, stationM, cells, widthM, riseM, lengthM, usilM, dsilM }`;
skip the banner row, use the header row to locate columns by name, handle
quoted fields, tolerate the mojibake degree character, skip blank rows.
Scope fence: no .hy8 code, no mapping, no UI.
**Output:** `src/hy8/units.js`, `src/hy8/csvCulverts.js`, `tests/hy8CsvUnits.test.js`.
**Acceptance:** `npm test` passes; tests assert the fixture parses to exactly
83 rows, CU-JSS-01 row equals the known values, the four station examples
above parse to the stated meters, and 72.3 m → 237.204724 ft (6 d.p.).
**Depends on:** none.

### Task 1.3 [model: Sonnet 5 | effort: high]
**Context:** Matching and diffing is where judgment lives: two mapping modes,
tolerance matching, one-sided leftovers (CU-JSS-38), and requirement 3's
"differences only" report.
**Inputs:** modules from 1.1 and 1.2; fixtures; "User decisions" section.
**Work:** Create `src/hy8/mapper.js` exporting
`mapCulverts(csvRows, hy8Doc, { mode: 'name'|'station', toleranceM })` →
`{ pairs: [{ csvRow, crossing, culvert }], unmatchedCsv, unmatchedHy8 }`.
Name mode: exact case-insensitive trimmed match on culvert name. Station
mode: nearest numeric station within tolerance (default 15 m), each HY-8
crossing used at most once, prefer the closest pairing globally (greedy by
ascending distance is acceptable). Create `src/hy8/differ.js` exporting
`diffPair(pair)` → list of `{ field, csvValue, hy8Value, csvValueUS }` for
ONLY the fields that differ (tolerance 0.01 ft): USIL, DSIL, length (outlet
station), span, rise, cells, channel invert elevation vs DSIL, constant
tailwater elevation vs DSIL, and the name/station label of the other mode.
Scope fence: no file writing, no UI.
**Output:** `src/hy8/mapper.js`, `src/hy8/differ.js`, `tests/hy8Mapper.test.js`.
**Acceptance:** `npm test` passes; tests assert: name-mode on the fixtures
yields 83 pairs + CU-JSS-38 unmatched on the HY-8 side; station-mode with
15 m tolerance pairs `1+409`↔`1+410` and leaves `-2+-601` behavior explicit
(matched or unmatched per the real distance — assert whichever the data
gives); diffing CU-JSS-01 reports USIL −355.29 m vs 16.404199 ft as a
difference and does NOT report span/rise (2.5 m vs 8.202100 ft are equal
within tolerance).
**Depends on:** 1.1, 1.2.

### Task 1.4 [model: Haiku 4.5 | effort: low]
**Context:** Requirement 4 — set design flows. Rule fully specified.
**Inputs:** modules from 1.1/1.2; "User decisions" 3; assumptions on
DISCHARGEXYDESIGN regeneration and flow-input format.
**Work:** Create `src/hy8/flowUpdater.js` exporting:
- `parseFlowInput(text)` → `[{ name, flowCms }]` (two columns split on
  tab/comma/semicolon/whitespace runs; ignore blank lines and a header line
  if the flow cell is non-numeric).
- `applyFlows(doc, flows)` — for each culvert matched **by name**: design =
  flow, max = flow + 5 (both m³/s), min = 0; convert to cfs; patch
  `DISCHARGERANGE` and rewrite the 11 `DISCHARGEXYDESIGN_Y` values per the
  regeneration rule in Assumptions. Return `{ updated, unmatchedNames }`.
Scope fence: no UI; use 1.1's patch API only — never touch lines directly.
**Output:** `src/hy8/flowUpdater.js`, `tests/hy8Flow.test.js`.
**Acceptance:** `npm test` passes; test applies `CU-JSS-01, 10` and asserts
DISCHARGERANGE becomes `0.000000 353.146667 529.720001` (6 d.p.) and the 11
`_Y` values are evenly spaced 0→529.720001 with the nearest slot replaced by
353.146667; serialized file differs from the fixture only on those lines.
**Depends on:** 1.1, 1.2.

## Phase 2 — UI and build integration

### Task 2.1 [model: Sonnet 5 | effort: high]
**Context:** Assemble the offline single-file tool per house pattern.
**Inputs:** all Phase-1 modules; `index.template.html` + `build.js` as the
pattern to copy; `.claude/skills/offline-html-tool/SKILL.md` (load it).
**Work:** Create `hy8-importer.template.html` and `src/hy8/ui/` (main module
+ styles) implementing: (a) two file inputs — CSV and .hy8 — read via
FileReader, drag-drop optional; (b) mapping-mode radio (culvert name /
station) + tolerance number input (default 15 m, station mode only);
(c) mapping preview table: pairs plus both unmatched lists; (d) “Check
differences” view rendering diffPair results only where differences exist,
per culvert, showing CSV (SI), CSV converted (US), HY-8 (US); (e) flow
input textarea + optional CSV picker feeding parseFlowInput, with an
unmatched-names warning; (f) “Import & download” button that applies, in
order: geometry/elevation/cells patches for every pair (INVERTDATA inlet
station 0 / USIL / outlet station = length / DSIL; BARRELDATA span/rise;
NUMBEROFBARRELS; CHANNELGEOMETRY last value = DSIL; all TWRATINGCURVE first
columns = DSIL; name mode → set STARTCROSSING/ENDCROSSING to the CSV
Station string; station mode → set STARTCULVERT/ENDCULVERT to the CSV
Name), then flow updates if provided, then downloads a Blob named
`<original>_updated.hy8` with CRLF preserved; (g) a “no data leaves this
browser” notice. Extend `build.js` so `npm run build` also emits
`dist/hy8-importer.html`. Scope fence: no network calls, no new npm runtime
dependencies, don't touch the drawing-checker entry, don't commit `dist/`.
**Output:** `hy8-importer.template.html`, `src/hy8/ui/*`, `build.js` change,
README section stub.
**Acceptance:** `npm run build` succeeds and `dist/hy8-importer.html` is a
single file with no `http(s)://` references; `npm test` still passes;
loading the built file from `file://` in Chromium, selecting both fixtures,
name mode, and clicking Import downloads a file (verifiable via Playwright
with the pre-installed Chromium).
**Depends on:** 1.1–1.4.

## Phase 3 — Verify

### Task 3.1 [model: Sonnet 5 | effort: high]
**Context:** End-to-end proof on the real fixtures before the user risks
their HY-8 project.
**Inputs:** everything above; fixtures.
**Work:** Write `tests/hy8Integration.test.js` driving the modules headlessly
(no browser): full pipeline CSV+HY8 → name-mode map → apply all patches +
flows for 3 sample culverts → serialize. Assert: (1) every non-targeted line
is byte-identical to the fixture; (2) for CU-JSS-01 the INVERTDATA line is
`0.000000 −1165.649…  237.204724 −1167.782…` (compute exact expected values
with the constants, 6 d.p.); (3) crossing name became `"-2+-601"` in both
STARTCROSSING and ENDCROSSING; (4) NUMCROSSINGS and untouched crossings
(CU-JSS-38) unchanged. Also run the built UI once in Playwright/Chromium
against the fixtures and diff the downloaded file against the headless
result — they must be identical. Fix whatever this uncovers (small fixes
in-scope; architectural problems go back as plan updates).
**Output:** `tests/hy8Integration.test.js`, fixes, short verification note in
the PR/commit message.
**Acceptance:** `npm test` and `npm run build` green; downloaded-vs-headless
outputs byte-identical.
**Depends on:** 2.1.

### Task 3.2 [model: none — user manual step]
**Context:** Only real HY-8 (Windows) can prove the file still opens.
**Work:** User opens the generated `_updated.hy8` in HY-8, spot-checks
CU-JSS-01 (USIL/DSIL/span/rise/length/barrels/tailwater/design flow) and
saves. Report any load error or wrong field back; that feedback re-opens
task 1.1 or 2.1.
**Depends on:** 3.1.

## Phase 4 — Document and ship

### Task 4.1 [model: Haiku 4.5 | effort: low]
**Context:** Land the work per repo convention.
**Inputs:** completed code; README.md; CLAUDE.md rules.
**Work:** Write the README section (what the tool does, both mapping modes,
station-format rule, flow rules min 0 / max +5 m³/s, units note, offline
notice, `npm run build` usage). Update CLAUDE.md Layout bullet list to
mention `src/hy8/`. Commit sources only (never `dist/`) with a descriptive
message; push with `git push -u origin claude/skill-installation-rm7ys4`.
**Output:** README + CLAUDE.md updates, pushed branch.
**Acceptance:** `git status` clean, `npm test` green at HEAD, branch pushed.
**Depends on:** 3.1 (3.2 feedback folded in if available).

## Token-optimization notes

- The 500 KB .hy8 fixture is the big token hazard: executors must NEVER Read
  the whole fixture into context — the format facts are already in this plan;
  spot-check with Grep/`sed -n` ranges only. Tests, not eyeballs, verify the
  full file.
- All decisions are made (this plan + user answers); no Opus/Fable needed —
  implementation is Sonnet, mechanical parts are Haiku.
- Batch the two Haiku tasks (1.2, 1.4) into one session to pay context once;
  1.4 runs after 1.1 exists, so schedule the Haiku session after 1.1 lands.
- No subagent fan-out needed at execution time; each task's inputs are
  pinned to exact paths.

## Execution order

1. Session 1 (Sonnet 5): Task 1.1
2. Session 2 (Haiku 4.5, effort low): Tasks 1.2 + 1.4 batched
3. Session 3 (Sonnet 5): Task 1.3
4. Session 4 (Sonnet 5): Task 2.1
5. Session 5 (Sonnet 5): Task 3.1 → then user runs 3.2 in HY-8
6. Session 6 (Haiku 4.5, effort low): Task 4.1
