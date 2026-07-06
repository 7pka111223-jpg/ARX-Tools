# -*- coding: utf-8 -*-
"""Rule evaluation over a model snapshot — mirrors src/rulesEngine.js.

Where the JS engine locates labelled text in a PDF title-block region, this
engine reads the same values from the snapshot the Revit adapter built
(sheet number, sheet parameters, project information). Issue dicts keep the
JS shape {category, severity, ruleId, foundText, page, message} with two
Revit extras: "elementId" (for linkify/select in the output window) and
"page" carrying the sheet number string instead of a PDF page index.
"""
from __future__ import unicode_literals

import re


def _issue(category, severity, rule_id, found_text, page, message, element_id=None):
    return {
        'category': category,
        'severity': severity,
        'ruleId': rule_id,
        'foundText': found_text,
        'page': page,
        'elementId': element_id,
        'message': message,
    }


def _bad_pattern_issue(rule_id, pattern, err, page=None):
    return _issue(
        'config', 'warn', rule_id, pattern, page,
        'Invalid pattern for rule "%s": %s — rule skipped' % (rule_id, err),
    )


def _is_blank(value):
    return value is None or not ('%s' % value).strip()


def evaluate_field_rules(sheet, field_rules):
    """titleBlock + revision rules against one sheet.

    The dwgNo rule reads the sheet number; every other rule reads the sheet
    parameter the adapter resolved under the rule's id. A parameter the
    adapter could not find at all is reported as its own warn (likely a
    title-block/paramMap mismatch) rather than a false "missing value".
    """
    issues = []
    missing_params = set(sheet.get('missingParams') or [])
    for rule in field_rules:
        page = sheet.get('number')
        element_id = sheet.get('elementId')
        if rule['id'] == 'dwgNo':
            value = sheet.get('number')
        elif rule['id'] in missing_params:
            issues.append(_issue(
                rule['category'], 'warn', rule['id'], None, page,
                'Parameter for "%s" not found on sheet — check the title block '
                'family or add a paramMap entry in the rules file' % rule['label'],
                element_id,
            ))
            continue
        else:
            value = (sheet.get('params') or {}).get(rule['id'])

        if _is_blank(value):
            issues.append(_issue(
                rule['category'], rule['severity'], rule['id'], None, page,
                'Missing required field "%s"' % rule['label'], element_id,
            ))
        elif rule.get('pattern'):
            try:
                matches = re.search(rule['pattern'], '%s' % value)
            except re.error as err:
                issues.append(_bad_pattern_issue(rule['id'], rule['pattern'], err, page))
                continue
            if not matches:
                issues.append(_issue(
                    rule['category'], rule['severity'], rule['id'], value, page,
                    'Field "%s" value "%s" does not match expected format' % (rule['label'], value),
                    element_id,
                ))
    return issues


def evaluate_project_rules(snapshot, project_fields):
    """Exact-match project info fields; only fields with a non-empty expected
    value are checked, same as the JS engine."""
    info = snapshot.get('projectInfo') or {}
    issues = []
    for field in project_fields:
        expected = field.get('value')
        if not expected:
            continue
        actual = info.get(field['id'])
        if _is_blank(actual) or ('%s' % actual).strip() != expected:
            issues.append(_issue(
                'project', 'error', field['id'], actual, None,
                'Project field "%s" expected "%s" but found "%s"'
                % (field['label'], expected, actual if not _is_blank(actual) else '(missing)'),
            ))
    return issues


_NAMING_CHECKS = (
    # (revit-config key, ruleId, what, snapshot accessor)
    ('sheetNamePattern', 'sheetName', 'Sheet name'),
    ('viewNamePattern', 'viewName', 'View name'),
    ('scheduleNamePattern', 'scheduleName', 'Schedule name'),
)


