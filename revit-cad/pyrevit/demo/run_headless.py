"""End-to-end demo of the shared rule core WITHOUT Revit.

It feeds hand-built "pages" (the same shape extract.collect_pages produces inside
Revit) through the full pipeline — rule evaluation + spelling — and writes CSV
and HTML reports. This proves the host-agnostic core runs identically off-Revit.

    PYTHONPATH=ARX.extension/lib python3 demo/run_headless.py
"""

import json
import os
import sys

import arx_rulecore as arx

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def fake_pages():
    """Two 'sheets': one clean, one with a wrong project, bad drawing no,
    badly formatted revision and a misspelling."""
    def page(num, items):
        return {"pageNumber": num, "width": 100.0, "height": 100.0,
                "items": [{"text": t, "x": 80.0, "y": 80.0} for t in items]}

    good = page("A-101", [
        "PROJECT: RIYADH-METRO", "DWG NO: J2501-JPD-EBH-DG-20100",
        "REV A", "General arrangement of the concrete invert.",
    ])
    bad = page("A-102", [
        "PROJECT: DUBAI-TRAM", "DWG NO: J2501-JPD-EBH-DG-2010X",
        "REV b", "Reinforcment detail at chainage 1+200.",
    ])
    return [good, bad]


def main():
    config = arx.load_rules(os.path.join(ROOT, "sample", "arx-rules.json"))
    pages = fake_pages()

    issues = arx.evaluate_rules(pages, config)

    # A tiny demo dictionary; real deployments load a Hunspell .dic via
    # arx.load_dic_speller(...). "Reinforcment" (sic) is intentionally absent.
    speller = arx.SetSpeller([
        "project", "dwg", "no", "rev", "general", "arrangement", "of", "the",
        "concrete", "invert", "reinforcement", "detail", "at", "chainage",
    ])
    custom = config.get("spelling", {}).get("custom", [])
    issues += arx.check_spelling(arx.words_of(pages), speller, custom_dictionary=custom)

    print("== ARX Revit/CAD rule core — headless demo ==")
    print("pages: %d   issues: %d\n" % (len(pages), len(issues)))
    for it in issues:
        print("  [%-5s] %-10s sheet %-6s %s"
              % (it["severity"], it["category"], it["page"], it["message"]))

    out_csv = os.path.join(HERE, "report.csv")
    out_html = os.path.join(HERE, "report.html")
    with open(out_csv, "w") as fh:
        fh.write(arx.issues_to_csv(issues))
    with open(out_html, "w") as fh:
        fh.write(arx.issues_to_html(issues, "ARX Review — demo"))
    print("\nwrote %s and %s" % (os.path.relpath(out_csv, ROOT), os.path.relpath(out_html, ROOT)))

    # Non-zero exit if anything fails, so this doubles as a smoke test.
    return 0 if issues else 1


if __name__ == "__main__":
    sys.exit(main())
