# -*- coding: utf-8 -*-
"""Wordlist-based spell check (same issue shape as src/spellChecker.js)."""
from __future__ import unicode_literals

from drawingchecker.tokenizer import tokenize


def check_spelling(entries, wordset, spelling_config=None, extra_words=()):
    """Spell-check text entries against a set of known lowercase words.

    entries: iterable of dicts with keys "text", "page" (sheet number),
    "elementId" and "context" (where the text lives, e.g. 'text note in
    view "Level 1"').

    spelling_config is the "spelling" block of the rules file
    ({customDictionary, ignore}); extra_words is any additional allowed
    vocabulary (bundled drafting abbreviations, user dictionary file).
    """
    spelling_config = spelling_config or {}
    allowed = set(w.lower() for w in spelling_config.get('customDictionary', []))
    allowed.update(w.lower() for w in spelling_config.get('ignore', []))
    allowed.update(w.lower() for w in extra_words)

    issues = []
    for entry in entries:
        for display, parts in tokenize(entry.get('text')):
            if display.lower() in allowed:
                continue
            if all(p in wordset or p in allowed for p in parts):
                continue
            context = entry.get('context')
            message = 'Possible misspelling: "%s"' % display
            if context:
                message += ' (%s)' % context
            issues.append({
                'category': 'spelling',
                'severity': 'warn',
                'ruleId': 'spelling',
                'foundText': display,
                'page': entry.get('page'),
                'elementId': entry.get('elementId'),
                'message': message,
            })
    return issues
