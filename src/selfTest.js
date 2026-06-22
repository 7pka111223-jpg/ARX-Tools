import { evaluateRules } from './rulesEngine.js';

const SELF_TEST_RULES = {
  project: [],
  rules: [
    { id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error', enabled: true },
    { id: 'rev', category: 'revision', label: 'REV', severity: 'error', enabled: true },
  ],
};

function page(items) {
  return { pageNumber: 1, width: 1000, height: 800, items };
}

const SYNTHETIC_CASES = [
  {
    name: 'complete title block passes',
    pages: [page([
      { text: 'DWG NO: AB-123', x: 800, y: 700 },
      { text: 'REV: A', x: 800, y: 720 },
    ])],
    expectPass: true,
  },
  {
    name: 'missing drawing number fails',
    pages: [page([
      { text: 'REV: A', x: 800, y: 720 },
    ])],
    expectPass: false,
  },
  {
    name: 'malformed drawing number fails',
    pages: [page([
      { text: 'DWG NO: 12345', x: 800, y: 700 },
      { text: 'REV: A', x: 800, y: 720 },
    ])],
    expectPass: false,
  },
];

export function runSelfTest() {
  const results = SYNTHETIC_CASES.map((testCase) => {
    const issues = evaluateRules(testCase.pages, SELF_TEST_RULES);
    const actualPass = !issues.some((i) => i.severity === 'error');
    return { name: testCase.name, ok: actualPass === testCase.expectPass, issues };
  });
  return { allPassed: results.every((r) => r.ok), results };
}
