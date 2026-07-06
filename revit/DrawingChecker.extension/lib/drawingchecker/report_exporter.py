# -*- coding: utf-8 -*-
"""CSV report export — same columns and escaping as src/reportExporter.js."""
from __future__ import unicode_literals

import re

CSV_HEADER = 'fileName,pass,severity,category,ruleId,page,foundText,message'

_FORMULA_PREFIX_RE = re.compile(r'^[=+\-@\t]')
_NEEDS_QUOTING_RE = re.compile(r'[",\r\n]')


def csv_field(value):
    text = '' if value is None else '%s' % value
    # Neutralize CSV formula injection: a leading =, +, -, @, or tab is
    # interpreted by Excel/Sheets/LibreOffice as the start of a formula.
    # Prefixing with a single quote marks the cell as text (OWASP CSV
    # injection mitigation).
    if _FORMULA_PREFIX_RE.search(text):
        text = "'" + text
    if _NEEDS_QUOTING_RE.search(text):
        return '"' + text.replace('"', '""') + '"'
    return text


def _js_bool(value):
    # Keep the pass column identical to the JS tool's output (true/false).
    return 'true' if value else 'false'


def generate_csv(aggregate_result):
    rows = [CSV_HEADER]
    for drawing in aggregate_result['drawings']:
        if not drawing['issues']:
            rows.append(','.join(csv_field(v) for v in
                                 [drawing['fileName'], _js_bool(drawing['pass']), '', '', '', '', '', '']))
        for issue in drawing['issues']:
            rows.append(','.join(csv_field(v) for v in [
                drawing['fileName'],
                _js_bool(drawing['pass']),
                issue['severity'],
                issue['category'],
                issue['ruleId'],
                issue.get('page') or '',
                issue.get('foundText') or '',
                issue['message'],
            ]))
    return '\n'.join(rows)
