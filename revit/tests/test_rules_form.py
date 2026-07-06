# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401
from drawingchecker import rules_store
from drawingchecker.rules_form import form_to_rules, parse_word_list, rules_to_form


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


class ParseWordListTests(unittest.TestCase):
    def test_splits_and_dedupes(self):
        self.assertEqual(parse_word_list('a\nb, c; a\r\n  d  '), ['a', 'b', 'c', 'd'])

    def test_empty(self):
        self.assertEqual(parse_word_list(''), [])
        self.assertEqual(parse_word_list(None), [])


if __name__ == '__main__':
    unittest.main()
