# -*- coding: utf-8 -*-
"""Model & Sheet QA — the Drawing Checker analog for Revit.

Runs the shared rule core over every sheet: title-block / project-field rules,
formatting rules and spelling. Shows a clickable issue table and offers HTML/CSV
export. Read-only (no model changes).
"""
__title__ = "Model &\nSheet QA"
__author__ = "ARX"

import os

from pyrevit import revit, forms, script

import arx_rulecore as arx
from arx_rulecore import extract

output = script.get_output()
doc = revit.doc


def _load_config():
    bundled = os.path.join(os.path.dirname(__file__), "arx-rules.json")
    if os.path.exists(bundled):
        return arx.load_rules(bundled)
    path = forms.pick_file(file_ext="json", title="Select arx-rules.json")
    if not path:
        script.exit()
    return arx.load_rules(path)


def _build_speller(config):
    # Prefer a bundled Hunspell .dic; fall back to an empty speller (everything
    # flagged) so the user notices the dictionary is missing.
    dic = os.path.join(os.path.dirname(__file__), "en_US.dic")
    speller = arx.load_dic_speller(dic) if os.path.exists(dic) else arx.SetSpeller([])
    return speller


def main():
    config = _load_config()
    pages = extract.collect_pages(doc)
    if not pages:
        forms.alert("No sheets found in this model.", exitscript=True)

    issues = arx.evaluate_rules(pages, config)
    speller = _build_speller(config)
    custom = config.get("spelling", {}).get("custom", [])
    issues += arx.check_spelling(arx.words_of(pages), speller, custom_dictionary=custom)

    output.print_md("# ARX Model & Sheet QA")
    output.print_md("**{}** sheet(s) checked — **{}** issue(s).".format(len(pages), len(issues)))
    if not issues:
        output.print_md(":white_heavy_check_mark: No issues found.")
        return

    rows = [[i["severity"], i["category"], i["page"], i.get("foundText") or "", i["message"]]
            for i in issues]
    output.print_table(table_data=rows,
                       columns=["Severity", "Category", "Sheet", "Found", "Message"])

    if forms.alert("Export report?", yes=True, no=True):
        dest = forms.save_file(file_ext="html")
        if dest:
            with open(dest, "w") as fh:
                fh.write(arx.issues_to_html(issues, "ARX Model & Sheet QA"))
            with open(os.path.splitext(dest)[0] + ".csv", "w") as fh:
                fh.write(arx.issues_to_csv(issues))
            forms.alert("Saved HTML + CSV next to:\n{}".format(dest))


main()
