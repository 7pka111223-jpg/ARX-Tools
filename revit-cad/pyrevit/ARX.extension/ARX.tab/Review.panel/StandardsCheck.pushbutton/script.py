# -*- coding: utf-8 -*-
"""Standards & Naming Check — the Rule Check analog for Revit.

Runs the shared rule-from-example engine over model *names* (sheet numbers, view
names) rather than placed text, so naming conventions are validated with the same
patterns the PDF tool uses. Read-only.
"""
__title__ = "Standards\nCheck"
__author__ = "ARX"

import os

from pyrevit import revit, forms, script

import arx_rulecore as arx
from arx_rulecore import extract

output = script.get_output()
doc = revit.doc


def main():
    path = os.path.join(os.path.dirname(__file__), "arx-rules.json")
    if not os.path.exists(path):
        path = forms.pick_file(file_ext="json", title="Select arx-rules.json")
        if not path:
            return
    config = arx.load_rules(path)

    pages = extract.collect_names(doc)        # synthetic 'sheets'/'views' pages
    issues = arx.evaluate_rules(pages, config)

    output.print_md("# ARX Standards & Naming Check")
    output.print_md("**{}** issue(s).".format(len(issues)))
    if issues:
        output.print_table(
            table_data=[[i["severity"], i["category"], i["page"], i.get("foundText") or "", i["message"]]
                        for i in issues],
            columns=["Severity", "Category", "Group", "Found", "Message"])
    else:
        output.print_md(":white_heavy_check_mark: All names conform.")


main()
