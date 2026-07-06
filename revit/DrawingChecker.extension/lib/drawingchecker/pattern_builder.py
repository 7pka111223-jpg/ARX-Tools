# -*- coding: utf-8 -*-
"""Build a regex from an example value plus its variable parts.

"AA-001" with variable part "001" -> ^AA\\-\\d{3}$ : the fixed text is
matched literally, each variable part is generalized character by
character (digit -> \\d, uppercase -> [A-Z], lowercase -> [a-z]) with
run-length counts, so users never have to write a regex by hand.
"""
from __future__ import unicode_literals

import re
from itertools import groupby


def _class_token(char):
    if char.isdigit():
        return '\\d'
    if 'A' <= char <= 'Z':
        return '[A-Z]'
    if 'a' <= char <= 'z':
        return '[a-z]'
    return re.escape(char)


def generalize_part(part):
    """A variable part as a regex: 001 -> \\d{3}, S1 -> [A-Z]\\d."""
    tokens = [_class_token(c) for c in part]
    out = []
    for token, group in groupby(tokens):
        count = len(list(group))
        out.append(token if count == 1 else '%s{%d}' % (token, count))
    return ''.join(out)


def parse_variable_parts(text):
    parts = []
    for chunk in re.split(r'[,;\n\r]+', text or ''):
        part = chunk.strip()
        if part and part not in parts:
            parts.append(part)
    return parts


def pattern_from_example(example, variable_parts_text):
    """Regex for values shaped like `example`, where each listed variable
    part may change (digits stay digits, letters stay letters, same
    lengths) and everything else must match exactly.

    Raises ValueError with a user-readable message on bad input.
    """
    example = (example or '').strip()
    if not example:
        raise ValueError('Type an example value first (e.g. AA-001).')

    spans = []
    for part in parse_variable_parts(variable_parts_text):
        if part not in example:
            raise ValueError('"%s" is not part of the example "%s".' % (part, example))
        start = 0
        while True:
            index = example.find(part, start)
            if index < 0:
                break
            spans.append((index, index + len(part), part))
            start = index + len(part)

    spans.sort()
    previous_end = -1
    for start, end, part in spans:
        if start < previous_end:
            raise ValueError('Variable parts overlap in the example — list each part once.')
        previous_end = end

    pattern = '^'
    position = 0
    for start, end, part in spans:
        pattern += re.escape(example[position:start])
        pattern += generalize_part(part)
        position = end
    pattern += re.escape(example[position:]) + '$'
    return pattern
