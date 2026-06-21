import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFieldRules,
  evaluateFormattingRules,
  evaluateProjectRules,
  evaluateRules,
} from '../src/rulesEngine.js';

const region = { corner: 'bottom-right', widthPct: 30, heightPct: 25 };

function page(items, pageNumber = 1) {
  return { pageNumber, width: 1000, height: 800, items };
}

test('evaluateFieldRules flags a missing required field as an error', () => {
  const pages = [page([{ text: 'REV: A', x: 800, y: 700 }])];
  const rules = [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error' }];
  const issues = evaluateFieldRules(pages, rules, region);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'titleBlock');
  assert.equal(issues[0].severity, 'error');
  assert.equal(issues[0].ruleId, 'dwgNo');
});

test('evaluateFieldRules flags an invalid value', () => {
  const pages = [page([{ text: 'DWG NO: 12345', x: 800, y: 700 }])];
  const rules = [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error' }];
  const issues = evaluateFieldRules(pages, rules, region);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].foundText, '12345');
});

test('evaluateFieldRules produces no issues when valid', () => {
  const pages = [page([{ text: 'DWG NO: AB-123', x: 800, y: 700 }])];
  const rules = [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error' }];
  assert.equal(evaluateFieldRules(pages, rules, region).length, 0);
});

test('evaluateFormattingRules flags tokens that match find but not valid', () => {
  const pages = [page([{ text: 'DATE: 1/2/26', x: 100, y: 100 }])];
  const rules = [{
    id: 'isoDate', category: 'formatting',
    find: '\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b', valid: '^\\d{4}-\\d{2}-\\d{2}$',
    message: 'Use ISO date format (YYYY-MM-DD)', severity: 'warn', enabled: true,
  }];
  const issues = evaluateFormattingRules(pages, rules);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].foundText, '1/2/26');
  assert.equal(issues[0].message, 'Use ISO date format (YYYY-MM-DD)');
});

test('evaluateFormattingRules skips disabled rules', () => {
  const pages = [page([{ text: 'DATE: 1/2/26', x: 100, y: 100 }])];
  const rules = [{ id: 'isoDate', category: 'formatting', find: '\\d', valid: '^x$', message: 'x', severity: 'warn', enabled: false }];
  assert.equal(evaluateFormattingRules(pages, rules).length, 0);
});

test('evaluateProjectRules flags a mismatched project name', () => {
  const pages = [page([{ text: 'PROJECT: Wrong Name', x: 800, y: 700 }])];
  const issues = evaluateProjectRules(pages, { name: 'Right Name' }, region);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'project');
});

test('evaluateProjectRules produces no issues for an exact match', () => {
  const pages = [page([{ text: 'NAME: RightName', x: 800, y: 700 }])];
  const issues = evaluateProjectRules(pages, { name: 'RightName' }, region);
  assert.equal(issues.length, 0);
});

test('evaluateRules combines all enabled categories', () => {
  const pages = [page([{ text: 'DWG NO: AB-123', x: 800, y: 700 }])];
  const rulesConfig = {
    project: { name: '' },
    titleBlockRegion: region,
    rules: [
      { id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error', enabled: true },
      { id: 'rev', category: 'revision', label: 'REV', severity: 'error', enabled: true },
    ],
  };
  const issues = evaluateRules(pages, rulesConfig);
  // dwgNo passes, rev is missing -> exactly one issue
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'rev');
});
