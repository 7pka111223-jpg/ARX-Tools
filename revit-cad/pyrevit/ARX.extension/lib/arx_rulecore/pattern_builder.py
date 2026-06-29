"""Turn "an example value + the part that varies" into a regex.

Faithful port of the Rule Check tool's buildPattern (and its toRuns /
runToPattern / runToLoose helpers). Producing byte-identical patterns to the
PDF/JS tool is what lets a rule set authored once run unchanged in PDF, Revit
and CAD.
"""

from .util import escape_regex

RUN_CLASS_LABEL = {"digit": "digit", "upper": "uppercase letter", "lower": "lowercase letter"}


def classify_ch(ch):
    if "0" <= ch <= "9":
        return "digit"
    if "A" <= ch <= "Z":
        return "upper"
    if "a" <= ch <= "z":
        return "lower"
    return "literal"


def to_runs(text):
    """Group consecutive characters of the same class into runs."""
    runs = []
    for ch in text:
        cls = classify_ch(ch)
        if runs and runs[-1]["cls"] == cls:
            runs[-1]["text"] += ch
        else:
            runs.append({"cls": cls, "text": ch})
    return runs


def run_to_pattern(run):
    """Exact-length class token: e.g. a 3-digit run -> \\d{3}."""
    if run["cls"] == "literal":
        return escape_regex(run["text"])
    cls = {"digit": "\\d", "upper": "[A-Z]", "lower": "[a-z]"}[run["cls"]]
    return cls if len(run["text"]) == 1 else "%s{%d}" % (cls, len(run["text"]))


def run_to_loose(run):
    """Any-length class token, used by the looser locator: e.g. \\d+."""
    if run["cls"] == "literal":
        return escape_regex(run["text"])
    return {"digit": "\\d+", "upper": "[A-Z]+", "lower": "[a-z]+"}[run["cls"]]


def run_to_desc(run):
    if run["cls"] == "literal":
        return 'the text "%s"' % run["text"]
    n = len(run["text"])
    return "%d %s%s" % (n, RUN_CLASS_LABEL[run["cls"]], "" if n == 1 else "s")


def build_pattern(example, variable_part, exact=False):
    """Return {valid, locate, explanation, warning, error} (port of buildPattern).

    - ``valid``  is anchored (^...$) and used to validate a captured field value.
    - ``locate`` is bounded by non-word lookarounds and is intentionally looser
      (same class skeleton, any lengths) so malformed instances are still found.
    """
    if not example:
        return {"error": "Enter an example value first."}

    if exact:
        valid = "^%s$" % escape_regex(example)
        locate = "(?<![A-Za-z0-9])%s(?![A-Za-z0-9])" % escape_regex(example)
        return {"valid": valid, "locate": locate,
                "explanation": 'Will match exactly: "%s"' % example,
                "warning": None, "error": None}

    if not variable_part:
        return {"error": 'Enter the part of the example that changes — '
                         'or set "exact" to true.'}

    index = example.find(variable_part)
    if index == -1:
        return {"error": '"%s" was not found inside the example value.' % variable_part}

    warning = None
    if example.find(variable_part, index + 1) != -1:
        warning = ('"%s" appears more than once in the example — the first '
                   "occurrence was used." % variable_part)

    prefix = example[:index]
    suffix = example[index + len(variable_part):]
    runs = to_runs(variable_part)

    valid = "^%s%s%s$" % (escape_regex(prefix),
                          "".join(run_to_pattern(r) for r in runs),
                          escape_regex(suffix))
    locate = "(?<![A-Za-z0-9])%s%s%s(?![A-Za-z0-9])" % (
        escape_regex(prefix),
        "".join(run_to_loose(r) for r in runs),
        escape_regex(suffix),
    )

    parts = []
    if prefix:
        parts.append('the text "%s"' % prefix)
    parts.extend(run_to_desc(r) for r in runs)
    if suffix:
        parts.append('the text "%s"' % suffix)

    return {"valid": valid, "locate": locate,
            "explanation": "Will match: " + " + ".join(parts),
            "warning": warning, "error": None}
