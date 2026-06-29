"""Render issues to CSV / HTML, matching the PDF tool's report shape so output
is consistent across hosts. Pure string functions (host-agnostic, testable)."""

from .util import escape_html

COLUMNS = ["page", "severity", "category", "ruleId", "foundText", "message"]


def issues_to_csv(issues):
    def cell(v):
        s = "" if v is None else str(v)
        if any(c in s for c in [",", '"', "\n"]):
            s = '"' + s.replace('"', '""') + '"'
        return s

    lines = [",".join(COLUMNS)]
    for it in issues:
        lines.append(",".join(cell(it.get(c)) for c in COLUMNS))
    return "\n".join(lines) + "\n"


def issues_to_html(issues, title="ARX Review Report"):
    head = (
        "<!doctype html><meta charset='utf-8'><title>%s</title>"
        "<style>body{font:13px system-ui;margin:24px;color:#1e293b}"
        "h1{font-size:18px}table{border-collapse:collapse;width:100%%}"
        "th,td{border:1px solid #cbd5e1;padding:6px 9px;text-align:left;vertical-align:top}"
        "th{background:#f1f5f9}.error{color:#b91c1c;font-weight:600}"
        ".warn{color:#b45309;font-weight:600}</style>" % escape_html(title)
    )
    rows = []
    for it in issues:
        sev = it.get("severity", "")
        rows.append(
            "<tr><td>%s</td><td class='%s'>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
            % (escape_html(it.get("page", "")), escape_html(sev), escape_html(sev),
               escape_html(it.get("category", "")), escape_html(it.get("ruleId", "")),
               escape_html(it.get("foundText") or ""), escape_html(it.get("message", "")))
        )
    summary = "%d issue(s)" % len(issues)
    body = (
        "<h1>%s</h1><p>%s</p>"
        "<table><tr><th>Sheet/Page</th><th>Severity</th><th>Category</th>"
        "<th>Rule</th><th>Found</th><th>Message</th></tr>%s</table>"
        % (escape_html(title), summary, "".join(rows) or "<tr><td colspan=6>No issues found.</td></tr>")
    )
    return head + body
