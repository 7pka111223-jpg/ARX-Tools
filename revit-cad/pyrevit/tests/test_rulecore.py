"""Unit tests for the shared rule core. Pure Python — no Revit required.

Run from revit-cad/pyrevit:
    PYTHONPATH=ARX.extension/lib python3 -m unittest discover -s tests -v
"""

import unittest

from arx_rulecore import (
    build_pattern, to_runs, escape_regex,
    locate_fields_on_page, evaluate_rules,
    check_spelling, words_of, SetSpeller, normalize_rules,
    issues_to_csv,
)


REGION = {"corner": "bottom-right", "widthPct": 100, "heightPct": 100}


def page(items, num=1, w=100.0, h=100.0):
    return {"pageNumber": num, "width": w, "height": h, "items": items}


def item(text, x=50.0, y=50.0):
    return {"text": text, "x": x, "y": y}


class PatternBuilderTests(unittest.TestCase):
    def test_escape_regex_matches_js(self):
        self.assertEqual(escape_regex("A-1.0(x)"), "A\\-1\\.0\\(x\\)")

    def test_runs_group_by_class(self):
        runs = to_runs("AB12c")
        self.assertEqual([(r["cls"], r["text"]) for r in runs],
                         [("upper", "AB"), ("digit", "12"), ("lower", "c")])

    def test_pattern_from_example_and_variable(self):
        b = build_pattern("J2501-JPD-EBH-DG-20100", "20100", False)
        self.assertIsNone(b["error"])
        self.assertEqual(b["valid"], "^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$")
        # loose locator uses + quantifiers and word-boundary lookarounds
        self.assertIn("\\d+", b["locate"])

    def test_exact_mode(self):
        # Spaces are not regex-special, so (like the JS escRe) they are not escaped.
        b = build_pattern("REV A", None, True)
        self.assertEqual(b["valid"], "^REV A$")

    def test_variable_not_found_is_error(self):
        b = build_pattern("ABC", "ZZ", False)
        self.assertIn("was not found", b["error"])

    def test_duplicate_variable_warns(self):
        b = build_pattern("A1A1", "A1", False)
        self.assertIsNotNone(b["warning"])


class TitleBlockTests(unittest.TestCase):
    def test_same_item_label_value(self):
        f = locate_fields_on_page(
            page([item("DWG NO: A-100")]),
            [{"id": "d", "label": "DWG NO", "pattern": None}], REGION)
        self.assertEqual(f["d"]["value"], "A-100")
        self.assertTrue(f["d"]["found"])

    def test_label_only_then_next_item(self):
        f = locate_fields_on_page(
            page([item("DWG NO:", y=10), item("A-100", y=20)]),
            [{"id": "d", "label": "DWG NO", "pattern": None}], REGION)
        self.assertEqual(f["d"]["value"], "A-100")

    def test_label_only_does_not_capture_colon(self):
        # regression for the JS backtracking note
        f = locate_fields_on_page(
            page([item("REV:", y=10), item("B", y=20)]),
            [{"id": "r", "label": "REV", "pattern": None}], REGION)
        self.assertEqual(f["r"]["value"], "B")

    def test_pattern_validation(self):
        f = locate_fields_on_page(
            page([item("DWG NO: A-100")]),
            [{"id": "d", "label": "DWG NO", "pattern": "^[A-Z]-\\d{3}$"}], REGION)
        self.assertTrue(f["d"]["valid"])
        f2 = locate_fields_on_page(
            page([item("DWG NO: bad")]),
            [{"id": "d", "label": "DWG NO", "pattern": "^[A-Z]-\\d{3}$"}], REGION)
        self.assertFalse(f2["d"]["valid"])


class EvaluateRulesTests(unittest.TestCase):
    def _config(self):
        return normalize_rules({
            "titleBlockRegion": REGION,
            "project": [{"id": "proj", "label": "PROJECT", "value": "RIYADH"}],
            "rules": [
                {"id": "dwgno", "label": "DWG NO", "category": "titleBlock",
                 "severity": "error", "example": "A-100", "variable": "100"},
                {"id": "revfmt", "category": "formatting", "severity": "warn",
                 "find": "REV\\s*[A-Za-z]", "valid": "REV [A-Z]",
                 "message": "Revision should read 'REV X'"},
            ],
        })

    def test_clean_drawing_passes(self):
        pages = [page([item("PROJECT: RIYADH"), item("DWG NO: A-100"), item("REV B")])]
        self.assertEqual(evaluate_rules(pages, self._config()), [])

    def test_missing_field_and_bad_format_flagged(self):
        pages = [page([item("PROJECT: RIYADH"), item("DWG NO: A-XYZ"), item("REV b")])]
        issues = evaluate_rules(pages, self._config())
        cats = {i["ruleId"] for i in issues}
        self.assertIn("dwgno", cats)    # A-XYZ fails ^A-\d{3}$
        self.assertIn("revfmt", cats)   # "REV b" fails valid "REV [A-Z]"

    def test_wrong_project_flagged(self):
        pages = [page([item("PROJECT: DUBAI"), item("DWG NO: A-100"), item("REV B")])]
        issues = evaluate_rules(pages, self._config())
        self.assertTrue(any(i["ruleId"] == "proj" and i["severity"] == "error" for i in issues))


class SpellingTests(unittest.TestCase):
    def test_flags_misspelling_and_respects_custom(self):
        speller = SetSpeller(["concrete", "drawing", "the"])
        pages = [page([item("the concrete concret rebar")])]
        words = words_of(pages)
        issues = check_spelling(words, speller, custom_dictionary=["rebar"])
        found = {i["foundText"].lower() for i in issues}
        self.assertNotIn("concrete", found)
        self.assertNotIn("rebar", found)        # custom dictionary
        self.assertIn("concret", found)         # unknown word -> flagged

    def test_suggestions(self):
        speller = SetSpeller(["concrete", "drawing"])
        self.assertIn("concrete", speller.suggest("concrate"))


class ReportTests(unittest.TestCase):
    def test_csv_header_and_escaping(self):
        csv = issues_to_csv([{"page": 1, "severity": "warn", "category": "spelling",
                              "ruleId": "spelling", "foundText": 'a,b', "message": "x"}])
        self.assertTrue(csv.startswith("page,severity,category,ruleId,foundText,message"))
        self.assertIn('"a,b"', csv)


if __name__ == "__main__":
    unittest.main()
