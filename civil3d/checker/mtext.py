# -*- coding: utf-8 -*-
"""Strip AutoCAD MText inline formatting codes to plain text.

MText contents look like "{\\fArial|b0|i0;REFER TO \\LDETAIL\\l 5}\\PLINE 2"
— fonts, heights, colors, stacking and paragraph codes mixed into the
string. The checker needs the words only.
"""
import re

# \f...; \H...; \C...; etc. — a backslash code with parameters up to ';'
_PARAM_CODE_RE = re.compile(r'\\[ACcFfHhQTWw][^;]*;')
# single-character codes: \L \l \O \o \K \k \X and soft hyphen-ish codes
_SINGLE_CODE_RE = re.compile(r'\\[LlOoKkX]')
# stacked fractions: \S1/2; -> 1/2
_STACK_RE = re.compile(r'\\S([^;]*);')


def strip_mtext(text):
    if not text:
        return ''
    out = text
    out = out.replace('\\\\', '\x00')          # protect literal backslashes
    out = out.replace('\\{', '\x01').replace('\\}', '\x02')
    out = _STACK_RE.sub(lambda m: m.group(1).replace('^', ' ').replace('#', '/'), out)
    out = _PARAM_CODE_RE.sub('', out)
    out = _SINGLE_CODE_RE.sub('', out)
    out = out.replace('\\P', '\n').replace('\\p', '\n')  # paragraph breaks
    out = out.replace('\\~', ' ')               # non-breaking space
    out = out.replace('\\A0;', '').replace('\\A1;', '').replace('\\A2;', '')
    out = out.replace('{', '').replace('}', '')
    out = out.replace('\x00', '\\').replace('\x01', '{').replace('\x02', '}')
    return out
