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
        if key is not None:
            field['value'] = (form.get(key) or '').strip()

    dwg = _rule_by_id(updated, 'dwgNo')
    if dwg is not None:
        pattern = (form.get('dwgNoPattern') or '').strip()
        dwg['pattern'] = pattern if pattern else None
        validate_rule(dwg)

    revit = updated.setdefault('revit', {})
    for key in ('sheetNamePattern', 'viewNamePattern', 'scheduleNamePattern'):
        value = (form.get(key) or '').strip()
        revit[key] = value if value else None

    for rule_id, enabled in (form.get('revisionEnabled') or {}).items():
        rule = _rule_by_id(updated, rule_id)
        if rule is not None:
            rule['enabled'] = bool(enabled)

    updated.setdefault('spelling', {})['customDictionary'] = parse_word_list(form.get('customWords'))
    return updated
