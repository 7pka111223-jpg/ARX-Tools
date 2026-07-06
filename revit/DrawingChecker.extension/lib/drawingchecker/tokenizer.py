# -*- coding: utf-8 -*-
"""Word extraction from drawing text (mirrors the cleaning in src/spellChecker.js)."""
from __future__ import unicode_literals

import re

_CLEAN_RE = re.compile(r"[^A-Za-z'\-]+")
_DIGIT_RE = re.compile(r"\d")
_ALPHA_RE = re.compile(r"[A-Za-z]")
_HYPHEN_SPLIT_RE = re.compile(r"-+")

MIN_WORD_LENGTH = 3


def _strip_possessive(part):
    if part.lower().endswith("'s"):
        return part[:-2]
    return part


def tokenize(text):
    """Split drawing text into checkable words.

    Returns a list of (display, parts) tuples: ``display`` is the cleaned
    token as it appeared (for reporting), ``parts`` are the lowercase words
    to look up in the dictionary. Hyphenated tokens are checked part by
    part ("AS-BUILT" -> check "built"; "as" is below the length cutoff).

    Skipped entirely: tokens containing digits (300MM, M12), tokens shorter
    than MIN_WORD_LENGTH, and tokens with no letters.
    """
    if not text:
        return []
    tokens = []
    for raw in text.split():
        if _DIGIT_RE.search(raw):
            continue
        clean = _CLEAN_RE.sub('', raw).strip("'-")
        if len(clean) < MIN_WORD_LENGTH or not _ALPHA_RE.search(clean):
            continue
        parts = []
        for part in _HYPHEN_SPLIT_RE.split(clean):
            part = _strip_possessive(part.strip("'"))
            if len(part) >= MIN_WORD_LENGTH:
                parts.append(part.lower())
        if parts:
            tokens.append((clean, parts))
    return tokens
