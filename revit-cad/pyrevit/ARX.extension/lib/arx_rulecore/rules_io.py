"""Load / normalise the shared ``arx-rules.json`` rule set.

The same JSON drives the PDF tool, this Revit extension and a future CAD add-in.
Authors may write friendly title-block / revision rules using ``example`` +
``variable`` (and optional ``exact``); ``normalize_rules`` compiles those into the
anchored ``pattern`` the evaluator consumes, via the shared pattern builder.
"""

import json
import os

from .pattern_builder import build_pattern

_EXAMPLE_CATEGORIES = ("titleBlock", "revision")


def normalize_rules(config):
    """Return a copy of ``config`` with example/variable rules compiled to patterns."""
    cfg = json.loads(json.dumps(config))  # deep copy
    cfg.setdefault("project", [])
    cfg.setdefault("rules", [])
    cfg.setdefault("titleBlockRegion", {"corner": "bottom-right", "widthPct": 40, "heightPct": 35})

    for rule in cfg["rules"]:
        rule.setdefault("enabled", True)
        if rule.get("category") in _EXAMPLE_CATEGORIES and "pattern" not in rule and rule.get("example"):
            built = build_pattern(rule["example"], rule.get("variable", ""), rule.get("exact", False))
            if built.get("error"):
                raise ValueError('Rule "%s": %s' % (rule.get("id", "?"), built["error"]))
            rule["pattern"] = built["valid"]
            rule["_locate"] = built["locate"]
            rule["_explanation"] = built["explanation"]
    return cfg


def resolve_rules_path(start_dir):
    """Search ``start_dir`` and up to 5 parents for an ``arx-rules.json``.

    Lets a button script find a config bundled next to it OR at the extension
    root, so a packaged install works with no prompt. Returns None if not found.
    """
    d = os.path.abspath(start_dir)
    for _ in range(6):
        candidate = os.path.join(d, "arx-rules.json")
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def load_rules(path):
    with open(path, "r") as fh:
        return normalize_rules(json.load(fh))


def save_rules(config, path):
    with open(path, "w") as fh:
        json.dump(config, fh, indent=2)
