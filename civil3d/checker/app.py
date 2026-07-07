# -*- coding: utf-8 -*-
"""ARX Drawing Checker for Civil 3D / AutoCAD.

Connects to the running Civil 3D session over COM and checks every
layout (sheet) against the shared ARX rules: drawing number format,
title block fields, project info, layout naming, formatting rules and
spelling of all text. Same rules.json and dictionary as the Revit and
web PDF checkers. Fully offline.
"""
import io
import os
import re
import sys
import traceback

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

if __package__ in (None, ''):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = 'checker'  # noqa: A001

from .libpath import add_lib_to_path
add_lib_to_path()

from drawingchecker import config_locator, rules_store                       # noqa: E402
from drawingchecker.pattern_builder import pattern_from_example              # noqa: E402
from drawingchecker.report_exporter import generate_csv                      # noqa: E402
from drawingchecker.results_model import build_results                       # noqa: E402
from drawingchecker.rules_engine import collect_text_entries, evaluate_rules # noqa: E402
from drawingchecker.rules_form import form_to_rules, parse_word_list         # noqa: E402
from drawingchecker.spell_checker import check_spelling                      # noqa: E402
from drawingchecker.text_search import find_matches                          # noqa: E402
from drawingchecker.wordlist import (                                        # noqa: E402
    ABBREVIATIONS_PATH,
    load_optional_wordlist,
    load_wordlist,
)

from . import acad_actions, acad_adapter, appconfig                          # noqa: E402

TITLE = 'ARX Drawing Checker — Civil 3D'
RULE_CATEGORIES = ('titleBlock', 'revision', 'formatting')
SEVERITIES = ('error', 'warn')


def guarded(handler):
    def wrapper(self, *args, **kwargs):
        try:
            return handler(self, *args, **kwargs)
        except Exception:
            messagebox.showerror(TITLE, traceback.format_exc())
    return wrapper


