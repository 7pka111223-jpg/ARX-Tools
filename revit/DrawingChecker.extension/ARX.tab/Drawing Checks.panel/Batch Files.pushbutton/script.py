# -*- coding: utf-8 -*-
"""Run the ARX checks or a batch find & replace across many Revit files.

Files are opened in the background (detached from central), processed, and
closed. Checks produce one combined CSV; find & replace applies a list of
find/replace pairs (typed here or loaded from a CSV shared with the other
ARX checkers) to every text note, saved in place or as copies. Offline.
"""
from __future__ import unicode_literals

import io
import os
import traceback

from pyrevit import HOST_APP, forms, script

from Autodesk.Revit.DB import (
    DetachFromCentralOption,
    FilteredElementCollector,
    ModelPathUtils,
    OpenOptions,
    SaveAsOptions,
    TextNote,
    Transaction,
)

from drawingchecker import config_locator, licensing, rules_store
from drawingchecker.report_exporter import csv_field
from drawingchecker.results_model import build_results
from drawingchecker.revit_adapter import build_snapshot
from drawingchecker.rules_engine import collect_text_entries, evaluate_rules
from drawingchecker.spell_checker import check_spelling
from drawingchecker.text_search import build_transform, parse_pairs_csv
from drawingchecker.wordlist import (
    ABBREVIATIONS_PATH,
    load_optional_wordlist,
    load_wordlist,
)

output = script.get_output()
config = script.get_config()
app = HOST_APP.app

CHECK = 'Check files  ->  combined CSV report'
REPLACE = 'Batch find & replace in files'
PICK_FILES = 'Pick individual .rvt files'
PICK_FOLDER = 'Pick a folder of .rvt files'
SAVE_COPIES = 'Save edited copies to a folder'
SAVE_INPLACE = 'Overwrite the original files in place'


def get_config_option(name):
    try:
        return config.get_option(name, None) or None
    except Exception:
        return None


def load_rules():
    path = config_locator.find_rules_path(get_config_option('rules_path'))
    with io.open(path, 'r', encoding='utf-8') as fh:
        return rules_store.load_rules(fh.read())


def extra_words():
    words = set(load_optional_wordlist(ABBREVIATIONS_PATH))
    dictionary = config_locator.find_custom_dictionary_path(
        get_config_option('custom_dictionary_path'))
    words.update(load_optional_wordlist(dictionary))
    return words


def pick_paths():
    source = forms.CommandSwitchWindow.show(
        [PICK_FILES, PICK_FOLDER], message='Which files?')
    if source == PICK_FILES:
        picked = forms.pick_file(file_ext='rvt', multi_file=True)
        return list(picked) if picked else []
    if source == PICK_FOLDER:
        folder = forms.pick_folder()
        if not folder:
            return []
        recurse = forms.alert('Include subfolders?', yes=True, no=True)
        paths = []
        for root, _dirs, files in os.walk(folder):
            for name in files:
                if name.lower().endswith('.rvt') and not name.startswith('~'):
                    paths.append(os.path.join(root, name))
            if not recurse:
                break
        return sorted(paths)
    return []


def open_detached(path):
    """Open a file in the background, detached from central when possible."""
    model_path = ModelPathUtils.ConvertUserVisiblePathToModelPath(path)
    options = OpenOptions()
    try:
        options.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets
        return app.OpenDocumentFile(model_path, options)
    except Exception:
        # not workshared (detach not allowed) — plain background open
        return app.OpenDocumentFile(path)


def combined_csv(file_results):
    header = 'file,fileName,pass,severity,category,ruleId,page,foundText,message'
    rows = [header]
    for path, results, error in file_results:
        name = os.path.basename(path)
        if error is not None:
            rows.append(','.join(csv_field(v) for v in
                                 [name, '(could not open)', 'false', 'error',
                                  'extraction', 'openFailed', '', '', error]))
            continue
        for drawing in results['drawings']:
            passv = 'true' if drawing['pass'] else 'false'
            if not drawing['issues']:
                rows.append(','.join(csv_field(v) for v in
                                     [name, drawing['fileName'], passv, '', '', '', '', '', '']))
            for issue in drawing['issues']:
                rows.append(','.join(csv_field(v) for v in [
                    name, drawing['fileName'], passv, issue['severity'], issue['category'],
                    issue['ruleId'], issue.get('page') or '', issue.get('foundText') or '',
                    issue['message']]))
    return '\n'.join(rows)


