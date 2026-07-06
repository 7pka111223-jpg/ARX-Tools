# -*- coding: utf-8 -*-
import unittest

from . import _path  # noqa: F401
from drawingchecker.report_exporter import CSV_HEADER, csv_field, generate_csv
from drawingchecker.results_model import (
    aggregate_results,
    build_drawing_result,
    build_results,
)


def issue(**overrides):
    base = {
        'category': 'titleBlock', 'severity': 'error', 'ruleId': 'dwgNo',
        'foundText': 'A101', 'page': 'A101', 'elementId': 1001,
        'message': 'Drawing number must match AA-000',
    }
    base.update(overrides)
    return base


class CsvFieldTests(unittest.TestCase):
    def test_plain_value_unchanged(self):
        self.assertEqual(csv_field('hello'), 'hello')

    def test_none_becomes_empty(self):
        self.assertEqual(csv_field(None), '')

    def test_quotes_commas_and_newlines(self):
        self.assertEqual(csv_field('a,b'), '"a,b"')
        self.assertEqual(csv_field('say "hi"'), '"say ""hi"""')
        self.assertEqual(csv_field('line1\nline2'), '"line1\nline2"')

    def test_formula_injection_neutralized(self):
        self.assertEqual(csv_field('=SUM(A1)'), "'=SUM(A1)")
        self.assertEqual(csv_field('+1'), "'+1")
        self.assertEqual(csv_field('-1'), "'-1")
        self.assertEqual(csv_field('@cmd'), "'@cmd")
        self.assertEqual(csv_field('\tx'), "'\tx")


class GenerateCsvTests(unittest.TestCase):
    def test_header_matches_web_tool(self):
        self.assertEqual(
            CSV_HEADER, 'fileName,pass,severity,category,ruleId,page,foundText,message')

    def test_clean_drawing_gets_single_pass_row(self):
        agg = aggregate_results([build_drawing_result('AR-101 — PLAN', [])])
        self.assertEqual(
            generate_csv(agg).split('\n')[1], 'AR-101 — PLAN,true,,,,,,')

    def test_issue_rows(self):
        agg = aggregate_results([build_drawing_result('A101 — PLAN', [issue()])])
        self.assertEqual(
            generate_csv(agg).split('\n')[1],
            'A101 — PLAN,false,error,titleBlock,dwgNo,A101,A101,Drawing number must match AA-000',
        )

    def test_leading_dash_in_found_text_is_neutralized(self):
        agg = aggregate_results([build_drawing_result('S', [issue(foundText='-1')])])
        self.assertIn(",'-1,", generate_csv(agg))


class BuildResultsTests(unittest.TestCase):
    def test_groups_issues_by_sheet_and_doc(self):
        snapshot = {
            'docTitle': 'sample.rvt',
            'sheets': [
                {'number': 'AR-101', 'name': 'PLAN', 'elementId': 1},
                {'number': 'AR-102', 'name': 'SECTIONS', 'elementId': 2},
            ],
        }
        issues = [
            issue(page=None, ruleId='number', category='project'),
            issue(page='AR-102', severity='warn'),
        ]
        results = build_results(snapshot, issues)
        self.assertEqual(results['total'], 3)
        self.assertEqual(results['drawings'][0]['fileName'], 'sample.rvt')
        self.assertFalse(results['drawings'][0]['pass'])  # project issue is an error
        self.assertTrue(results['drawings'][1]['pass'])   # AR-101 clean
        self.assertTrue(results['drawings'][2]['pass'])   # warn only
        self.assertEqual(results['passed'], 2)
        self.assertEqual(results['failed'], 1)
        self.assertEqual(results['drawings'][2]['counts'], {'error': 0, 'warn': 1})


if __name__ == '__main__':
    unittest.main()
