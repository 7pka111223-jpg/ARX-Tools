"""Rule evaluation — faithful port of src/rulesEngine.js.

Operates on the abstract page model only, so the exact same logic runs against
PDF (JS), Revit and CAD. Every function returns a list of issue dicts shaped
like the PDF tool's issues.
"""

import re

from .title_block import locate_fields_on_page
from .util import escape_regex


def evaluate_field_rules(pages, field_rules, region):
    issues = []
    for p in pages:
        fields = locate_fields_on_page(p, field_rules, region)
        for rule in field_rules:
            result = fields[rule["id"]]
            if not result["found"]:
                issues.append({
                    "category": rule["category"], "severity": rule["severity"],
                    "ruleId": rule["id"], "foundText": None, "page": p["pageNumber"],
                    "message": 'Missing required field "%s"' % rule["label"],
                })
            elif rule.get("pattern") and not result["valid"]:
                issues.append({
                    "category": rule["category"], "severity": rule["severity"],
                    "ruleId": rule["id"], "foundText": result["value"], "page": p["pageNumber"],
                    "message": 'Field "%s" value "%s" does not match expected format'
                               % (rule["label"], result["value"]),
                })
    return issues


def evaluate_formatting_rules(pages, formatting_rules):
    issues = []
    for rule in formatting_rules:
        if not rule.get("enabled"):
            continue
        find_re = re.compile(rule["find"])
        valid_re = re.compile(rule["valid"])
        for p in pages:
            text = " ".join(it["text"] for it in p["items"])
            for match in find_re.finditer(text):
                hit = match.group(0)
                if not valid_re.search(hit):
                    issues.append({
                        "category": "formatting", "severity": rule.get("severity", "warn"),
                        "ruleId": rule["id"], "foundText": hit, "page": p["pageNumber"],
                        "message": rule["message"],
                    })
    return issues


def evaluate_project_rules(pages, project_fields, region):
    if not pages:
        return []
    first_page = pages[0]
    required_fields = [
        {"id": f["id"], "category": "project", "label": f["label"],
         "pattern": "^%s$" % escape_regex(f["value"])}
        for f in project_fields if f.get("value")
    ]
    if not required_fields:
        return []

    fields = locate_fields_on_page(first_page, required_fields, region)
    issues = []
    for f in required_fields:
        result = fields[f["id"]]
        if not result["found"] or not result["valid"]:
            original = next(pf for pf in project_fields if pf["id"] == f["id"])
            issues.append({
                "category": "project", "severity": "error", "ruleId": f["id"],
                "foundText": result["value"], "page": first_page["pageNumber"],
                "message": 'Project field "%s" expected "%s" but found "%s"'
                           % (f["label"], original["value"], result["value"] or "(missing)"),
            })
    return issues


def evaluate_rules(pages, rules_config):
    region = rules_config["titleBlockRegion"]
    enabled = [r for r in rules_config["rules"] if r.get("enabled")]
    title_block_rules = [r for r in enabled if r["category"] == "titleBlock"]
    revision_rules = [r for r in enabled if r["category"] == "revision"]
    formatting_rules = [r for r in enabled if r["category"] == "formatting"]

    return (
        evaluate_project_rules(pages, rules_config.get("project", []), region)
        + evaluate_field_rules(pages, title_block_rules, region)
        + evaluate_field_rules(pages, revision_rules, region)
        + evaluate_formatting_rules(pages, formatting_rules)
    )
