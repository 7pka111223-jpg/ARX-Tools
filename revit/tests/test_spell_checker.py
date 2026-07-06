# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401
from drawingchecker.spell_checker import check_spelling

WORDSET = frozenset(['refer', 'detail', 'concrete', 'ground', 'floor', 'plan', 'built'])


def entry(text, page='AR-101', element_id=1, context='text note on sheet'):
    return {'text': text, 'page': page, 'elementId': element_id, 'context': context}


class CheckSpellingTests(unittest.TestCase):
    def test_correct_text_yields_no_issues(self):
        self.assertEqual(check_spelling([entry('REFER TO DETAIL')], WORDSET), [])

    def test_misspelling_flagged_with_issue_shape(self):
        issues = check_spelling([entry('REFER TO DETALE')], WORDSET)
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual(issue['category'], 'spelling')
        self.assertEqual(issue['severity'], 'warn')
        self.assertEqual(issue['ruleId'], 'spelling')
        self.assertEqual(issue['foundText'], 'DETALE')
        self.assertEqual(issue['page'], 'AR-101')
        self.assertEqual(issue['elementId'], 1)
        self.assertIn('Possible misspelling: "DETALE"', issue['message'])
        self.assertIn('text note on sheet', issue['message'])

    def test_custom_dictionary_and_ignore_suppress_issues(self):
        spelling = {'customDictionary': ['DETALE'], 'ignore': ['XREF']}
        issues = check_spelling([entry('DETALE XREF')], WORDSET, spelling)
        self.assertEqual(issues, [])

    def test_extra_words_suppress_issues(self):
        issues = check_spelling([entry('GALV UPSTAND')], WORDSET,
                                extra_words=['galv', 'upstand'])
        self.assertEqual(issues, [])

    def test_all_caps_checked_lowercase(self):
        self.assertEqual(check_spelling([entry('GROUND FLOOR PLAN')], WORDSET), [])

    def test_hyphenated_word_passes_when_parts_known(self):
        self.assertEqual(check_spelling([entry('AS-BUILT')], WORDSET), [])

    def test_multiple_entries_keep_their_pages(self):
        issues = check_spelling(
            [entry('DETALE', page='AR-101'), entry('DETALE', page='ST-201', element_id=2)],
            WORDSET,
        )
        self.assertEqual([i['page'] for i in issues], ['AR-101', 'ST-201'])


if __name__ == '__main__':
    unittest.main()
