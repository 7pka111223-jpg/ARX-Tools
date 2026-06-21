import { escapeHtml } from './util.js';

function csvField(v) {
  const s0 = String(v ?? '');
  // Neutralize CSV formula injection: a leading =, +, -, @, or tab is
  // interpreted by Excel/Sheets/LibreOffice as the start of a formula.
  // Prefixing with a single quote marks the cell as text (OWASP CSV
  // injection mitigation).
  const s = /^[=+\-@\t]/.test(s0) ? `'${s0}` : s0;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function generateCsv(aggregateResult) {
  const header = 'fileName,pass,severity,category,ruleId,page,foundText,message';
  const rows = [];
  for (const d of aggregateResult.drawings) {
    if (d.issues.length === 0) {
      rows.push([d.fileName, d.pass, '', '', '', '', '', ''].map(csvField).join(','));
    }
    for (const i of d.issues) {
      rows.push(
        [d.fileName, d.pass, i.severity, i.category, i.ruleId, i.page ?? '', i.foundText ?? '', i.message]
          .map(csvField)
          .join(',')
      );
    }
  }
  return [header, ...rows].join('\n');
}

export function generateHtmlReport(aggregateResult) {
  const summaryRows = aggregateResult.drawings
    .map(
      (d) => `<tr><td>${escapeHtml(d.fileName)}</td><td>${d.pass ? 'PASS' : 'FAIL'}</td><td>${d.counts.error}</td><td>${d.counts.warn}</td></tr>`
    )
    .join('');

  const issueRows = aggregateResult.drawings
    .flatMap((d) =>
      d.issues.map(
        (i) =>
          `<tr><td>${escapeHtml(d.fileName)}</td><td>${escapeHtml(i.severity)}</td><td>${escapeHtml(i.category)}</td><td>${i.page ?? ''}</td><td>${escapeHtml(i.foundText ?? '')}</td><td>${escapeHtml(i.message)}</td></tr>`
      )
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Drawing Check Report</title>
<style>body{font-family:sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}</style>
</head><body>
<h1>Drawing Check Report</h1>
<p>${aggregateResult.passed} / ${aggregateResult.total} passed</p>
<table><thead><tr><th>File</th><th>Result</th><th>Errors</th><th>Warnings</th></tr></thead><tbody>${summaryRows}</tbody></table>
<h2>Issues</h2>
<table><thead><tr><th>File</th><th>Severity</th><th>Category</th><th>Page</th><th>Found</th><th>Message</th></tr></thead><tbody>${issueRows}</tbody></table>
</body></html>`;
}
