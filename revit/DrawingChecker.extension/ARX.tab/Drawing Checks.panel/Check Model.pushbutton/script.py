# -*- coding: utf-8 -*-
"""Check sheets and drawings against the ARX standards, fully offline.

Reads every sheet in the open model (numbers, revision/authorship
parameters, project information, text notes, placed view and schedule
names), evaluates the shared ARX rules file plus a spelling check, and
prints a clickable report. Shift+Click configures which rules.json and
custom dictionary to use.
"""
from __future__ import unicode_literals

import io
import traceback

from pyrevit import DB, forms, revit, script

from drawingchecker import config_locator, rules_store
from drawingchecker.report_exporter import generate_csv
from drawingchecker.results_model import build_results
from drawingchecker.revit_adapter import build_snapshot
from drawingchecker.rules_engine import collect_text_entries, evaluate_rules
from drawingchecker.spell_checker import check_spelling
from drawingchecker.wordlist import (
    ABBREVIATIONS_PATH,
    load_optional_wordlist,
    load_wordlist,
)

output = script.get_output()
config = script.get_config()

SEVERITY_ORDER = {'error': 0, 'warn': 1}


def load_rules():
    rules_path = config_locator.find_rules_path(config.get_option('rules_path', None))
    with io.open(rules_path, 'r', encoding='utf-8') as fh:
        return rules_path, rules_store.load_rules(fh.read())


def load_extra_words():
    extra = set(load_optional_wordlist(ABBREVIATIONS_PATH))
    dictionary_path = config_locator.find_custom_dictionary_path(
        config.get_option('custom_dictionary_path', None)
    )
    extra.update(load_optional_wordlist(dictionary_path))
    return extra


def link_for(issue):
    element_id = issue.get('elementId')
    if not element_id:
        return ''
    try:
        return output.linkify(DB.ElementId(element_id), 'Select')
    except Exception:
        return ''


def print_report(results, rules_path):
    total_errors = sum(d['counts']['error'] for d in results['drawings'])
    total_warns = sum(d['counts']['warn'] for d in results['drawings'])
    verdict = 'PASS' if total_errors == 0 else 'FAIL'

    output.print_md('# Drawing Check Report — %s' % verdict)
    output.print_md(
        '%d sheets checked, **%d errors**, %d warnings &nbsp;·&nbsp; rules: `%s`'
        % (results['total'], total_errors, total_warns, rules_path)
    )

    for drawing in results['drawings']:
        if not drawing['issues']:
            continue
        output.print_md('### %s — %d error(s), %d warning(s)' % (
            drawing['fileName'], drawing['counts']['error'], drawing['counts']['warn']))
        rows = []
        issues = sorted(drawing['issues'], key=lambda i: SEVERITY_ORDER.get(i['severity'], 9))
        for issue in issues:
            rows.append([
                issue['severity'].upper(),
                issue['category'],
                issue.get('foundText') or '',
                issue['message'],
                link_for(issue),
            ])
        output.print_table(
            rows, columns=['Severity', 'Category', 'Found', 'Message', ''])

    clean = [d['fileName'] for d in results['drawings'] if not d['issues']]
    if clean:
        output.print_md('### Clean sheets (%d)' % len(clean))
        output.print_md(', '.join(clean))


def offer_csv_export(results):
    path = forms.save_file(
        file_ext='csv',
        default_name='drawing-check-report',
        title='Save CSV report (Cancel to skip)',
    )
    if not path:
        return
    with io.open(path, 'w', encoding='utf-8-sig', newline='') as fh:
        fh.write(generate_csv(results))
    output.print_md('CSV report saved to `%s`' % path)


def main():
    doc = revit.doc
    if doc is None:
        forms.alert('Open a Revit project first.', exitscript=True)

    rules_path, rules = load_rules()
    snapshot = build_snapshot(doc, rules)
    if not snapshot['sheets']:
        forms.alert('This model has no sheets to check.', exitscript=True)

    issues = evaluate_rules(snapshot, rules)
    issues.extend(check_spelling(
        collect_text_entries(snapshot),
        load_wordlist(),
        rules.get('spelling'),
        load_extra_words(),
    ))

    results = build_results(snapshot, issues)
    print_report(results, rules_path)
    offer_csv_export(results)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        output.print_md('**The check failed with an unexpected error:**')
        print(traceback.format_exc())
