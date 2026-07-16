// Shared CSV field formatter for the HY-8 importer's exports.
export function csvField(v) {
  const s0 = String(v ?? '');
  // Neutralize CSV formula injection: a leading =, +, -, @, or tab is
  // interpreted by Excel/Sheets/LibreOffice as the start of a formula.
  // Prefixing with a single quote marks the cell as text (OWASP CSV
  // injection mitigation).
  const s = /^[=+\-@\t]/.test(s0) ? `'${s0}` : s0;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
