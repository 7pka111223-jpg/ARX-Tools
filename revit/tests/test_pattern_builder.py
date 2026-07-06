# -*- coding: utf-8 -*-
import re
import unittest

from . import _path  # noqa: F401
from drawingchecker.pattern_builder import (
    generalize_part,
    parse_variable_parts,
    pattern_from_example,
)


def matches(pattern, value):
    return re.search(pattern, value) is not None


class PatternFromExampleTests(unittest.TestCase):
    def test_the_readme_case_aa_001(self):
        pattern = pattern_from_example('AA-001', '001')
        self.assertTrue(matches(pattern, 'AA-001'))
        self.assertTrue(matches(pattern, 'AA-999'))
        self.assertFalse(matches(pattern, 'AA-99'))      # wrong length
        self.assertFalse(matches(pattern, 'AB-123'))     # fixed part changed
        self.assertFalse(matches(pattern, 'XAA-123'))    # anchored
        self.assertFalse(matches(pattern, 'AA-1234'))

    def test_multiple_variable_parts(self):
        pattern = pattern_from_example('AA-001', 'AA, 001')
        self.assertTrue(matches(pattern, 'ZX-999'))
        self.assertFalse(matches(pattern, 'Z9-999'))     # letters stay letters
        self.assertFalse(matches(pattern, 'ZX_999'))     # separator is fixed

    def test_mixed_variable_part(self):
        pattern = pattern_from_example('S100 - LEVEL 1', 'S100')
        self.assertTrue(matches(pattern, 'A205 - LEVEL 1'))
        self.assertFalse(matches(pattern, 'A205 - LEVEL 2'))

    def test_no_variable_parts_is_exact_match(self):
        pattern = pattern_from_example('COVER SHEET', '')
        self.assertTrue(matches(pattern, 'COVER SHEET'))
        self.assertFalse(matches(pattern, 'COVER SHEETS'))

    def test_repeated_variable_part_generalizes_all_occurrences(self):
        pattern = pattern_from_example('01-01', '01')
        self.assertTrue(matches(pattern, '12-34'))
        self.assertFalse(matches(pattern, '12-3'))

    def test_special_characters_in_fixed_text_are_literal(self):
        pattern = pattern_from_example('AR(1).001', '001')
        self.assertTrue(matches(pattern, 'AR(1).500'))
        self.assertFalse(matches(pattern, 'AR11X500'))   # ( ) . stay literal

    def test_missing_example_raises(self):
        with self.assertRaises(ValueError):
            pattern_from_example('', '001')

    def test_part_not_in_example_raises(self):
        with self.assertRaises(ValueError):
            pattern_from_example('AA-001', '999')

    def test_overlapping_parts_raise(self):
        with self.assertRaises(ValueError):
            pattern_from_example('AA-001', 'A-0, -00')

    def test_result_compiles(self):
        re.compile(pattern_from_example('P-2026-AR-DWG-0001', '2026, AR, 0001'))


class GeneralizePartTests(unittest.TestCase):
    def test_runs_are_counted(self):
        self.assertEqual(generalize_part('001'), '\\d{3}')
        self.assertEqual(generalize_part('AA'), '[A-Z]{2}')
        self.assertEqual(generalize_part('S1'), '[A-Z]\\d')
        self.assertEqual(generalize_part('ab12'), '[a-z]{2}\\d{2}')


class ParseVariablePartsTests(unittest.TestCase):
    def test_splits_and_dedupes(self):
        self.assertEqual(parse_variable_parts('001, AA; 001'), ['001', 'AA'])
        self.assertEqual(parse_variable_parts(''), [])


if __name__ == '__main__':
    unittest.main()
