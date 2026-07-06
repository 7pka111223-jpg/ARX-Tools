# -*- coding: utf-8 -*-
"""Result aggregation — mirrors src/resultsModel.js.

One "drawing" result per sheet (fileName = "number — name"), plus a
"Project" pseudo-drawing collecting the document-level issues (project
info, invalid rule patterns) whose page is None.
"""
from __future__ import unicode_literals


def count_by_severity(issues):
    counts = {'error': 0, 'warn': 0}
    for issue in issues:
        counts[issue['severity']] = counts.get(issue['severity'], 0) + 1
    return counts


def build_drawing_result(file_name, issues):
    has_error = any(i['severity'] == 'error' for i in issues)
    return {
        'fileName': file_name,
        'pass': not has_error,
        'issues': issues,
        'counts': count_by_severity(issues),
    }


def aggregate_results(drawing_results):
    return {
        'total': len(drawing_results),
        'passed': sum(1 for r in drawing_results if r['pass']),
        'failed': sum(1 for r in drawing_results if not r['pass']),
        'drawings': drawing_results,
    }


def sheet_file_name(sheet):
    return '%s — %s' % (sheet.get('number'), sheet.get('name'))


def build_results(snapshot, issues):
    """Group a flat issue list into the aggregate result the reporters use."""
    drawings = []

    doc_issues = [i for i in issues if i.get('page') is None]
    if doc_issues:
        drawings.append(build_drawing_result(snapshot.get('docTitle') or 'Project', doc_issues))

    for sheet in snapshot.get('sheets', []):
        number = sheet.get('number')
        sheet_issues = [i for i in issues if i.get('page') == number]
        drawings.append(build_drawing_result(sheet_file_name(sheet), sheet_issues))

    return aggregate_results(drawings)
