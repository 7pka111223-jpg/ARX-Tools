# -*- coding: utf-8 -*-
"""ARX Drawing Checker window.

Opens a window with three tabs, mirroring the web Drawing Checker:
Results (run checks, export CSV, select elements, cloud text issues),
Rules (edit the shared rules.json), and Find & Replace (edit text notes
model-wide). Fully offline. Shift+Click configures which rules.json and
custom dictionary file to use.
"""
from __future__ import unicode_literals

import io
import os
import traceback

import clr
clr.AddReference('System.Data')
from System.Data import DataTable  # noqa: E402

from pyrevit import forms, revit, script  # noqa: E402

from drawingchecker import config_locator, rules_store  # noqa: E402
from drawingchecker.pattern_builder import pattern_from_example  # noqa: E402
from drawingchecker.report_exporter import generate_csv  # noqa: E402
from drawingchecker.results_model import build_results  # noqa: E402
from drawingchecker.revit_actions import (  # noqa: E402
    export_annotated_pdf,
    replace_in_text_notes,
    select_and_show,
)
from drawingchecker.revit_adapter import build_snapshot  # noqa: E402
from drawingchecker.rules_engine import collect_text_entries, evaluate_rules  # noqa: E402
from drawingchecker.rules_form import (  # noqa: E402
    form_to_rules,
    grid_to_rules,
    parse_word_list,
    rules_to_form,
    rules_to_grid,
)
from drawingchecker.spell_checker import check_spelling  # noqa: E402
from drawingchecker.text_search import build_replacements, find_matches  # noqa: E402
from drawingchecker.wordlist import (  # noqa: E402
    ABBREVIATIONS_PATH,
    load_optional_wordlist,
    load_wordlist,
)

config = script.get_config()

XAML_FILE = os.path.join(os.path.dirname(__file__), 'CheckModelWindow.xaml')

RULES_GRID_COLUMNS = (
    ('Enabled', 'enabled'), ('ID', 'id'), ('Category', 'category'),
    ('Label', 'label'), ('Pattern', 'pattern'), ('Find', 'find'),
    ('Valid', 'valid'), ('Severity', 'severity'), ('Message', 'message'),
)


def get_config_option(name):
    # pyRevit's get_option raises (rather than returning the default) when
    # the option was never saved and the default is None.
    try:
        return config.get_option(name, None) or None
    except Exception:
        return None


def guarded(handler):
    """Never let an exception escape a WPF event handler."""
    def wrapper(self, sender, args):
        try:
            handler(self, sender, args)
        except Exception:
            forms.alert(traceback.format_exc(), title='ARX Drawing Checker')
    return wrapper


def make_table(columns, rows):
    table = DataTable('data')
    for column in columns:
        table.Columns.Add(column)
    for row in rows:
        table.Rows.Add(*['%s' % value if value is not None else '' for value in row])
    return table