def evaluate_naming_rules(snapshot, revit_settings):
    """Naming-convention regexes for sheet, view and schedule names."""
    issues = []
    for key, rule_id, label in _NAMING_CHECKS:
        pattern = (revit_settings or {}).get(key)
        if not pattern:
            continue
        try:
            regex = re.compile(pattern)
        except re.error as err:
            issues.append(_bad_pattern_issue(rule_id, pattern, err))
            continue
        for sheet in snapshot.get('sheets', []):
            if rule_id == 'sheetName':
                targets = [(sheet.get('name'), sheet.get('elementId'))]
            elif rule_id == 'viewName':
                targets = [(v.get('name'), v.get('elementId')) for v in sheet.get('placedViews', [])]
            else:
                targets = [(s.get('name'), s.get('elementId')) for s in sheet.get('schedules', [])]
            for name, element_id in targets:
                if name is not None and not regex.search(name):
                    issues.append(_issue(
                        'naming', 'warn', rule_id, name, sheet.get('number'),
                        '%s "%s" does not match the naming convention' % (label, name),
                        element_id,
                    ))
    return issues


def evaluate_formatting_rules(entries, formatting_rules):
    """find/valid regex pairs over every text entry (text notes + names)."""
    issues = []
    for rule in formatting_rules:
        try:
            find_re = re.compile(rule['find'])
            valid_re = re.compile(rule['valid'])
        except re.error as err:
            issues.append(_bad_pattern_issue(rule['id'], rule.get('find'), err))
            continue
        for entry in entries:
            text = entry.get('text') or ''
            for match in find_re.finditer(text):
                if not valid_re.search(match.group(0)):
                    issues.append(_issue(
                        'formatting', rule.get('severity', 'warn'), rule['id'],
                        match.group(0), entry.get('page'), rule['message'],
                        entry.get('elementId'),
                    ))
    return issues


def collect_text_entries(snapshot):
    """Flatten every checkable text string in the snapshot.

    Each entry: {text, page (sheet number), elementId, context}. Used by
    both the spell checker and the formatting rules.
    """
    entries = []
    for sheet in snapshot.get('sheets', []):
        page = sheet.get('number')
        entries.append({
            'text': sheet.get('name'), 'page': page,
            'elementId': sheet.get('elementId'), 'context': 'sheet name',
        })
        for note in sheet.get('textNotes', []):
            entries.append({
                'text': note.get('text'), 'page': page,
                'elementId': note.get('elementId'), 'context': 'text note on sheet',
            })
        for view in sheet.get('placedViews', []):
            entries.append({
                'text': view.get('name'), 'page': page,
                'elementId': view.get('elementId'), 'context': 'view name',
            })
            for note in view.get('textNotes', []):
                entries.append({
                    'text': note.get('text'), 'page': page,
                    'elementId': note.get('elementId'),
                    'context': 'text note in view "%s"' % view.get('name'),
                })
        for schedule in sheet.get('schedules', []):
            entries.append({
                'text': schedule.get('name'), 'page': page,
                'elementId': schedule.get('elementId'), 'context': 'schedule name',
            })
    return entries


def collect_param_entries(snapshot):
    """Sheet parameter values as text entries.

    Formatting rules scan these too (in the PDF tool the title block is
    ordinary page text), but the spell checker does not — parameter values
    are mostly initials and codes.
    """
    entries = []
    for sheet in snapshot.get('sheets', []):
        for rule_id, value in sorted((sheet.get('params') or {}).items()):
            if value is None:
                continue
            entries.append({
                'text': '%s' % value,
                'page': sheet.get('number'),
                'elementId': sheet.get('elementId'),
                'context': 'sheet parameter "%s"' % rule_id,
            })
    return entries


def evaluate_rules(snapshot, rules_config):
    enabled = [r for r in rules_config['rules'] if r.get('enabled')]
    field_rules = [r for r in enabled if r.get('category') in ('titleBlock', 'revision')]
    formatting_rules = [r for r in enabled if r.get('category') == 'formatting']

    issues = []
    issues.extend(evaluate_project_rules(snapshot, rules_config.get('project', [])))
    for sheet in snapshot.get('sheets', []):
        issues.extend(evaluate_field_rules(sheet, field_rules))
    issues.extend(evaluate_naming_rules(snapshot, rules_config.get('revit')))
    formatting_entries = collect_text_entries(snapshot) + collect_param_entries(snapshot)
    issues.extend(evaluate_formatting_rules(formatting_entries, formatting_rules))
    return issues
