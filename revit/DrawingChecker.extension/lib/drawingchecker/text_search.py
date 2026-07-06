# -*- coding: utf-8 -*-
"""Find & replace over snapshot text entries (pure logic, no Revit)."""
from __future__ import unicode_literals

import re


def is_editable_entry(entry):
    """Only text notes can be edited; names are checked but not replaced here."""
    return (entry.get('context') or '').startswith('text note')


def find_matches(entries, find, match_case=False):
    """Return [{entry, count}] for every editable entry containing `find`."""
    matches = []
    if not find:
        return matches
    needle = find if match_case else find.lower()
    for entry in entries:
        if not is_editable_entry(entry):
            continue
        text = entry.get('text') or ''
        haystack = text if match_case else text.lower()
        count = haystack.count(needle)
        if count:
            matches.append({'entry': entry, 'count': count})
    return matches


def replace_text(text, find, replace, match_case=False):
    if match_case:
        return text.replace(find, replace)
    return re.sub(re.escape(find), lambda m: replace, text, flags=re.IGNORECASE)


def build_replacements(matches, find, replace, match_case=False):
    """[(elementId, newText)] for the Revit adapter to apply in a transaction."""
    replacements = []
    for match in matches:
        entry = match['entry']
        new_text = replace_text(entry.get('text') or '', find, replace, match_case)
        replacements.append((entry.get('elementId'), new_text))
    return replacements
