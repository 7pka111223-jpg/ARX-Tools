# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401
from drawingchecker.text_search import (
    build_replacements,
    build_transform,
    find_matches,
    is_editable_entry,
    parse_pairs_csv,
    replace_text,
)


def note(text, element_id=1, page='AR-101', context='text note on sheet'):
    return {'text': text, 'elementId': element_id, 'page': page, 'context': context}


ENTRIES = [
    note('REFER TO DETALE 5'),
    note('DETALE AND detale', element_id=2, context='text note in view "L1"'),
    {'text': 'DETALE PLAN', 'elementId': 3, 'page': 'AR-101', 'context': 'view name'},
]


class FindMatchesTests(unittest.TestCase):
    def test_finds_only_editable_text_notes(self):
        matches = find_matches(ENTRIES, 'DETALE')
        self.assertEqual([m['entry']['elementId'] for m in matches], [1, 2])

    def test_case_insensitive_by_default(self):
        self.assertEqual(find_matches(ENTRIES, 'detale')[1]['count'], 2)

    def test_match_case(self):
        matches = find_matches(ENTRIES, 'DETALE', match_case=True)
        self.assertEqual([m['count'] for m in matches], [1, 1])

    def test_empty_find_returns_nothing(self):
        self.assertEqual(find_matches(ENTRIES, ''), [])

    def test_view_names_are_not_editable(self):
        self.assertFalse(is_editable_entry(ENTRIES[2]))


class ReplaceTextTests(unittest.TestCase):
    def test_case_insensitive_replaces_all_variants(self):
        self.assertEqual(
            replace_text('DETALE and detale', 'detale', 'DETAIL'),
            'DETAIL and DETAIL',
        )

    def test_match_case_only_replaces_exact(self):
        self.assertEqual(
            replace_text('DETALE and detale', 'detale', 'DETAIL', match_case=True),
            'DETALE and DETAIL',
        )

    def test_special_regex_chars_in_find_are_literal(self):
        self.assertEqual(replace_text('a+b', 'a+b', 'c'), 'c')

    def test_replacement_with_backslash_is_literal(self):
        self.assertEqual(replace_text('x', 'x', 'a\\b'), 'a\\b')


class BuildReplacementsTests(unittest.TestCase):
    def test_pairs_element_ids_with_new_text(self):
        matches = find_matches(ENTRIES, 'DETALE')
        replacements = build_replacements(matches, 'DETALE', 'DETAIL')
        self.assertEqual(replacements[0], (1, 'REFER TO DETAIL 5'))
        self.assertEqual(replacements[1], (2, 'DETAIL AND DETAIL'))


class BuildTransformTests(unittest.TestCase):
    def test_applies_all_pairs_in_order(self):
        t = build_transform([('DETALE', 'DETAIL'), ('REFER', 'SEE')])
        self.assertEqual(t('REFER TO DETALE 5'), 'SEE TO DETAIL 5')

    def test_case_insensitive_by_default(self):
        t = build_transform([('detale', 'DETAIL')])
        self.assertEqual(t('DETALE and detale'), 'DETAIL and DETAIL')

    def test_match_case(self):
        t = build_transform([('detale', 'DETAIL')], match_case=True)
        self.assertEqual(t('DETALE and detale'), 'DETALE and DETAIL')

    def test_skips_empty_find(self):
        t = build_transform([('', 'X'), ('GALV', 'GALVANISED')])
        self.assertEqual(t('GALV UPSTAND'), 'GALVANISED UPSTAND')

    def test_replacement_is_literal(self):
        t = build_transform([('x', 'a\\1b')])
        self.assertEqual(t('x'), 'a\\1b')

    def test_none_passthrough(self):
        self.assertIsNone(build_transform([('a', 'b')])(None))


class ParsePairsCsvTests(unittest.TestCase):
    def test_parses_and_skips_header(self):
        pairs = parse_pairs_csv('find,replace\nDETALE,DETAIL\nREFER,SEE\n')
        self.assertEqual(pairs, [('DETALE', 'DETAIL'), ('REFER', 'SEE')])

    def test_quoted_cells_and_blank_rows(self):
        pairs = parse_pairs_csv('"a,b",c\n\n,skipme\nx,y')
        self.assertEqual(pairs, [('a,b', 'c'), ('x', 'y')])

    def test_missing_replace_column(self):
        self.assertEqual(parse_pairs_csv('DELETEME'), [('DELETEME', '')])

    def test_unguards_injection_prefix(self):
        self.assertEqual(parse_pairs_csv("'=SUM,'+B"), [('=SUM', '+B')])


if __name__ == "__main__":
    unittest.main()
