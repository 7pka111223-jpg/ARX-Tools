"""Spell checking — port of src/spellChecker.js plus a dependency-free speller.

``check_spelling`` is the exact port: it consumes a list of word dicts and any
object exposing ``.correct(word) -> bool``. For pyRevit/IronPython (which cannot
load C-extension spellers) ``SetSpeller`` provides a pure-Python checker backed
by a word set, with Norvig-style edit-distance suggestions. Under CPython mode
you can drop in ``pyspellchecker`` or a Hunspell binding instead — anything with
a ``correct`` method works.
"""

import os
import re

_ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class SetSpeller(object):
    """A minimal speller backed by a set of known lowercase words."""

    def __init__(self, words):
        self.words = set(w.lower() for w in words)

    def correct(self, word):
        return word.lower() in self.words

    def _edits1(self, word):
        splits = [(word[:i], word[i:]) for i in range(len(word) + 1)]
        deletes = [a + b[1:] for a, b in splits if b]
        transposes = [a + b[1] + b[0] + b[2:] for a, b in splits if len(b) > 1]
        replaces = [a + c + b[1:] for a, b in splits if b for c in _ALPHABET]
        inserts = [a + c + b for a, b in splits for c in _ALPHABET]
        return set(deletes + transposes + replaces + inserts)

    def suggest(self, word, limit=5):
        w = word.lower()
        if w in self.words:
            return []
        cands = [e for e in self._edits1(w) if e in self.words]
        if not cands:
            two = set()
            for e1 in self._edits1(w):
                two.update(e for e in self._edits1(e1) if e in self.words)
            cands = list(two)
        cands.sort()
        return cands[:limit]


def load_dic_speller(dic_path):
    """Load a Hunspell ``.dic`` file (base words only; affix flags after '/' are
    stripped). Affixes are not expanded, so inflected forms should be added via a
    custom dictionary or by also loading a plain word list."""
    words = []
    with open(dic_path, "r") as fh:
        lines = fh.read().splitlines()
    # First line of a .dic is the entry count; skip it if numeric.
    if lines and lines[0].strip().isdigit():
        lines = lines[1:]
    for line in lines:
        base = line.split("/", 1)[0].strip()
        if base:
            words.append(base)
    return SetSpeller(words)


def load_word_list(path):
    """Build a SetSpeller from a plain newline-delimited word list."""
    with open(path, "r") as fh:
        return SetSpeller(w.strip() for w in fh if w.strip())


def default_speller():
    """Load the bundled, affix-expanded en_US word list (data/en_US.txt).

    Falls back to an empty speller (everything flagged) if the bundled list is
    missing, so a broken install is obvious rather than silently passing.
    """
    path = os.path.join(os.path.dirname(__file__), "data", "en_US.txt")
    return load_word_list(path) if os.path.exists(path) else SetSpeller([])


def check_spelling(words, spell_instance, custom_dictionary=None, ignore=None):
    """Port of src/spellChecker.js checkSpelling."""
    custom_set = set(w.lower() for w in (custom_dictionary or []))
    ignore_set = set(w.lower() for w in (ignore or []))
    issues = []
    for w in words:
        clean = re.sub(r"[^A-Za-z'-]", "", w["text"])
        if not clean or not re.search(r"[A-Za-z]", clean):
            continue
        lower = clean.lower()
        if lower in custom_set or lower in ignore_set:
            continue
        if not spell_instance.correct(clean):
            issues.append({
                "category": "spelling", "severity": "warn", "ruleId": "spelling",
                "foundText": w["text"], "page": w["page"],
                "message": 'Possible misspelling: "%s"' % w["text"],
            })
    return issues


def words_of(pages):
    """Flatten pages into the {text, page} word list checkSpelling expects."""
    out = []
    for p in pages:
        for it in p["items"]:
            for token in re.split(r"\s+", it["text"]):
                if token:
                    out.append({"text": token, "page": p["pageNumber"]})
    return out