class CheckerApp:
    def __init__(self, root):
        self.root = root
        root.title(TITLE)
        root.geometry('1100x720')

        self.config = appconfig.load_config()
        self.acad, self.doc = acad_adapter.connect()
        self.rules_path, self.rules = self.load_rules()
        self.snapshot = None
        self.results = None
        self.issues = []
        self.editing_rule_id = None

        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill='both', expand=True, padx=8, pady=8)
        self.build_results_tab()
        self.build_rules_tab()
        self.build_project_tab()
        self.build_find_tab()

        self.populate_rule_widgets()
        self.run_check()

    # ------------------------------------------------------------- config

    def load_rules(self):
        rules_path = config_locator.find_rules_path(self.config.get('rules_path'))
        with io.open(rules_path, 'r', encoding='utf-8') as fh:
            return rules_path, rules_store.load_rules(fh.read())

    def rules_save_path(self):
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
        self.rules_path_var.set('Rules file: %s' % path)

    def ask_save_path(self, extension, default_name, file_type_label):
        path = filedialog.asksaveasfilename(
            defaultextension='.%s' % extension,
            initialdir=self.config.get('export_dir') or '',
            initialfile=default_name,
            filetypes=[(file_type_label, '*.%s' % extension)],
        )
        if path:
            self.config['export_dir'] = os.path.dirname(path)
            appconfig.save_config(self.config)
        return path

    def extra_words(self):
        extra = set(load_optional_wordlist(ABBREVIATIONS_PATH))
        dictionary_path = config_locator.find_custom_dictionary_path(
            self.config.get('custom_dictionary_path'))
        extra.update(load_optional_wordlist(dictionary_path))
        return extra

    # -------------------------------------------------------- results tab

    def build_results_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text='Results')

        toolbar = ttk.Frame(tab)
        toolbar.pack(fill='x', pady=(6, 4), padx=6)
        ttk.Button(toolbar, text='Re-run Check', command=self.run_check).pack(side='left', padx=(0, 6))
        ttk.Button(toolbar, text='Export CSV…', command=self.export_csv).pack(side='left', padx=(0, 6))
        ttk.Button(toolbar, text='Export Annotated PDF…', command=self.export_pdf).pack(side='left', padx=(0, 12))
        self.summary_var = tk.StringVar(value='')
        ttk.Label(toolbar, textvariable=self.summary_var, font=('', 10, 'bold')).pack(side='left')

        columns = ('severity', 'category', 'sheet', 'found', 'message')
        self.results_tree = ttk.Treeview(tab, columns=columns, show='headings', selectmode='browse')
        widths = {'severity': 70, 'category': 90, 'sheet': 90, 'found': 160, 'message': 520}
        for column in columns:
            self.results_tree.heading(column, text=column.title())
            self.results_tree.column(column, width=widths[column], anchor='w')
        self.results_tree.pack(fill='both', expand=True, padx=6)
        self.results_tree.bind('<Double-1>', lambda e: self.zoom_selected())

        scroll = ttk.Scrollbar(self.results_tree, orient='vertical', command=self.results_tree.yview)
        self.results_tree.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right', fill='y')

        actions = ttk.Frame(tab)
        actions.pack(fill='x', pady=6, padx=6)
        ttk.Button(actions, text='Zoom to Mistake', command=self.zoom_selected).pack(side='left', padx=(0, 6))
        ttk.Button(actions, text='Add Word to Dictionary', command=self.add_word).pack(side='left', padx=(0, 12))
        ttk.Label(actions, foreground='gray',
                  text='Double-click a row to jump to it in Civil 3D.').pack(side='left')

    @guarded
    def run_check(self):
        self.snapshot = acad_adapter.build_snapshot(self.doc, self.rules)
        issues = evaluate_rules(self.snapshot, self.rules)
        issues.extend(check_spelling(
            collect_text_entries(self.snapshot),
            load_wordlist(),
            self.rules.get('spelling'),
            self.extra_words(),
        ))
        order = {'error': 0, 'warn': 1}
        issues.sort(key=lambda i: (str(i.get('page') or ''), order.get(i['severity'], 9)))
        self.issues = issues
        self.results = build_results(self.snapshot, issues)

        self.results_tree.delete(*self.results_tree.get_children())
        for index, issue in enumerate(issues):
            self.results_tree.insert('', 'end', iid=str(index), values=(
                issue['severity'].upper(), issue['category'],
                issue.get('page') or '(project)', issue.get('foundText') or '',
                issue['message']))

        errors = sum(1 for i in issues if i['severity'] == 'error')
        warns = len(issues) - errors
        verdict = 'PASS' if errors == 0 else 'FAIL'
        self.summary_var.set('%s — %d sheets, %d errors, %d warnings' % (
            verdict, len(self.snapshot['sheets']), errors, warns))

    def selected_issue(self):
        selection = self.results_tree.selection()
        if not selection:
            messagebox.showinfo(TITLE, 'Select a row first.')
            return None
        return self.issues[int(selection[0])]

    @guarded
    def zoom_selected(self):
        issue = self.selected_issue()
        if issue is None:
            return
        handle = issue.get('elementId')
        if not handle:
            messagebox.showinfo(TITLE, 'This issue is not tied to a drawing object.')
            return
        layout_name = acad_adapter.layout_for_page(self.snapshot, issue.get('page'))
        acad_actions.zoom_to(self.acad, self.doc, handle, layout_name)

    @guarded
    def add_word(self):
        issue = self.selected_issue()
        if issue is None:
            return
        if issue['category'] != 'spelling':
            messagebox.showinfo(TITLE, 'Pick a spelling issue to add its word to the dictionary.')
            return
        word = issue.get('foundText')
        dictionary = self.rules.setdefault('spelling', {}).setdefault('customDictionary', [])
        if word and word not in dictionary:
            dictionary.append(word)
            self.write_rules_file()
            self.populate_rule_widgets()
            self.run_check()

    @guarded
    def export_csv(self):
        if self.results is None:
            return
        path = self.ask_save_path('csv', 'drawing-check-report', 'CSV report')
        if not path:
            return
        with io.open(path, 'w', encoding='utf-8-sig', newline='') as fh:
            fh.write(generate_csv(self.results))
        messagebox.showinfo(TITLE, 'Report saved to:\n%s' % path)

    @guarded
    def export_pdf(self):
        if self.snapshot is None or not self.snapshot['sheets']:
            return
        path = self.ask_save_path('pdf', 'annotated-drawings', 'PDF')
        if not path:
            return
        sheet_count, marker_count, combined = acad_actions.export_annotated_pdf(
            self.acad, self.doc, self.snapshot, self.issues, path)
        if combined:
            message = ('Exported %d sheet(s) with %d red marker(s) to:\n%s'
                       % (sheet_count, marker_count, path))
        else:
            message = ('Exported %d sheet(s) with %d red marker(s) as separate PDFs '
                       'next to:\n%s\n(install pypdf to combine them)'
                       % (sheet_count, marker_count, path))
        messagebox.showinfo(TITLE, message + '\n\nThe markers exist only in the PDF — '
                                             'the drawing is unchanged.')

    # ---------------------------------------------------------- rules tab

    def build_rules_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text='Rules')

        left = ttk.Frame(tab)
        left.pack(side='left', fill='both', expand=True, padx=6, pady=6)
        ttk.Label(left, text='Rules (select to edit)').pack(anchor='w')
        columns = ('enabled', 'id', 'category', 'label', 'severity')
        self.rules_tree = ttk.Treeview(left, columns=columns, show='headings', selectmode='browse', height=12)
        for column, width in zip(columns, (60, 100, 90, 160, 70)):
            self.rules_tree.heading(column, text=column.title())
            self.rules_tree.column(column, width=width, anchor='w')
        self.rules_tree.pack(fill='both', expand=True)
        self.rules_tree.bind('<<TreeviewSelect>>', lambda e: self.load_rule_into_editor())

        list_buttons = ttk.Frame(left)
        list_buttons.pack(fill='x', pady=4)
        ttk.Button(list_buttons, text='New Rule', command=self.new_rule).pack(side='left', padx=(0, 6))
        ttk.Button(list_buttons, text='Delete Rule', command=self.delete_rule).pack(side='left', padx=(0, 6))
        ttk.Button(list_buttons, text='Import Rules…', command=self.import_rules).pack(side='left', padx=(0, 6))
        ttk.Button(list_buttons, text='Export Rules…', command=self.export_rules).pack(side='left')

        save_bar = ttk.Frame(left)
        save_bar.pack(fill='x', pady=4)
        ttk.Button(save_bar, text='Save Rules and Re-run', command=self.save_rules).pack(side='left', padx=(0, 8))
        self.rules_path_var = tk.StringVar(value='')
        ttk.Label(save_bar, textvariable=self.rules_path_var, foreground='gray').pack(side='left')

        right = ttk.LabelFrame(tab, text='Rule editor')
        right.pack(side='right', fill='y', padx=6, pady=6)

        self.rule_vars = {}
        for row, (key, label) in enumerate((
                ('id', 'Rule ID'), ('label', 'Label (title block tag)'),
                ('pattern', 'Pattern (titleBlock/revision)'),
                ('find', 'Find regex (formatting)'), ('valid', 'Valid regex (formatting)'),
                ('message', 'Message when it fails'))):
            ttk.Label(right, text=label).grid(row=row, column=0, sticky='w', padx=6, pady=2)
            variable = tk.StringVar()
            ttk.Entry(right, textvariable=variable, width=34).grid(row=row, column=1, padx=6, pady=2)
            self.rule_vars[key] = variable

        ttk.Label(right, text='Category').grid(row=6, column=0, sticky='w', padx=6, pady=2)
        self.rule_category = ttk.Combobox(right, values=RULE_CATEGORIES, state='readonly', width=32)
        self.rule_category.grid(row=6, column=1, padx=6, pady=2)
        self.rule_category.set('titleBlock')

        ttk.Label(right, text='Severity').grid(row=7, column=0, sticky='w', padx=6, pady=2)
        self.rule_severity = ttk.Combobox(right, values=SEVERITIES, state='readonly', width=32)
        self.rule_severity.grid(row=7, column=1, padx=6, pady=2)
        self.rule_severity.set('error')

        self.rule_enabled = tk.BooleanVar(value=True)
        ttk.Checkbutton(right, text='Enabled', variable=self.rule_enabled).grid(
            row=8, column=1, sticky='w', padx=6, pady=2)
        ttk.Button(right, text='Save Rule', command=self.save_rule_from_editor).grid(
            row=9, column=1, sticky='e', padx=6, pady=(4, 8))

        builder = ttk.LabelFrame(right, text='Pattern builder — no regex needed')
        builder.grid(row=10, column=0, columnspan=2, sticky='we', padx=6, pady=6)
        ttk.Label(builder, text='Example value (e.g. AA-001)').grid(row=0, column=0, sticky='w', padx=4, pady=2)
        self.example_var = tk.StringVar()
        ttk.Entry(builder, textvariable=self.example_var, width=20).grid(row=0, column=1, padx=4, pady=2)
        ttk.Label(builder, text='Variable part(s) (e.g. 001)').grid(row=1, column=0, sticky='w', padx=4, pady=2)
        self.variable_var = tk.StringVar()
        ttk.Entry(builder, textvariable=self.variable_var, width=20).grid(row=1, column=1, padx=4, pady=2)
        ttk.Button(builder, text='Generate → Pattern field', command=self.generate_pattern).grid(
            row=2, column=1, sticky='e', padx=4, pady=2)
        ttk.Label(builder, text='Try a value').grid(row=3, column=0, sticky='w', padx=4, pady=2)
        self.test_var = tk.StringVar()
        ttk.Entry(builder, textvariable=self.test_var, width=20).grid(row=3, column=1, padx=4, pady=2)
        ttk.Button(builder, text='Test', command=self.test_pattern).grid(row=4, column=1, sticky='e', padx=4, pady=2)
        self.test_result_var = tk.StringVar()
        ttk.Label(builder, textvariable=self.test_result_var, font=('', 9, 'bold')).grid(
            row=5, column=0, columnspan=2, sticky='w', padx=4, pady=2)

    def populate_rule_widgets(self):
        self.rules_tree.delete(*self.rules_tree.get_children())
        for rule in self.rules['rules']:
            self.rules_tree.insert('', 'end', iid=rule['id'], values=(
                'yes' if rule.get('enabled') else 'no', rule['id'],
                rule.get('category') or '', rule.get('label') or '',
                rule.get('severity') or ''))
        self.rules_path_var.set('Rules file: %s' % self.rules_save_path())

        project = dict((f['id'], f.get('value') or '') for f in self.rules.get('project', []))
        self.project_name_var.set(project.get('name', ''))
        self.project_number_var.set(project.get('number', ''))
        self.client_var.set(project.get('client', ''))
        self.sheet_pattern_var.set((self.rules.get('revit') or {}).get('sheetNamePattern') or '')
        self.dictionary_text.delete('1.0', 'end')
        self.dictionary_text.insert('1.0', '\n'.join(
            (self.rules.get('spelling') or {}).get('customDictionary') or []))

    def rule_by_id(self, rule_id):
        return next((r for r in self.rules['rules'] if r['id'] == rule_id), None)

    @guarded
    def load_rule_into_editor(self):
        selection = self.rules_tree.selection()
        if not selection:
            return
        rule = self.rule_by_id(selection[0])
        if rule is None:
            return
        self.editing_rule_id = rule['id']
        for key, variable in self.rule_vars.items():
            variable.set(rule.get(key) or '')
        self.rule_category.set(rule.get('category') or 'titleBlock')
        self.rule_severity.set(rule.get('severity') or 'warn')
        self.rule_enabled.set(bool(rule.get('enabled')))

    @guarded
    def new_rule(self):
        self.editing_rule_id = None
        for variable in self.rule_vars.values():
            variable.set('')
        self.rule_category.set('titleBlock')
        self.rule_severity.set('error')
        self.rule_enabled.set(True)
        self.rules_tree.selection_remove(self.rules_tree.selection())

    @guarded
    def save_rule_from_editor(self):
        rule = {
            'id': self.rule_vars['id'].get().strip(),
            'category': self.rule_category.get(),
            'label': self.rule_vars['label'].get().strip(),
            'severity': self.rule_severity.get(),
            'message': self.rule_vars['message'].get().strip(),
            'enabled': bool(self.rule_enabled.get()),
        }
        if not rule['id']:
            messagebox.showerror(TITLE, 'The rule needs an ID (e.g. dwgNo).')
            return
        rule['label'] = rule['label'] or rule['id']
        rule['message'] = rule['message'] or 'Check failed for "%s"' % rule['label']
        for key in ('pattern', 'find', 'valid'):
            value = self.rule_vars[key].get().strip()
            if value:
                rule[key] = value
        if rule['category'] == 'formatting' and not (rule.get('find') and rule.get('valid')):
            messagebox.showerror(TITLE, 'Formatting rules need both a find and a valid regex.')
            return
        try:
            rules_store.validate_rule(rule)
        except ValueError as err:
            messagebox.showerror(TITLE, '%s' % err)
            return

        existing = self.rule_by_id(rule['id'])
        if self.editing_rule_id and rule['id'] != self.editing_rule_id:
            if existing is not None:
                messagebox.showerror(TITLE, 'A rule with ID "%s" already exists.' % rule['id'])
                return
            self.rules['rules'] = [r for r in self.rules['rules'] if r['id'] != self.editing_rule_id]
            existing = None
        if existing is not None and self.editing_rule_id is None:
            messagebox.showerror(TITLE, 'A rule with ID "%s" already exists — select it to edit.' % rule['id'])
            return
        if existing is not None:
            existing.clear()
            existing.update(rule)
        else:
            self.rules['rules'].append(rule)
        self.editing_rule_id = rule['id']
        self.populate_rule_widgets()
        self.rules_tree.selection_set(rule['id'])

    @guarded
    def delete_rule(self):
        selection = self.rules_tree.selection()
        if not selection:
            messagebox.showinfo(TITLE, 'Select a rule first.')
            return
        self.rules['rules'] = [r for r in self.rules['rules'] if r['id'] != selection[0]]
        self.editing_rule_id = None
        self.populate_rule_widgets()

    @guarded
    def generate_pattern(self):
        try:
            pattern = pattern_from_example(self.example_var.get(), self.variable_var.get())
        except ValueError as err:
            messagebox.showerror(TITLE, '%s' % err)
            return
        self.rule_vars['pattern'].set(pattern)
        if self.test_var.get():
            self.test_pattern()

    @guarded
    def test_pattern(self):
        pattern = self.rule_vars['pattern'].get()
        if not pattern:
            messagebox.showinfo(TITLE, 'Generate or type a pattern first.')
            return
        value = self.test_var.get()
        if re.search(pattern, value):
            self.test_result_var.set('"%s" MATCHES the pattern' % value)
        else:
            self.test_result_var.set('"%s" does NOT match the pattern' % value)

    @guarded
    def save_rules(self):
        form = {
            'projectName': self.project_name_var.get(),
            'projectNumber': self.project_number_var.get(),
            'client': self.client_var.get(),
            'sheetNamePattern': self.sheet_pattern_var.get(),
            'customWords': self.dictionary_text.get('1.0', 'end'),
        }
        try:
            self.rules = form_to_rules(self.rules, form)
        except ValueError as err:
            messagebox.showerror(TITLE, '%s' % err)
            return
        self.write_rules_file()
        self.populate_rule_widgets()
        self.run_check()
        self.notebook.select(0)

    @guarded
    def import_rules(self):
        path = filedialog.askopenfilename(filetypes=[('Rules file', '*.json')])
        if not path:
            return
        try:
            with io.open(path, 'r', encoding='utf-8') as fh:
                self.rules = rules_store.load_rules(fh.read())
        except (ValueError, IOError) as err:
            messagebox.showerror(TITLE, 'Could not import rules:\n%s' % err)
            return
        self.rules_path = path
        self.config['rules_path'] = path
        appconfig.save_config(self.config)
        self.populate_rule_widgets()
        self.run_check()

    @guarded
    def export_rules(self):
        path = self.ask_save_path('json', 'rules', 'Rules file')
        if not path:
            return
        with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(rules_store.dumps_rules(self.rules))
        messagebox.showinfo(TITLE, 'Rules exported to:\n%s\n\nThis file also works in the '
                                   'web Drawing Checker and the Revit checker.' % path)

    # ------------------------------------------------- project & dictionary

    def build_project_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text='Project & Dictionary')

        project = ttk.LabelFrame(tab, text='Project information (matched against title block; blank = skip)')
        project.pack(fill='x', padx=6, pady=6)
        self.project_name_var = tk.StringVar()
        self.project_number_var = tk.StringVar()
        self.client_var = tk.StringVar()
        for row, (label, variable) in enumerate((
                ('Project name', self.project_name_var),
                ('Project number', self.project_number_var),
                ('Client', self.client_var))):
            ttk.Label(project, text=label).grid(row=row, column=0, sticky='w', padx=6, pady=2)
            ttk.Entry(project, textvariable=variable, width=50).grid(row=row, column=1, padx=6, pady=2)

        naming = ttk.LabelFrame(tab, text='Layout (sheet) name pattern — regex, blank = disabled')
        naming.pack(fill='x', padx=6, pady=6)
        self.sheet_pattern_var = tk.StringVar()
        ttk.Entry(naming, textvariable=self.sheet_pattern_var, width=60).pack(anchor='w', padx=6, pady=4)

        dictionary = ttk.LabelFrame(tab, text='Custom dictionary (one word per line)')
        dictionary.pack(fill='both', expand=True, padx=6, pady=6)
        self.dictionary_text = tk.Text(dictionary, height=10)
        self.dictionary_text.pack(fill='both', expand=True, padx=6, pady=4)
        buttons = ttk.Frame(dictionary)
        buttons.pack(fill='x', padx=6, pady=4)
        ttk.Button(buttons, text='Import Dictionary…', command=self.import_dictionary).pack(side='left', padx=(0, 6))
        ttk.Button(buttons, text='Export Dictionary…', command=self.export_dictionary).pack(side='left', padx=(0, 12))
        ttk.Label(buttons, foreground='gray',
                  text='Click "Save Rules and Re-run" on the Rules tab to apply changes.').pack(side='left')

    @guarded
    def import_dictionary(self):
        path = filedialog.askopenfilename(filetypes=[('Word list', '*.txt')])
        if not path:
            return
        with io.open(path, 'r', encoding='utf-8') as fh:
            imported = parse_word_list(fh.read())
        existing = parse_word_list(self.dictionary_text.get('1.0', 'end'))
        added = [w for w in imported if w not in existing]
        self.dictionary_text.delete('1.0', 'end')
        self.dictionary_text.insert('1.0', '\n'.join(existing + added))
        messagebox.showinfo(TITLE, '%d word(s) added (%d already present).' % (
            len(added), len(imported) - len(added)))

    @guarded
    def export_dictionary(self):
        words = parse_word_list(self.dictionary_text.get('1.0', 'end'))
        path = self.ask_save_path('txt', 'custom_dictionary', 'Word list')
        if not path:
            return
        with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write('\n'.join(words) + ('\n' if words else ''))
        messagebox.showinfo(TITLE, 'Exported %d word(s) to:\n%s' % (len(words), path))

    # ------------------------------------------------------ find & replace

    def build_find_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text='Find & Replace')

        bar = ttk.Frame(tab)
        bar.pack(fill='x', padx=6, pady=6)
        ttk.Label(bar, text='Find:').pack(side='left')
        self.find_var = tk.StringVar()
        ttk.Entry(bar, textvariable=self.find_var, width=25).pack(side='left', padx=(4, 12))
        ttk.Label(bar, text='Replace with:').pack(side='left')
        self.replace_var = tk.StringVar()
        ttk.Entry(bar, textvariable=self.replace_var, width=25).pack(side='left', padx=(4, 12))
        self.match_case_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(bar, text='Match case', variable=self.match_case_var).pack(side='left')

        columns = ('sheet', 'matches', 'text')
        self.find_tree = ttk.Treeview(tab, columns=columns, show='headings', selectmode='browse')
        for column, width in zip(columns, (110, 70, 700)):
            self.find_tree.heading(column, text=column.title())
            self.find_tree.column(column, width=width, anchor='w')
        self.find_tree.pack(fill='both', expand=True, padx=6)
        self.find_tree.bind('<Double-1>', lambda e: self.zoom_match())

        actions = ttk.Frame(tab)
        actions.pack(fill='x', padx=6, pady=6)
        ttk.Button(actions, text='Find All', command=self.find_all).pack(side='left', padx=(0, 6))
        ttk.Button(actions, text='Replace All', command=self.replace_all).pack(side='left', padx=(0, 6))
        ttk.Button(actions, text='Zoom to Match', command=self.zoom_match).pack(side='left', padx=(0, 12))
        self.find_summary_var = tk.StringVar(
            value='Searches the text on all layouts (text notes only).')
        ttk.Label(actions, textvariable=self.find_summary_var, foreground='gray').pack(side='left')

        self.matches = []

    def current_matches(self):
        if self.snapshot is None:
            self.run_check()
        return find_matches(collect_text_entries(self.snapshot),
                            self.find_var.get(), self.match_case_var.get())

    def show_matches(self, matches):
        self.matches = matches
        self.find_tree.delete(*self.find_tree.get_children())
        for index, match in enumerate(matches):
            entry = match['entry']
            self.find_tree.insert('', 'end', iid=str(index), values=(
                entry.get('page') or '', match['count'], entry.get('text') or ''))
        total = sum(m['count'] for m in matches)
        self.find_summary_var.set('%d occurrence(s) in %d text object(s).' % (total, len(matches)))

    @guarded
    def find_all(self):
        if not self.find_var.get():
            messagebox.showinfo(TITLE, 'Type the text to find first.')
            return
        self.show_matches(self.current_matches())

    @guarded
    def replace_all(self):
        find = self.find_var.get()
        if not find:
            messagebox.showinfo(TITLE, 'Type the text to find first.')
            return
        matches = self.current_matches()
        if not matches:
            messagebox.showinfo(TITLE, 'No occurrences found.')
            return
        total = sum(m['count'] for m in matches)
        if not messagebox.askyesno(TITLE, 'Replace %d occurrence(s) of "%s" with "%s" in %d '
                                          'text object(s)?' % (total, find, self.replace_var.get(),
                                                               len(matches))):
            return
        handles = [m['entry'].get('elementId') for m in matches]
        changed, skipped = acad_actions.replace_in_texts(
            self.doc, handles, find, self.replace_var.get(), self.match_case_var.get())
        self.run_check()
        self.show_matches(self.current_matches())
        message = 'Updated %d text object(s).' % changed
        if skipped:
            message += ('\n%d object(s) were skipped (the match is interrupted by '
                        'inline formatting — edit those by hand).' % skipped)
        messagebox.showinfo(TITLE, message)

    @guarded
    def zoom_match(self):
        selection = self.find_tree.selection()
        if not selection:
            messagebox.showinfo(TITLE, 'Select a match first.')
            return
        entry = self.matches[int(selection[0])]['entry']
        layout_name = acad_adapter.layout_for_page(self.snapshot, entry.get('page'))
        acad_actions.zoom_to(self.acad, self.doc, entry.get('elementId'), layout_name)


def main():
    root = tk.Tk()
    try:
        CheckerApp(root)
    except RuntimeError as err:
        root.withdraw()
        messagebox.showerror(TITLE, '%s' % err)
        return 1
    root.mainloop()
    return 0


if __name__ == '__main__':
    sys.exit(main())
