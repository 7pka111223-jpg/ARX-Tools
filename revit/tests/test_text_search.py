# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401
from drawingchecker.text_search import (
    build_replacements,
    find_matches,
    is_editable_entry,
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


if __name__ == '__main__':
    unittest.main()
