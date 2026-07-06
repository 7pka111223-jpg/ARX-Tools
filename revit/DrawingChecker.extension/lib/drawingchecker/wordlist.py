# -*- coding: utf-8 -*-
"""Lazy, cached loading of the bundled wordlist and extra dictionaries."""
from __future__ import unicode_literals

import io
import os

_CACHE = {}

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
DEFAULT_WORDLIST_PATH = os.path.join(DATA_DIR, 'words_en.txt')
ABBREVIATIONS_PATH = os.path.join(DATA_DIR, 'abbreviations_drafting.txt')


def _parse(path):
    words = set()
    with io.open(path, 'r', encoding='utf-8') as fh:
        for line in fh:
            word = line.strip().lower()
            if word and not word.startswith('#'):
                words.add(word)
    return frozenset(words)


def load_wordlist(path=None):
    """Load a one-word-per-line file into a cached frozenset (lowercased).

    Lines starting with '#' are comments. The result is cached per path so
    repeated runs in the same Revit session skip the file read.
    """
    path = path or DEFAULT_WORDLIST_PATH
    if path not in _CACHE:
        _CACHE[path] = _parse(path)
    return _CACHE[path]


def load_optional_wordlist(path):
    """Like load_wordlist but returns an empty set for a missing/blank path."""
    if not path or not os.path.isfile(path):
        return frozenset()
    return load_wordlist(path)
