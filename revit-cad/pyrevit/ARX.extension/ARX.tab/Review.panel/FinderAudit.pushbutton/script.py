# -*- coding: utf-8 -*-
"""Finder & Audit — the Signature Checker analog for Revit.

Two read-only utilities:
  * Finder: list every placement of a chosen family type (the BIM analog of
    "find this stamp/signature across the set").
  * Audit: a one-click model-health snapshot from doc.GetWarnings().
"""
__title__ = "Finder &\nAudit"
__author__ = "ARX"

from pyrevit import revit, forms, script, DB

output = script.get_output()
doc = revit.doc


def run_audit():
    warnings = doc.GetWarnings()
    output.print_md("# Model Audit — {} warning(s)".format(len(warnings)))
    rows = []
    for w in warnings:
        ids = list(w.GetFailingElements())
        rows.append([w.GetDescriptionText(), len(ids),
                     ", ".join(output.linkify(i) for i in ids[:5])])
    if rows:
        output.print_table(table_data=rows, columns=["Warning", "#Elements", "Examples"])
    else:
        output.print_md(":white_heavy_check_mark: No warnings.")


def run_finder():
    symbols = list(DB.FilteredElementCollector(doc).OfClass(DB.FamilySymbol))
    choices = {"{} : {}".format(s.FamilyName, DB.Element.Name.GetValue(s)): s for s in symbols}
    pick = forms.SelectFromList.show(sorted(choices), title="Find which family type?")
    if not pick:
        return
    sym = choices[pick]
    instances = (DB.FilteredElementCollector(doc)
                 .OfClass(DB.FamilyInstance)
                 .WhereElementIsNotElementType())
    placed = [i for i in instances if i.Symbol and i.Symbol.Id == sym.Id]
    output.print_md("# Finder — '{}' placed {} time(s)".format(pick, len(placed)))
    if placed:
        output.print_table(
            table_data=[[output.linkify(i.Id),
                         (doc.GetElement(i.OwnerViewId).Name if i.OwnerViewId and
                          doc.GetElement(i.OwnerViewId) else "model")]
                        for i in placed],
            columns=["Instance", "View"])


def main():
    mode = forms.CommandSwitchWindow.show(["Model Audit", "Find Family Type"],
                                          message="Choose:")
    if mode == "Model Audit":
        run_audit()
    elif mode == "Find Family Type":
        run_finder()


main()
