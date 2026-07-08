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


def build_transform(pairs, match_case=False):
    """A single text transform applying every (find, replace) pair in order.

    Used by multi-file batch replace so a whole batch of corrections runs as
    one pass over each text element. Empty find terms are skipped.
    """
    compiled = []
    for find, replace in pairs:
        if not find:
            continue
        flags = 0 if match_case else re.IGNORECASE
        compiled.append((re.compile(re.escape(find), flags), replace or ''))

    def transform(text):
        if text is None:
            return None
        for regex, replacement in compiled:
            text = regex.sub(lambda m: replacement, text)
        return text

    return transform


def parse_pairs_csv(text):
    """Parse a two-column find,replace CSV (as exported by the checkers).

    Skips a leading `find,replace` header and blank find cells; undoes the
    leading-apostrophe CSV-injection guard. Returns [(find, replace)].
    """
    import csv
    import io as _io

    pairs = []
    reader = csv.reader(_io.StringIO(text))
    for index, row in enumerate(reader):
        if not row or not (row[0] or '').strip():
            continue
        find = row[0]
        replace = row[1] if len(row) > 1 else ''
        if index == 0 and find.strip().lower() == 'find':
            continue
        for cell in (find, replace):
            pass
        find = _unguard(find)
        replace = _unguard(replace)
        pairs.append((find, replace))
    return pairs


def _unguard(cell):
    if cell[:1] == "'" and len(cell) > 1 and cell[1] in '=+-@\t':
        return cell[1:]
    return cell