def check_files(paths, rules):
    wordset = load_wordlist()
    extra = extra_words()
    file_results = []
    total_issues = 0
    failed = 0
    for path in paths:
        output.print_md('Checking **%s** ...' % os.path.basename(path))
        doc = None
        try:
            doc = open_detached(path)
            snapshot = build_snapshot(doc, rules)
            issues = evaluate_rules(snapshot, rules)
            issues.extend(check_spelling(collect_text_entries(snapshot), wordset,
                                         rules.get('spelling'), extra))
            results = build_results(snapshot, issues)
            file_results.append((path, results, None))
            total_issues += len(issues)
        except Exception as err:
            failed += 1
            file_results.append((path, None, '%s' % err))
            output.print_md('&nbsp;&nbsp;ERROR: %s' % err)
        finally:
            if doc is not None:
                try:
                    doc.Close(False)
                except Exception:
                    pass

    path = forms.save_file(file_ext='csv', default_name='batch-check-report')
    if path:
        with io.open(path, 'w', encoding='utf-8-sig', newline='') as fh:
            fh.write(combined_csv(file_results))
        output.print_md('Report saved to `%s`' % path)
    output.print_md('**Done.** %d checked, %d failed, %d issue(s) total.'
                    % (len(paths) - failed, failed, total_issues))


def load_pairs():
    """Pairs typed in a prompt, or loaded from a find,replace CSV."""
    how = forms.CommandSwitchWindow.show(
        ['Type one find/replace pair', 'Load a pairs CSV (find,replace)'],
        message='Where are the find/replace pairs?')
    if how == 'Load a pairs CSV (find,replace)':
        path = forms.pick_file(file_ext='csv')
        if not path:
            return []
        with io.open(path, 'r', encoding='utf-8-sig') as fh:
            return parse_pairs_csv(fh.read())
    if how == 'Type one find/replace pair':
        find = forms.ask_for_string(default='', prompt='Find:', title='Batch replace')
        if not find:
            return []
        replace = forms.ask_for_string(default='', prompt='Replace "%s" with:' % find,
                                       title='Batch replace') or ''
        return [(find, replace)]
    return []


def replace_in_doc(doc, transform):
    changed = 0
    transaction = Transaction(doc, 'ARX batch find & replace')
    transaction.Start()
    try:
        for note in FilteredElementCollector(doc).OfClass(TextNote):
            old = note.Text
            new = transform(old)
            if new != old:
                note.Text = new
                changed += 1
        transaction.Commit()
    except Exception:
        transaction.RollBack()
        raise
    return changed


def save_doc(doc, out_path):
    options = SaveAsOptions()
    options.OverwriteExistingFile = True
    model_path = ModelPathUtils.ConvertUserVisiblePathToModelPath(out_path)
    doc.SaveAs(model_path, options)


def replace_files(paths, rules):
    pairs = load_pairs()
    if not pairs:
        forms.alert('No find/replace pairs given.', title='ARX Drawing Checker')
        return
    match_case = forms.alert('Match case?', yes=True, no=True) is True
    transform = build_transform(pairs, match_case)

    mode = forms.CommandSwitchWindow.show(
        [SAVE_COPIES, SAVE_INPLACE], message='How should edited files be saved?')
    if not mode:
        return
    out_dir = None
    if mode == SAVE_COPIES:
        out_dir = forms.pick_folder(title='Output folder for edited copies')
        if not out_dir:
            return
    else:
        if not forms.alert(
                'Overwrite %d original file(s) in place?\n\nThis cannot be undone — make sure '
                'you have a backup. Note: workshared (central) models are saved as detached, '
                'non-workshared copies over the original — use "save copies" to be safe.'
                % len(paths), yes=True, no=True):
            return

    edited = 0
    failed = 0
    for path in paths:
        output.print_md('Replacing in **%s** ...' % os.path.basename(path))
        doc = None
        try:
            doc = open_detached(path)
            changed = replace_in_doc(doc, transform)
            if changed:
                out_path = path if mode == SAVE_INPLACE else os.path.join(
                    out_dir, os.path.basename(path))
                save_doc(doc, out_path)
                edited += 1
                output.print_md('&nbsp;&nbsp;%d change(s) -> `%s`' % (changed, out_path))
            else:
                output.print_md('&nbsp;&nbsp;no matches, not saved')
        except Exception as err:
            failed += 1
            output.print_md('&nbsp;&nbsp;ERROR: %s' % err)
        finally:
            if doc is not None:
                try:
                    doc.Close(False)
                except Exception:
                    pass
    output.print_md('**Done.** %d file(s) edited, %d failed.' % (edited, failed))


def main():
    license_status = licensing.check_license()
    if not license_status['allowed']:
        forms.alert(licensing.describe(license_status),
                    title='ARX Drawing Checker — license', exitscript=True)
    if license_status['warning']:
        forms.alert(licensing.describe(license_status),
                    title='ARX Drawing Checker — license')

    rules = load_rules()
    paths = pick_paths()
    if not paths:
        return
    action = forms.CommandSwitchWindow.show([CHECK, REPLACE], message='What do you want to do?')
    if action == CHECK:
        output.print_md('# Batch check — %d file(s)' % len(paths))
        check_files(paths, rules)
    elif action == REPLACE:
        output.print_md('# Batch find & replace — %d file(s)' % len(paths))
        replace_files(paths, rules)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        output.print_md('**The batch failed with an unexpected error:**')
        print(traceback.format_exc())
