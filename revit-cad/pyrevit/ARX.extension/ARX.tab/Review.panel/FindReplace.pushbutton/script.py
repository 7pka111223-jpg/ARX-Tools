# -*- coding: utf-8 -*-
"""Batch Text Find & Replace — the PDF Text Editor analog for Revit.

Previews every matching TextNote, then applies the replacement inside a single
transaction (one undo). Honour-the-original-formatting caveat: TextNote.Text is
the flattened string; formatted runs (bold/underline segments) and
parameter-driven tags are out of scope here and skipped.
"""
__title__ = "Find &\nReplace"
__author__ = "ARX"

import re

from pyrevit import revit, forms, script, DB

from arx_rulecore import extract

output = script.get_output()
doc = revit.doc


def _matcher(find, case_sensitive, whole_word):
    pat = re.escape(find)
    if whole_word:
        pat = r"(?<![A-Za-z0-9])" + pat + r"(?![A-Za-z0-9])"
    return re.compile(pat, 0 if case_sensitive else re.IGNORECASE)


def main():
    find = forms.ask_for_string(prompt="Find text", title="Find & Replace")
    if not find:
        return
    repl = forms.ask_for_string(prompt="Replace with", default="", title="Find & Replace") or ""
    opts = forms.SelectFromList.show(
        ["Match case", "Whole word only"], title="Options", multiselect=True) or []
    rx = _matcher(find, "Match case" in opts, "Whole word only" in opts)

    hits = []
    for el_id, text in extract.collect_textnotes(doc):
        if rx.search(text):
            hits.append((el_id, text, rx.sub(repl, text)))

    if not hits:
        forms.alert("No matches for '{}'.".format(find), exitscript=True)

    output.print_md("# Find & Replace preview — {} match(es)".format(len(hits)))
    output.print_table(
        table_data=[[output.linkify(DB.ElementId(eid)), old, new] for eid, old, new in hits],
        columns=["Element", "Before", "After"])

    if not forms.alert("Apply {} replacement(s)?".format(len(hits)), yes=True, no=True):
        return

    with revit.Transaction("ARX find & replace"):
        for el_id, _old, new in hits:
            tn = doc.GetElement(DB.ElementId(el_id))
            if tn is not None:
                tn.Text = new
    forms.alert("Replaced text in {} TextNote(s).".format(len(hits)))


main()
