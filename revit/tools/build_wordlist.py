#!/usr/bin/env python3
"""Regenerate drawingchecker/data/words_en.txt from the repo's dictionary-en package.

Expands the hunspell dictionary (node_modules/dictionary-en/index.aff/.dic) —
the exact dictionary the web Drawing Checker bundles via nspell — into a plain
lowercase wordlist, so both tools share the same vocabulary.

Usage (from the repo root, after `npm install`):

    pip install spylls
    python3 revit/tools/build_wordlist.py
"""

import os
import re

from spylls.hunspell.dictionary import Dictionary

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIC_PREFIX = os.path.join(REPO_ROOT, 'node_modules', 'dictionary-en', 'index')
OUT_PATH = os.path.join(
    REPO_ROOT, 'revit', 'DrawingChecker.extension', 'lib', 'drawingchecker', 'data', 'words_en.txt'
)

WORD_RE = re.compile(r"^[a-z][a-z']*$")


def unmunch(word, aff):
    """Expand one dictionary stem into all affixed forms (spylls unmunch recipe)."""
    result = set()
    if aff.FORBIDDENWORD and aff.FORBIDDENWORD in word.flags:
        return result
    if not (aff.NEEDAFFIX and aff.NEEDAFFIX in word.flags):
        result.add(word.stem)

    suffixes = [
        suffix
        for flag in word.flags
        for suffix in aff.SFX.get(flag, [])
        if suffix.cond_regexp.search(word.stem)
    ]
    prefixes = [
        prefix
        for flag in word.flags
        for prefix in aff.PFX.get(flag, [])
        if prefix.cond_regexp.search(word.stem)
    ]

    for suffix in suffixes:
        root = word.stem[0:-len(suffix.strip)] if suffix.strip else word.stem
        suffixed = root + suffix.add
        result.add(suffixed)
        if suffix.crossproduct:
            for prefix in prefixes:
                if prefix.crossproduct:
                    result.add(prefix.add + suffixed[len(prefix.strip):])
    for prefix in prefixes:
        root = word.stem[len(prefix.strip):]
        prefixed = prefix.add + root
        result.add(prefixed)
        if prefix.crossproduct:
            for suffix in suffixes:
                if suffix.crossproduct:
                    base = prefixed[0:-len(suffix.strip)] if suffix.strip else prefixed
                    result.add(base + suffix.add)
    return result


def main():
    dictionary = Dictionary.from_files(DIC_PREFIX)
    words = set()
    for word in dictionary.dic.words:
        for form in unmunch(word, dictionary.aff):
            lowered = form.lower()
            if WORD_RE.match(lowered):
                words.add(lowered)

    with open(OUT_PATH, 'w', encoding='utf-8', newline='\n') as fh:
        for w in sorted(words):
            fh.write(w + '\n')
    print('wrote %d words to %s' % (len(words), OUT_PATH))


if __name__ == '__main__':
    main()
