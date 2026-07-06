# -*- coding: utf-8 -*-
import io
import json
import unittest

from . import _path  # noqa: F401
from drawingchecker import rules_store
from drawingchecker.config_locator import BUNDLED_DEFAULT_RULES_PATH


class LoadRulesTests(unittest.TestCase):
    def test_defaults_are_valid(self):
        rules = rules_store.load_rules(rules_store.default_rules())
        self.assertEqual(len(rules['rules']), 7)
        self.assertIn('revit', rules)

    def test_load_from_json_text(self):
        rules = rules_store.load_rules(json.dumps(rules_store.DEFAULT_RULES))
        self.assertEqual(rules['rules'][0]['id'], 'dwgNo')

    def test_missing_top_level_key_raises(self):
        broken = rules_store.default_rules()
        del broken['spelling']
        with self.assertRaises(ValueError):
            rules_store.load_rules(broken)

    def test_rules_must_be_a_list(self):
        broken = rules_store.default_rules()
        broken['rules'] = {}
        with self.assertRaises(ValueError):
            rules_store.load_rules(broken)

    def test_invalid_severity_raises(self):
        broken = rules_store.default_rules()
        broken['rules'][0]['severity'] = 'fatal'
        with self.assertRaises(ValueError):
            rules_store.load_rules(broken)

    def test_invalid_regex_raises(self):
        broken = rules_store.default_rules()
        broken['rules'][0]['pattern'] = '['
        with self.assertRaises(ValueError):
            rules_store.load_rules(broken)

    def test_missing_revit_block_filled_with_defaults(self):
        minimal = rules_store.default_rules()
        del minimal['revit']
        rules = rules_store.load_rules(minimal)
        self.assertEqual(rules['revit'], rules_store.DEFAULT_REVIT_SETTINGS)

    def test_partial_revit_block_merged_with_defaults(self):
        partial = rules_store.default_rules()
        partial['revit'] = {'sheetNamePattern': '^[A-Z ]+$'}
        rules = rules_store.load_rules(partial)
        self.assertEqual(rules['revit']['sheetNamePattern'], '^[A-Z ]+$')
        self.assertEqual(rules['revit']['paramMap'], {})

    def test_load_does_not_mutate_input(self):
        source = rules_store.default_rules()
        del source['revit']
        rules_store.load_rules(source)
        self.assertNotIn('revit', source)

    def test_bundled_default_rules_file_matches_python_defaults(self):
        with io.open(BUNDLED_DEFAULT_RULES_PATH, 'r', encoding='utf-8') as fh:
            bundled = rules_store.load_rules(fh.read())
        self.assertEqual(bundled, rules_store.load_rules(rules_store.default_rules()))


class ValidateRuleTests(unittest.TestCase):
    def test_valid_rule_passes(self):
        rules_store.validate_rule(
            {'id': 'x', 'severity': 'warn', 'pattern': '^A$', 'find': 'a', 'valid': 'b'}
        )

    def test_bad_find_regex_raises(self):
        with self.assertRaises(ValueError):
            rules_store.validate_rule({'id': 'x', 'severity': 'warn', 'find': '(unclosed'})


if __name__ == '__main__':
    unittest.main()
