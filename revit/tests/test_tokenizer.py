# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401  (sys.path setup)
from drawingchecker.tokenizer import tokenize


class TokenizeTests(unittest.TestCase):
    def test_simple_words(self):
        self.assertEqual(
            tokenize('REFER TO DETAIL'),
            [('REFER', ['refer']), ('DETAIL', ['detail'])],
        )

    def test_skips_tokens_containing_digits(self):
        self.assertEqual(tokenize('300MM M12 BOLT'), [('BOLT', ['bolt'])])

    def test_skips_short_tokens(self):
        self.assertEqual(tokenize('GA TO RC'), [])

    def test_strips_punctuation(self):
        self.assertEqual(tokenize('(CONCRETE).'), [('CONCRETE', ['concrete'])])

    def test_hyphenated_words_checked_by_part(self):
        self.assertEqual(tokenize('AS-BUILT'), [('AS-BUILT', ['built'])])
        self.assertEqual(
            tokenize('CAST-IN-PLACE'), [('CAST-IN-PLACE', ['cast', 'place'])]
        )

    def test_possessive_suffix_stripped(self):
        self.assertEqual(tokenize("ENGINEER'S"), [("ENGINEER'S", ['engineer'])])

    def test_apostrophes_kept_in_contractions(self):
        self.assertEqual(tokenize("DON'T"), [("DON'T", ["don't"])])

    def test_empty_and_none(self):
        self.assertEqual(tokenize(''), [])
        self.assertEqual(tokenize(None), [])

    def test_multiline_text(self):
        self.assertEqual(
            tokenize('LINE ONE\rLINE TWO\nEND'),
            [('LINE', ['line']), ('ONE', ['one']), ('LINE', ['line']),
             ('TWO', ['two']), ('END', ['end'])],
        )

    def test_token_of_only_symbols_skipped(self):
        self.assertEqual(tokenize('--- *** %%%'), [])


if __name__ == '__main__':
    unittest.main()
