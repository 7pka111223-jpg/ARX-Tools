# -*- coding: utf-8 -*-
"""Rules file loading/validation — mirrors src/rulesStore.js.

The JSON schema is shared with the web Drawing Checker so one rules file
drives both tools: the four required top-level keys ("project", "spelling",
"rules", "titleBlockRegion") and the per-rule fields are identical. The
optional "revit" block adds Revit-only settings and passes through the JS
importer untouched. "titleBlockRegion" is PDF-specific and ignored here
(Revit reads parameters directly).
"""
from __future__ import unicode_literals

import copy
import json
import re

VALID_SEVERITIES = ('error', 'warn')

DEFAULT_REVIT_SETTINGS = {
    # Optional naming-convention regexes (None disables the check).
    'sheetNamePattern': None,
    'viewNamePattern': None,
    'scheduleNamePattern': None,
    # Maps a rule label (e.g. "CHECKED BY") to the sheet parameter name used
    # by the firm's title block family (e.g. "Checker Initials").
    'paramMap': {},
    'skipViewsNotOnSheets': True,
}

DEFAULT_RULES = {
    'project': [
        {'id': 'name', 'label': 'PROJECT NAME', 'value': ''},
        {'id': 'number', 'label': 'PROJECT NO', 'value': ''},
        {'id': 'client', 'label': 'CLIENT', 'value': ''},
    ],
    'spelling': {'language': 'en', 'customDictionary': [], 'ignore': []},
    'titleBlockRegion': {'corner': 'bottom-right', 'widthPct': 30, 'heightPct': 25},
    'rules': [
        {'id': 'dwgNo', 'category': 'titleBlock', 'label': 'DWG NO', 'pattern': '^[A-Z]{2}-\\d{3}$', 'message': 'Drawing number must match AA-000', 'severity': 'error', 'enabled': True},
        {'id': 'rev', 'category': 'revision', 'label': 'REV', 'message': 'Revision must be present', 'severity': 'error', 'enabled': True},
        {'id': 'date', 'category': 'revision', 'label': 'DATE', 'message': 'Date must be present', 'severity': 'error', 'enabled': True},
        {'id': 'drawnBy', 'category': 'revision', 'label': 'DRAWN BY', 'message': 'Drawn-by must be present', 'severity': 'error', 'enabled': True},
        {'id': 'checkedBy', 'category': 'revision', 'label': 'CHECKED BY', 'message': 'Checked-by must be present', 'severity': 'error', 'enabled': True},
        {'id': 'approvedBy', 'category': 'revision', 'label': 'APPROVED BY', 'message': 'Approved-by must be present', 'severity': 'error', 'enabled': True},
        {'id': 'isoDate', 'category': 'formatting', 'label': 'ISO date format', 'find': '\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b', 'valid': '^\\d{4}-\\d{2}-\\d{2}$', 'message': 'Use ISO date format (YYYY-MM-DD)', 'severity': 'warn', 'enabled': True},
    ],
    'revit': copy.deepcopy(DEFAULT_REVIT_SETTINGS),
}


def validate_rules_shape(rules_config):
    for key in ('project', 'spelling', 'rules', 'titleBlockRegion'):
        if key not in rules_config:
            raise ValueError('Invalid rules file: missing "%s"' % key)
    if not isinstance(rules_config['rules'], list):
        raise ValueError('Invalid rules file: "rules" must be an array')


def validate_rule(rule):
    if rule.get('severity') not in VALID_SEVERITIES:
        raise ValueError(
            'Invalid severity "%s" for rule "%s"; must be "error" or "warn"'
            % (rule.get('severity'), rule.get('id'))
        )
    for field in ('pattern', 'find', 'valid'):
        if rule.get(field) is None:
            continue
        try:
            re.compile(rule[field])
        except re.error as err:
            raise ValueError(
                'Invalid regex in "%s" for rule "%s": %s' % (field, rule.get('id'), err)
            )


def load_rules(source):
    """Parse + validate a rules file (JSON text or already-parsed dict).

    Returns a new dict with the "revit" block filled in with defaults for
    any missing keys. Raises ValueError on an invalid file, same conditions
    as the JS importRules.
    """
    parsed = json.loads(source) if isinstance(source, (str, bytes)) or _is_py2_text(source) else source
    parsed = copy.deepcopy(parsed)
    validate_rules_shape(parsed)
    for rule in parsed['rules']:
        validate_rule(rule)

    revit = copy.deepcopy(DEFAULT_REVIT_SETTINGS)
    revit.update(parsed.get('revit') or {})
    parsed['revit'] = revit
    return parsed


def _is_py2_text(source):
    # IronPython 2.7: json text may arrive as `unicode`, which is not `str`.
    try:
        return isinstance(source, unicode)  # noqa: F821 (py2 only)
    except NameError:
        return False


def default_rules():
    return copy.deepcopy(DEFAULT_RULES)
