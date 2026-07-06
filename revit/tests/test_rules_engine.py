# -*- coding: utf-8 -*-
import io
import json
import os
import unittest

from . import _path
from drawingchecker import rules_store
from drawingchecker.rules_engine import (
    collect_param_entries,
    collect_text_entries,
    evaluate_rules,
)


def load_fixture(name):
    with io.open(os.path.join(_path.FIXTURES_DIR, name), 'r', encoding='utf-8') as fh:
        return json.load(fh)


def load_sample_rules():
    with io.open(os.path.join(_path.FIXTURES_DIR, 'rules_sample.json'), 'r', encoding='utf-8') as fh:
        return rules_store.load_rules(fh.read())


def by_rule(issues, rule_id):
    return [i for i in issues if i['ruleId'] == rule_id]


class EvaluateRulesCleanModelTests(unittest.TestCase):
    def test_clean_snapshot_yields_no_issues(self):
        issues = evaluate_rules(load_fixture('snapshot_ok.json'), load_sample_rules())
        self.assertEqual(issues, [])


class EvaluateRulesBrokenModelTests(unittest.TestCase):
    def setUp(self):
        self.issues = evaluate_rules(load_fixture('snapshot_issues.json'), load_sample_rules())

    def test_wrong_project_number_is_an_error(self):
        found = by_rule(self.issues, 'number')
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['severity'], 'error')
        self.assertEqual(found[0]['category'], 'project')
        self.assertEqual(found[0]['foundText'], 'P-999')
        self.assertIn('expected "P-100"', found[0]['message'])

    def test_missing_client_reports_missing(self):
        found = by_rule(self.issues, 'client')
        self.assertEqual(len(found), 1)
        self.assertIn('(missing)', found[0]['message'])

    def test_bad_sheet_number_format_is_an_error(self):
        found = by_rule(self.issues, 'dwgNo')
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['severity'], 'error')
        self.assertEqual(found[0]['foundText'], 'A101')
        self.assertEqual(found[0]['page'], 'A101')
        self.assertEqual(found[0]['elementId'], 1001)

    def test_empty_checked_by_is_missing_field(self):
        found = by_rule(self.issues, 'checkedBy')
        self.assertEqual(len(found), 1)
        self.assertIn('Missing required field "CHECKED BY"', found[0]['message'])

    def test_unresolvable_parameter_is_a_distinct_warn(self):
        found = by_rule(self.issues, 'approvedBy')
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['severity'], 'warn')
        self.assertIn('not found on sheet', found[0]['message'])

    def test_sheet_view_and_schedule_naming_conventions(self):
        self.assertEqual(by_rule(self.issues, 'sheetName')[0]['foundText'], 'Ground floor plan')
        self.assertEqual(by_rule(self.issues, 'viewName')[0]['foundText'], 'level 1')
        self.assertEqual(by_rule(self.issues, 'scheduleName')[0]['foundText'], 'Door List')
        for rule_id in ('sheetName', 'viewName', 'scheduleName'):
            self.assertEqual(by_rule(self.issues, rule_id)[0]['category'], 'naming')

    def test_non_iso_dates_flagged_in_param_and_text_note(self):
        found = by_rule(self.issues, 'isoDate')
        self.assertEqual(sorted(i['foundText'] for i in found), ['07/01/2026', '12/31/2025'])
        for issue in found:
            self.assertEqual(issue['severity'], 'warn')
            self.assertEqual(issue['page'], 'A101')

    def test_no_spelling_issues_from_rules_engine(self):
        # spelling is a separate pass (spell_checker), not a rules-engine concern
        self.assertEqual(by_rule(self.issues, 'spelling'), [])


class BadPatternTests(unittest.TestCase):
    def test_invalid_user_pattern_degrades_to_config_warn(self):
        rules = load_sample_rules()
        # (?<name>) is JS-flavoured named-group syntax that Python rejects
        rules['revit']['viewNamePattern'] = '(?<bad>x)'
        issues = evaluate_rules(load_fixture('snapshot_ok.json'), rules)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]['category'], 'config')
        self.assertEqual(issues[0]['severity'], 'warn')
        self.assertIn('rule skipped', issues[0]['message'])


class CollectEntriesTests(unittest.TestCase):
    def test_collects_all_text_sources_with_context(self):
        entries = collect_text_entries(load_fixture('snapshot_ok.json'))
        contexts = [e['context'] for e in entries]
        self.assertIn('sheet name', contexts)
        self.assertIn('text note on sheet', contexts)
        self.assertIn('view name', contexts)
        self.assertIn('text note in view "LEVEL 1 - GROUND FLOOR"', contexts)
        self.assertIn('schedule name', contexts)
        self.assertTrue(all(e['page'] in ('AR-101', 'AR-102') for e in entries))

    def test_param_entries_carry_sheet_page(self):
        entries = collect_param_entries(load_fixture('snapshot_issues.json'))
        self.assertTrue(any(e['text'] == '07/01/2026' for e in entries))
        self.assertTrue(all(e['page'] == 'A101' for e in entries))


if __name__ == '__main__':
    unittest.main()
