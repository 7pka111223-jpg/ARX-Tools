# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401
from drawingchecker import rules_store
from drawingchecker.rules_form import (
    form_to_rules,
    grid_to_rules,
    parse_word_list,
    rules_to_form,
    rules_to_grid,
)


class RulesToFormTests(unittest.TestCase):
    def test_defaults_round_trip_to_form(self):
        form = rules_to_form(rules_store.default_rules())
        self.assertEqual(form['dwgNoPattern'], '^[A-Z]{2}-\\d{3}$')
        self.assertEqual(form['projectName'], '')
        self.assertEqual(form['sheetNamePattern'], '')
        self.assertEqual(form['revisionEnabled'],
                         {'rev': True, 'date': True, 'drawnBy': True,
                          'checkedBy': True, 'approvedBy': True})
        self.assertEqual(form['customWords'], '')


class FormToRulesTests(unittest.TestCase):
    def setUp(self):
        self.rules = rules_store.default_rules()
        self.form = rules_to_form(self.rules)

    def test_edits_applied(self):
        self.form.update({
            'projectName': 'ARX TOWER',
            'dwgNoPattern': '^S\\d{3}$',
            'sheetNamePattern': '^[A-Z ]+$',
            'customWords': 'setout\nupstand, galv',
        })
        self.form['revisionEnabled']['approvedBy'] = False
        updated = form_to_rules(self.rules, self.form)

        self.assertEqual(updated['project'][0]['value'], 'ARX TOWER')
        dwg = [r for r in updated['rules'] if r['id'] == 'dwgNo'][0]
        self.assertEqual(dwg['pattern'], '^S\\d{3}$')
        self.assertEqual(updated['revit']['sheetNamePattern'], '^[A-Z ]+$')
        approved = [r for r in updated['rules'] if r['id'] == 'approvedBy'][0]
        self.assertFalse(approved['enabled'])
        self.assertEqual(updated['spelling']['customDictionary'],
                         ['setout', 'upstand', 'galv'])

    def test_blank_patterns_become_none(self):
        self.form['dwgNoPattern'] = ''
        self.form['viewNamePattern'] = '  '
        updated = form_to_rules(self.rules, self.form)
        dwg = [r for r in updated['rules'] if r['id'] == 'dwgNo'][0]
        self.assertIsNone(dwg['pattern'])
        self.assertIsNone(updated['revit']['viewNamePattern'])

    def test_invalid_regex_raises_and_leaves_input_untouched(self):
        self.form['dwgNoPattern'] = '['
        with self.assertRaises(ValueError):
            form_to_rules(self.rules, self.form)
        original_dwg = [r for r in self.rules['rules'] if r['id'] == 'dwgNo'][0]
        self.assertEqual(original_dwg['pattern'], '^[A-Z]{2}-\\d{3}$')

    def test_result_still_loads_as_valid_rules(self):
        self.form['projectNumber'] = 'P-100'
        updated = form_to_rules(self.rules, self.form)
        rules_store.load_rules(rules_store.dumps_rules(updated))


class RulesGridTests(unittest.TestCase):
    def setUp(self):
        self.rules = rules_store.default_rules()

    def test_grid_round_trips_defaults(self):
        rows = rules_to_grid(self.rules)
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[0]['id'], 'dwgNo')
        self.assertTrue(rows[0]['enabled'])
        rebuilt = grid_to_rules(self.rules, rows)
        self.assertEqual(rebuilt['rules'], self.rules['rules'])

    def test_edit_add_and_delete_rules(self):
        rows = rules_to_grid(self.rules)
        rows[0]['pattern'] = '^S\\d{3}$'          # edit dwgNo
        rows = [r for r in rows if r['id'] != 'approvedBy']  # delete
        rows.append({'enabled': True, 'id': 'scale', 'category': 'titleBlock',
                     'label': 'SCALE', 'pattern': '^1:\\d+$', 'find': '', 'valid': '',
                     'severity': 'warn', 'message': 'Scale must look like 1:100'})
        rebuilt = grid_to_rules(self.rules, rows)
        ids = [r['id'] for r in rebuilt['rules']]
        self.assertIn('scale', ids)
        self.assertNotIn('approvedBy', ids)
        dwg = [r for r in rebuilt['rules'] if r['id'] == 'dwgNo'][0]
        self.assertEqual(dwg['pattern'], '^S\\d{3}$')
        rules_store.load_rules(rules_store.dumps_rules(rebuilt))  # still valid

    def test_blank_rows_skipped(self):
        rows = rules_to_grid(self.rules)
        rows.append({'enabled': False, 'id': '', 'category': '', 'label': '',
                     'pattern': '', 'find': '', 'valid': '', 'severity': '', 'message': ''})
        rebuilt = grid_to_rules(self.rules, rows)
        self.assertEqual(len(rebuilt['rules']), 7)

    def test_duplicate_id_rejected(self):
        rows = rules_to_grid(self.rules)
        rows.append(dict(rows[0]))
        with self.assertRaises(ValueError):
            grid_to_rules(self.rules, rows)

    def test_bad_category_and_severity_rejected(self):
        rows = rules_to_grid(self.rules)
        rows[0]['category'] = 'naming'
        with self.assertRaises(ValueError):
            grid_to_rules(self.rules, rows)
        rows = rules_to_grid(self.rules)
        rows[0]['severity'] = 'fatal'
        with self.assertRaises(ValueError):
            grid_to_rules(self.rules, rows)

    def test_formatting_rule_requires_find_and_valid(self):
        rows = rules_to_grid(self.rules)
        iso = [r for r in rows if r['id'] == 'isoDate'][0]
        iso['valid'] = ''
        with self.assertRaises(ValueError):
            grid_to_rules(self.rules, rows)

    def test_invalid_regex_rejected(self):
        rows = rules_to_grid(self.rules)
        rows[0]['pattern'] = '['
        with self.assertRaises(ValueError):
            grid_to_rules(self.rules, rows)


class ParseWordListTests(unittest.TestCase):
    def test_splits_and_dedupes(self):
        self.assertEqual(parse_word_list('a\nb, c; a\r\n  d  '), ['a', 'b', 'c', 'd'])

    def test_empty(self):
        self.assertEqual(parse_word_list(''), [])
        self.assertEqual(parse_word_list(None), [])


if __name__ == '__main__':
    unittest.main()
