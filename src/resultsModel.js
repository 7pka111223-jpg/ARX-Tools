function countBySeverity(issues) {
  return issues.reduce(
    (acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1;
      return acc;
    },
    { error: 0, warn: 0 }
  );
}

export function buildDrawingResult(fileName, issues) {
  const hasError = issues.some((i) => i.severity === 'error');
  return { fileName, pass: !hasError, issues, counts: countBySeverity(issues) };
}

export function aggregateResults(drawingResults) {
  return {
    total: drawingResults.length,
    passed: drawingResults.filter((r) => r.pass).length,
    failed: drawingResults.filter((r) => !r.pass).length,
    drawings: drawingResults,
  };
}
