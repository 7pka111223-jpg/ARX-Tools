# -*- coding: utf-8 -*-
"""Mapping between the rules dict and the checker window's form fields.

Pure logic (headlessly testable); the WPF window just reads/writes the
flat form dict this module produces.
"""
from __future__ import unicode_literals

import copy
import re

from drawingchecker.rules_store import validate_rule

REVISION_RULE_IDS = ('rev', 'date', 'drawnBy', 'checkedBy', 'approvedBy')


def _rule_by_id(rules, rule_id):
    for rule in rules['rules']:
        if rule['id'] == rule_id:
            return rule
    return None


def _project_value(rules, field_id):
    for field in rules['project']:
        if field['id'] == field_id:
            return field.get('value') or ''
    return ''


def rules_to_form(rules):
    """Flatten the parts of the rules dict the window edits."""
    dwg = _rule_by_id(rules, 'dwgNo')
    revit = rules.get('revit') or {}
    spelling = rules.get('spelling') or {}
    return {
        'projectName': _project_value(rules, 'name'),
        'projectNumber': _project_value(rules, 'number'),
        'client': _project_value(rules, 'client'),
        'dwgNoPattern': (dwg.get('pattern') if dwg else '') or '',
        'sheetNamePattern': revit.get('sheetNamePattern') or '',
        'viewNamePattern': revit.get('viewNamePattern') or '',
        'scheduleNamePattern': revit.get('scheduleNamePattern') or '',
        'revisionEnabled': dict(
            (rule_id, bool(_rule_by_id(rules, rule_id) and _rule_by_id(rules, rule_id).get('enabled')))
            for rule_id in REVISION_RULE_IDS
        ),
        'customWords': '\n'.join(spelling.get('customDictionary') or []),
    }


def parse_word_list(text):
    """Split a custom-dictionary textbox (newlines/commas) into words."""
    words = []
    for chunk in re.split(r'[\n\r,;]+', text or ''):
        word = chunk.strip()
        if word and word not in words:
            words.append(word)
    return words


def _validate_pattern(name, pattern):
    if not pattern:
        return
    try:
        re.compile(pattern)
    except re.error as err:
        raise ValueError('Invalid regex for %s: %s' % (name, err))


def form_to_rules(rules, form):
    """Return a new rules dict with the form's edits applied.

    Raises ValueError with a user-readable message when a regex is invalid,
    leaving the input untouched.
    """
    for name, key in (
        ('drawing number format', 'dwgNoPattern'),
        ('sheet name pattern', 'sheetNamePattern'),
        ('view name pattern', 'viewNamePattern'),
        ('schedule name pattern', 'scheduleNamePattern'),
    ):
        _validate_pattern(name, form.get(key))

    updated = copy.deepcopy(rules)

    for field in updated['project']:
        key = {'name': 'projectName', 'number': 'projectNumber', 'client': 'client'}.get(field['id'])
        if key is not None and key in form:
            field['value'] = (form.get(key) or '').strip()

    dwg = _rule_by_id(updated, 'dwgNo')
    if dwg is not None and 'dwgNoPattern' in form:
        pattern = (form.get('dwgNoPattern') or '').strip()
        dwg['pattern'] = pattern if pattern else None
        validate_rule(dwg)

    revit = updated.setdefault('revit', {})
    for key in ('sheetNamePattern', 'viewNamePattern', 'scheduleNamePattern'):
        if key not in form:
            continue
        value = (form.get(key) or '').strip()
        revit[key] = value if value else None

    for rule_id, enabled in (form.get('revisionEnabled') or {}).items():
        rule = _rule_by_id(updated, rule_id)
        if rule is not None:
            rule['enabled'] = bool(enabled)

    if 'customWords' in form:
        updated.setdefault('spelling', {})['customDictionary'] = parse_word_list(form.get('customWords'))
    return updated


# ------------------------------------------------------- rules grid editor

GRID_COLUMNS = ('enabled', 'id', 'category', 'label', 'pattern', 'find', 'valid', 'severity', 'message')

VALID_CATEGORIES = ('titleBlock', 'revision', 'formatting')


def rules_to_grid(rules):
    """The rules array as flat row dicts for an editable grid (same fields
    as the web tool's rule editor)."""
    rows = []
    for rule in rules['rules']:
        rows.append({
            'enabled': bool(rule.get('enabled')),
            'id': rule.get('id') or '',
            'category': rule.get('category') or '',
            'label': rule.get('label') or '',
            'pattern': rule.get('pattern') or '',
            'find': rule.get('find') or '',
            'valid': rule.get('valid') or '',
            'severity': rule.get('severity') or 'warn',
            'message': rule.get('message') or '',
        })
    return rows


def _grid_text(row, key):
    return ('%s' % (row.get(key) or '')).strip()


def grid_to_rules(rules, rows):
    """Rebuild the rules array from grid rows; ValueError explains any
    problem in user terms. Blank rows (from the grid's new-row line) are
    skipped."""
    new_rules = []
    seen = set()
    for row in rows:
        texts = dict((key, _grid_text(row, key)) for key in GRID_COLUMNS if key != 'enabled')
        if not any(texts.values()):
            continue
        rule_id = texts['id']
        if not rule_id:
            raise ValueError('Every rule needs an ID (row with label "%s")' % texts['label'])
        if rule_id in seen:
            raise ValueError('Duplicate rule ID "%s"' % rule_id)
        seen.add(rule_id)
        category = texts['category'] or 'titleBlock'
        if category not in VALID_CATEGORIES:
            raise ValueError(
                'Rule "%s": category must be one of %s'
                % (rule_id, ', '.join(VALID_CATEGORIES)))
        if category == 'formatting' and not (texts['find'] and texts['valid']):
            raise ValueError('Rule "%s": formatting rules need both find and valid regexes' % rule_id)

        rule = {
            'id': rule_id,
            'category': category,
            'label': texts['label'] or rule_id,
            'severity': texts['severity'] or 'warn',
            'message': texts['message'] or ('Check failed for "%s"' % (texts['label'] or rule_id)),
            'enabled': bool(row.get('enabled')),
        }
        for key in ('pattern', 'find', 'valid'):
            if texts[key]:
                rule[key] = texts[key]
        try:
            validate_rule(rule)
        except ValueError as err:
            raise ValueError('%s' % err)
        new_rules.append(rule)

    updated = copy.deepcopy(rules)
    updated['rules'] = new_rules
    return updated