class CheckerWindow(forms.WPFWindow):
    def __init__(self, uidoc, rules_path, rules):
        forms.WPFWindow.__init__(self, XAML_FILE)
        self.uidoc = uidoc
        self.doc = uidoc.Document
        self.rules_path = rules_path
        self.rules = rules
        self.snapshot = None
        self.results = None
        self.issues = []

        self.RunCheckBtn.Click += self.run_check
        self.ExportCsvBtn.Click += self.export_csv
        self.ExportPdfBtn.Click += self.export_pdf
        self.SelectElementBtn.Click += self.select_element
        self.ResultsGrid.MouseDoubleClick += self.select_element
        self.AddWordBtn.Click += self.add_word
        self.AddRuleBtn.Click += self.add_rule
        self.DeleteRuleBtn.Click += self.delete_rule
        self.GeneratePatternBtn.Click += self.generate_pattern
        self.TestPatternBtn.Click += self.test_pattern
        self.ApplyPatternBtn.Click += self.apply_pattern_to_rule
        self.ApplySheetNameBtn.Click += self.apply_pattern_to_sheet_name
        self.SaveRulesBtn.Click += self.save_rules
        self.ReloadRulesBtn.Click += self.reload_rules_form
        self.ImportRulesBtn.Click += self.import_rules
        self.ExportRulesBtn.Click += self.export_rules
        self.ImportDictBtn.Click += self.import_dictionary
        self.ExportDictBtn.Click += self.export_dictionary
        self.FindAllBtn.Click += self.find_all
        self.ReplaceAllBtn.Click += self.replace_all
        self.SelectMatchBtn.Click += self.select_match
        self.FindGrid.MouseDoubleClick += self.select_match

        self.populate_rules_form()
        self.run_check(None, None)

    # ------------------------------------------------------------ exports

    def ask_save_path(self, file_ext, default_name):
        """Save dialog opening in the remembered export folder; remembers
        the folder the user picks for next time."""
        path = forms.save_file(
            file_ext=file_ext,
            default_name=default_name,
            init_dir=get_config_option('export_dir') or '',
        )
        if path:
            try:
                config.export_dir = os.path.dirname(path)
                script.save_config()
            except Exception:
                pass  # remembering the folder is best-effort
        return path

    # ------------------------------------------------------------- checks

    def extra_words(self):
        extra = set(load_optional_wordlist(ABBREVIATIONS_PATH))
        dictionary_path = config_locator.find_custom_dictionary_path(
            get_config_option('custom_dictionary_path'))
        extra.update(load_optional_wordlist(dictionary_path))
        return extra

    @guarded
    def run_check(self, sender, args):
        self.snapshot = build_snapshot(self.doc, self.rules)
        issues = evaluate_rules(self.snapshot, self.rules)
        issues.extend(check_spelling(
            collect_text_entries(self.snapshot),
            load_wordlist(),
            self.rules.get('spelling'),
            self.extra_words(),
        ))
        severity_order = {'error': 0, 'warn': 1}
        issues.sort(key=lambda i: (i.get('page') or '', severity_order.get(i['severity'], 9)))
        self.issues = issues
        self.results = build_results(self.snapshot, issues)

        rows = [
            [i['severity'].upper(), i['category'], i.get('page') or '(project)',
             i.get('foundText') or '', i['message'], i.get('elementId') or '']
            for i in issues
        ]
        table = make_table(['Severity', 'Category', 'Sheet', 'Found', 'Message', 'Id'], rows)
        self.ResultsGrid.ItemsSource = table.DefaultView

        errors = sum(1 for i in issues if i['severity'] == 'error')
        warns = len(issues) - errors
        verdict = 'PASS' if errors == 0 else 'FAIL'
        self.SummaryText.Text = '%s — %d sheets, %d errors, %d warnings' % (
            verdict, len(self.snapshot['sheets']), errors, warns)

    @guarded
    def export_csv(self, sender, args):
        if self.results is None:
            return
        path = self.ask_save_path('csv', 'drawing-check-report')
        if not path:
            return
        with io.open(path, 'w', encoding='utf-8-sig', newline='') as fh:
            fh.write(generate_csv(self.results))
        forms.alert('Report saved to:\n%s' % path, title='ARX Drawing Checker')

    @guarded
    def export_pdf(self, sender, args):
        if self.snapshot is None or not self.snapshot['sheets']:
            return
        path = self.ask_save_path('pdf', 'annotated-drawings')
        if not path:
            return
        folder = os.path.dirname(path)
        file_name = os.path.splitext(os.path.basename(path))[0]
        try:
            sheet_count, marker_count = export_annotated_pdf(
                self.doc, self.snapshot, self.issues, folder, file_name)
        except RuntimeError as err:
            forms.alert('%s' % err, title='ARX Drawing Checker')
            return
        forms.alert(
            'Exported %d sheet(s) with %d red issue marker(s) to:\n%s\n\n'
            'The markers exist only in the PDF — the model is unchanged.'
            % (sheet_count, marker_count, path),
            title='ARX Drawing Checker')

    def selected_row(self, grid):
        row = grid.SelectedItem
        if row is None:
            forms.alert('Select a row first.', title='ARX Drawing Checker')
        return row

    @guarded
    def select_element(self, sender, args):
        row = self.selected_row(self.ResultsGrid)
        if row is None:
            return
        element_id = row['Id']
        if not element_id:
            forms.alert('This issue is not tied to a model element.',
                        title='ARX Drawing Checker')
            return
        select_and_show(self.uidoc, int(element_id))
        self.ResultsHint.Text = ('Element selected and zoomed — close this window '
                                 'to work on it, then run Check Model again.')

    @guarded
    def add_word(self, sender, args):
        row = self.selected_row(self.ResultsGrid)
        if row is None:
            return
        if row['Category'] != 'spelling':
            forms.alert('Pick a spelling issue to add its word to the dictionary.',
                        title='ARX Drawing Checker')
            return
        word = row['Found']
        dictionary = self.rules.setdefault('spelling', {}).setdefault('customDictionary', [])
        if word and word not in dictionary:
            dictionary.append(word)
            self.write_rules_file()
            self.populate_rules_form()
            self.run_check(None, None)

    # -------------------------------------------------------------- rules

    def populate_rules_form(self):
        form = rules_to_form(self.rules)
        self.ProjectNameBox.Text = form['projectName']
        self.ProjectNumberBox.Text = form['projectNumber']
        self.ClientBox.Text = form['client']
        self.SheetNamePatternBox.Text = form['sheetNamePattern']
        self.ViewNamePatternBox.Text = form['viewNamePattern']
        self.ScheduleNamePatternBox.Text = form['scheduleNamePattern']
        self.CustomWordsBox.Text = form['customWords']
        self.RulesPathText.Text = 'Rules file: %s' % self.rules_save_path()

        self.rules_table = DataTable('rules')
        import System
        self.rules_table.Columns.Add('Enabled', System.Boolean)
        for header, _key in RULES_GRID_COLUMNS[1:]:
            self.rules_table.Columns.Add(header)
        for row in rules_to_grid(self.rules):
            self.rules_table.Rows.Add(
                row['enabled'], row['id'], row['category'], row['label'],
                row['pattern'], row['find'], row['valid'], row['severity'],
                row['message'])
        self.RulesGrid.ItemsSource = self.rules_table.DefaultView

    def read_rules_form(self):
        return {
            'projectName': self.ProjectNameBox.Text,
            'projectNumber': self.ProjectNumberBox.Text,
            'client': self.ClientBox.Text,
            'sheetNamePattern': self.SheetNamePatternBox.Text,
            'viewNamePattern': self.ViewNamePatternBox.Text,
            'scheduleNamePattern': self.ScheduleNamePatternBox.Text,
            'customWords': self.CustomWordsBox.Text,
        }

    def read_rules_grid(self):
        # commit any in-progress cell edit before reading the table back
        from System.Windows.Controls import DataGridEditingUnit
        self.RulesGrid.CommitEdit(DataGridEditingUnit.Cell, True)
        self.RulesGrid.CommitEdit(DataGridEditingUnit.Row, True)
        rows = []
        for table_row in self.rules_table.Rows:
            row = {}
            for header, key in RULES_GRID_COLUMNS:
                value = table_row[header]
                if key == 'enabled':
                    row[key] = bool(value) if value is not None and '%s' % value != '' else False
                else:
                    row[key] = '%s' % value if value is not None else ''
            rows.append(row)
        return rows

    def rules_from_ui(self):
        """Grid + form fields -> a validated rules dict (ValueError on bad input)."""
        updated = grid_to_rules(self.rules, self.read_rules_grid())
        return form_to_rules(updated, self.read_rules_form())

    @guarded
    def add_rule(self, sender, args):
        count = self.rules_table.Rows.Count
        self.rules_table.Rows.Add(
            True, 'rule%d' % (count + 1), 'titleBlock', '', '', '', '', 'warn', '')
        self.RulesGrid.ScrollIntoView(self.RulesGrid.Items[self.RulesGrid.Items.Count - 1])

    @guarded
    def delete_rule(self, sender, args):
        row = self.RulesGrid.SelectedItem
        if row is None:
            forms.alert('Select a rule row first.', title='ARX Drawing Checker')
            return
        row.Row.Delete()
        self.rules_table.AcceptChanges()

    def rules_save_path(self):
        # Never write over the bundled defaults; user rules live in APPDATA
        # (or wherever Shift+Click pointed).
        if self.rules_path and self.rules_path != config_locator.BUNDLED_DEFAULT_RULES_PATH:
            return self.rules_path
        appdata = os.environ.get('APPDATA') or os.path.expanduser('~')
        return os.path.join(appdata, config_locator.APPDATA_DIR_NAME,
                            config_locator.RULES_FILE_NAME)

    def write_rules_file(self):
        path = self.rules_save_path()
        directory = os.path.dirname(path)
        if directory and not os.path.isdir(directory):
            os.makedirs(directory)
        with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(rules_store.dumps_rules(self.rules))
        self.rules_path = path
        self.RulesPathText.Text = 'Rules file: %s' % path

    # ----------------------------------------------------- pattern builder

    @guarded
    def generate_pattern(self, sender, args):
        try:
            pattern = pattern_from_example(self.ExampleBox.Text, self.VariablePartsBox.Text)
        except ValueError as err:
            forms.alert('%s' % err, title='ARX Drawing Checker')
            return
        self.GeneratedPatternBox.Text = pattern
        if self.TestValueBox.Text:
            self.test_pattern(None, None)
        else:
            self.TestResultText.Text = ''

    @guarded
    def test_pattern(self, sender, args):
        import re as _re
        pattern = self.GeneratedPatternBox.Text
        if not pattern:
            forms.alert('Generate a pattern first.', title='ARX Drawing Checker')
            return
        value = self.TestValueBox.Text
        if _re.search(pattern, value):
            self.TestResultText.Text = '"%s" MATCHES the pattern' % value
        else:
            self.TestResultText.Text = '"%s" does NOT match the pattern' % value

    @guarded
    def apply_pattern_to_rule(self, sender, args):
        pattern = self.GeneratedPatternBox.Text
        if not pattern:
            forms.alert('Generate a pattern first.', title='ARX Drawing Checker')
            return
        row = self.RulesGrid.SelectedItem
        if row is None:
            forms.alert('Select a rule row in the grid first.', title='ARX Drawing Checker')
            return
        row['Pattern'] = pattern
        forms.alert('Pattern applied to rule "%s".\n\nClick "Save Rules and '
                    'Re-run" to apply.' % row['ID'], title='ARX Drawing Checker')

    @guarded
    def apply_pattern_to_sheet_name(self, sender, args):
        pattern = self.GeneratedPatternBox.Text
        if not pattern:
            forms.alert('Generate a pattern first.', title='ARX Drawing Checker')
            return
        self.SheetNamePatternBox.Text = pattern

    @guarded
    def save_rules(self, sender, args):
        try:
            self.rules = self.rules_from_ui()
        except ValueError as err:
            forms.alert('%s' % err, title='ARX Drawing Checker')
            return
        self.write_rules_file()
        self.populate_rules_form()
        self.run_check(None, None)
        self.MainTabs.SelectedIndex = 0

    @guarded
    def reload_rules_form(self, sender, args):
        self.populate_rules_form()

    @guarded
    def import_rules(self, sender, args):
        path = forms.pick_file(file_ext='json')
        if not path:
            return
        try:
            with io.open(path, 'r', encoding='utf-8') as fh:
                self.rules = rules_store.load_rules(fh.read())
        except (ValueError, IOError) as err:
            forms.alert('Could not import rules:\n%s' % err, title='ARX Drawing Checker')
            return
        self.rules_path = path  # future saves go back to the imported file
        self.populate_rules_form()
        self.run_check(None, None)
        forms.alert('Rules imported from:\n%s' % path, title='ARX Drawing Checker')

    @guarded
    def export_rules(self, sender, args):
        try:
            rules = self.rules_from_ui()
        except ValueError as err:
            forms.alert('%s' % err, title='ARX Drawing Checker')
            return
        path = self.ask_save_path('json', 'rules')
        if not path:
            return
        with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(rules_store.dumps_rules(rules))
        forms.alert('Rules exported to:\n%s\n\nThis file also works in the web '
                    'Drawing Checker.' % path, title='ARX Drawing Checker')

    @guarded
    def import_dictionary(self, sender, args):
        path = forms.pick_file(file_ext='txt')
        if not path:
            return
        with io.open(path, 'r', encoding='utf-8') as fh:
            imported = parse_word_list(fh.read())
        existing = parse_word_list(self.CustomWordsBox.Text)
        added = [w for w in imported if w not in existing]
        self.CustomWordsBox.Text = '\n'.join(existing + added)
        forms.alert('%d word(s) added to the list (%d already present).\n\n'
                    'Click "Save Rules and Re-run" to apply.'
                    % (len(added), len(imported) - len(added)),
                    title='ARX Drawing Checker')

    @guarded
    def export_dictionary(self, sender, args):
        words = parse_word_list(self.CustomWordsBox.Text)
        path = self.ask_save_path('txt', 'custom_dictionary')
        if not path:
            return
        with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write('\n'.join(words) + ('\n' if words else ''))
        forms.alert('Exported %d word(s) to:\n%s' % (len(words), path),
                    title='ARX Drawing Checker')

    # ----------------------------------------------------- find & replace

    def current_matches(self):
        if self.snapshot is None:
            self.run_check(None, None)
        return find_matches(
            collect_text_entries(self.snapshot),
            self.FindBox.Text,
            bool(self.MatchCaseCheck.IsChecked),
        )

    def show_matches(self, matches):
        rows = [
            [m['entry'].get('page') or '', m['entry'].get('context') or '',
             m['count'], m['entry'].get('text') or '', m['entry'].get('elementId') or '']
            for m in matches
        ]
        table = make_table(['Sheet', 'Where', 'Matches', 'Text', 'Id'], rows)
        self.FindGrid.ItemsSource = table.DefaultView
        total = sum(m['count'] for m in matches)
        self.FindSummaryText.Text = '%d occurrence(s) in %d text note(s).' % (total, len(matches))

    @guarded
    def find_all(self, sender, args):
        if not self.FindBox.Text:
            forms.alert('Type the text to find first.', title='ARX Drawing Checker')
            return
        self.show_matches(self.current_matches())

    @guarded
    def replace_all(self, sender, args):
        find = self.FindBox.Text
        if not find:
            forms.alert('Type the text to find first.', title='ARX Drawing Checker')
            return
        matches = self.current_matches()
        if not matches:
            forms.alert('No occurrences found.', title='ARX Drawing Checker')
            return
        total = sum(m['count'] for m in matches)
        if not forms.alert(
                'Replace %d occurrence(s) of "%s" with "%s" in %d text note(s)?'
                % (total, find, self.ReplaceBox.Text, len(matches)),
                title='ARX Drawing Checker', yes=True, no=True):
            return
        replacements = build_replacements(
            matches, find, self.ReplaceBox.Text, bool(self.MatchCaseCheck.IsChecked))
        changed = replace_in_text_notes(self.doc, replacements)
        self.run_check(None, None)
        self.show_matches(self.current_matches())
        forms.alert('Updated %d text note(s).' % changed, title='ARX Drawing Checker')

    @guarded
    def select_match(self, sender, args):
        row = self.selected_row(self.FindGrid)
        if row is None:
            return
        if row['Id']:
            select_and_show(self.uidoc, int(row['Id']))


def load_rules():
    rules_path = config_locator.find_rules_path(get_config_option('rules_path'))
    with io.open(rules_path, 'r', encoding='utf-8') as fh:
        return rules_path, rules_store.load_rules(fh.read())


def main():
    uidoc = revit.uidoc
    if uidoc is None or revit.doc is None:
        forms.alert('Open a Revit project first.', exitscript=True)

    rules_path, rules = load_rules()
    window = CheckerWindow(uidoc, rules_path, rules)
    if not window.snapshot or not window.snapshot['sheets']:
        forms.alert('This model has no sheets to check.', exitscript=True)
    window.ShowDialog()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        forms.alert(traceback.format_exc(), title='ARX Drawing Checker')
