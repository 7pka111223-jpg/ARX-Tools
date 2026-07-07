# -*- coding: utf-8 -*-
import unittest

from checker.mtext import strip_mtext


class StripMtextTests(unittest.TestCase):
    def test_plain_text_unchanged(self):
        self.assertEqual(strip_mtext('REFER TO DETAIL 5'), 'REFER TO DETAIL 5')

    def test_font_and_braces_removed(self):
        self.assertEqual(
            strip_mtext('{\\fArial|b0|i0;REFER TO DETALE}'), 'REFER TO DETALE')

    def test_paragraph_breaks_become_newlines(self):
        self.assertEqual(strip_mtext('LINE ONE\\PLINE TWO'), 'LINE ONE\nLINE TWO')

    def test_underline_and_height_codes_removed(self):
        self.assertEqual(
            strip_mtext('\\LNOTE\\l \\H2.5x;CONCRETE'), 'NOTE CONCRETE')

    def test_color_code_removed(self):
        self.assertEqual(strip_mtext('{\\C1;RED TEXT}'), 'RED TEXT')

    def test_stacked_fraction_flattened(self):
        self.assertEqual(strip_mtext('SLOPE \\S1#2;'), 'SLOPE 1/2')

    def test_nonbreaking_space(self):
        self.assertEqual(strip_mtext('AS\\~BUILT'), 'AS BUILT')

    def test_escaped_braces_and_backslashes_kept(self):
        self.assertEqual(strip_mtext('A\\{B\\}C \\\\D'), 'A{B}C \\D')

    def test_empty_and_none(self):
        self.assertEqual(strip_mtext(''), '')
        self.assertEqual(strip_mtext(None), '')


if __name__ == '__main__':
    unittest.main()
