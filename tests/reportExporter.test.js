import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCsv, generateHtmlReport, generateSpellingCsv, generateSpellingHtmlReport } from '../src/reportExporter.js';
import { buildDrawingResult, aggregateResults } from '../src/resultsModel.js';

function sampleAggregate() {
  const r1 = buildDrawingResult('a.pdf', []);
  const r2 = buildDrawingResult('b.pdf', [
    { category: 'spelling', severity: 'error', ruleId: 'spelling', foundText: 'clarifeir', page: 1, message: 'Possible misspelling: "clarifeir"' },
  ]);
  return aggregateResults([r1, r2]);
}

test('generateCsv includes a header row and one row per issue plus passing files', () => {
  const csv = generateCsv(sampleAggregate());
  const lines = csv.split('\n');
  assert.equal(lines[0], 'fileName,pass,severity,category,ruleId,page,foundText,message');
  assert.ok(lines.some((l) => l.startsWith('a.pdf,true')));
  assert.ok(lines.some((l) => l.includes('clarifeir')));
});

test('generateCsv escapes fields containing commas or quotes', () => {
  const agg = aggregateResults([buildDrawingResult('a.pdf', [
    { category: 'spelling', severity: 'warn', ruleId: 'spelling', foundText: 'a,b"c', page: 1, message: 'msg' },
  ])]);
  const csv = generateCsv(agg);
  assert.ok(csv.includes('"a,b""c"'));
});

test('generateHtmlReport includes summary counts and issue details', () => {
  const html = generateHtmlReport(sampleAggregate());
  assert.ok(html.includes('<title>Drawing Check Report</title>'));
  assert.ok(html.includes('1 / 2 passed'));
  assert.ok(html.includes('clarifeir'));
});

test('generateCsv neutralizes formula-injection leading characters (=, +, -, @)', () => {
  const cases = [
    { foundText: '=2+2', message: 'msg' },
    { foundText: '+2+2', message: 'msg' },
    { foundText: '-2+2', message: 'msg' },
    { foundText: '@SUM(1,1)', message: 'msg' },
  ];
  for (const c of cases) {
    const agg = aggregateResults([buildDrawingResult('a.pdf', [
      { category: 'spelling', severity: 'warn', ruleId: 'spelling', page: 1, ...c },
    ])]);
    const csv = generateCsv(agg);
    const lines = csv.split('\n');
    const row = lines.find((l) => l.includes('a.pdf') && l.includes('spelling'));
    const cells = row.split(',');
    // foundText is the 7th column (index 6): fileName,pass,severity,category,ruleId,page,foundText,message
    const foundTextCell = c.foundText.includes(',') ? null : cells[6];
    if (foundTextCell !== null) {
      assert.equal(foundTextCell, `'${c.foundText}`);
    }
    assert.ok(!csv.includes(`,${c.foundText},`), `raw unprefixed value ${c.foundText} should not appear as a bare cell`);
    assert.ok(csv.includes(`'${c.foundText}`), `expected leading-quote-prefixed value for ${c.foundText}`);
  }
});

test('generateCsv prefixes AND comma-quotes a value that starts with = and contains a comma', () => {
  const agg = aggregateResults([buildDrawingResult('a.pdf', [
    { category: 'spelling', severity: 'warn', ruleId: 'spelling', foundText: '=SUM(1,2)', page: 1, message: 'msg' },
  ])]);
  const csv = generateCsv(agg);
  assert.ok(csv.includes('"\'SUM(1,2)"') === false); // sanity: not missing the '='
  assert.ok(csv.includes('"\'=SUM(1,2)"'), 'expected the cell to be quoted and prefixed: "\'=SUM(1,2)"');
});

test('generateCsv quotes a field containing a bare carriage return', () => {
  const agg = aggregateResults([buildDrawingResult('a.pdf', [
    { category: 'spelling', severity: 'warn', ruleId: 'spelling', foundText: 'abc\rxyz', page: 1, message: 'msg' },
  ])]);
  const csv = generateCsv(agg);
  assert.ok(csv.includes('"abc\rxyz"'), 'expected bare CR field to be quoted');
});

test('generateHtmlReport defaults to "Drawing Check Report" when no title is given', () => {
  const html = generateHtmlReport(sampleAggregate());
  assert.ok(html.includes('<h1>Drawing Check Report</h1>'));
});

test('generateHtmlReport uses a custom title in both <title> and <h1>', () => {
  const html = generateHtmlReport(sampleAggregate(), 'Rules Check Report');
  assert.ok(html.includes('<title>Rules Check Report</title>'));
  assert.ok(html.includes('<h1>Rules Check Report</h1>'));
  assert.ok(!html.includes('Drawing Check Report'));
});

test('generateHtmlReport escapes an html-unsafe custom title', () => {
  const html = generateHtmlReport(sampleAggregate(), '<script>alert(1)</script>');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('generateHtmlReport escapes html-unsafe content', () => {
  const agg = aggregateResults([buildDrawingResult('<a>.pdf', [
    { category: 'spelling', severity: 'warn', ruleId: 'spelling', foundText: '<script>', page: 1, message: 'msg' },
  ])]);
  const html = generateHtmlReport(agg);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

const sampleSpelling = () => [
  { fileName: 'a.pdf', error: null, misspellings: [{ word: 'clarifeir', pages: [1, 2], suggestions: ['clarifier', 'clarified'] }] },
  { fileName: 'b.pdf', error: null, misspellings: [] },
  { fileName: 'c.pdf', error: 'No text found — this PDF may be a scanned image, not a CAD export.', misspellings: [] },
];

test('generateSpellingCsv has a header and a row per misspelling with suggestions', () => {
  const csv = generateSpellingCsv(sampleSpelling());
  const lines = csv.split('\n');
  assert.equal(lines[0], 'fileName,word,pages,suggestions');
  const row = lines.find((l) => l.includes('clarifeir'));
  assert.ok(row.includes('clarifier'));
  // Files with no misspellings and files with errors still get a status row.
  assert.ok(lines.some((l) => l.startsWith('b.pdf') && l.includes('No misspellings found')));
  assert.ok(lines.some((l) => l.startsWith('c.pdf') && l.includes('No text found')));
});

test('generateSpellingCsv neutralizes formula-injection in a suggestion-like field', () => {
  const csv = generateSpellingCsv([
    { fileName: 'a.pdf', error: null, misspellings: [{ word: '=cmd', pages: [1], suggestions: ['ok'] }] },
  ]);
  assert.ok(csv.includes("'=cmd"));
});

test('generateSpellingHtmlReport lists misspellings, suggestions, and a total', () => {
  const html = generateSpellingHtmlReport(sampleSpelling());
  assert.ok(html.includes('<title>Spelling Report</title>'));
  assert.ok(html.includes('clarifeir'));
  assert.ok(html.includes('clarifier'));
  assert.ok(html.includes('1 possible misspelling(s) across 3 file(s)'));
});

test('generateSpellingHtmlReport escapes html-unsafe content', () => {
  const html = generateSpellingHtmlReport([
    { fileName: '<a>.pdf', error: null, misspellings: [{ word: '<script>', pages: [1], suggestions: ['<b>'] }] },
  ]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
