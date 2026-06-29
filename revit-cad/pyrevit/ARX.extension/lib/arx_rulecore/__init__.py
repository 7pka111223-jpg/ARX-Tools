"""arx_rulecore — host-agnostic rule/spell engine shared by the PDF tool (via its
JS twin), this pyRevit extension, and a future AutoCAD add-in.

Only ``extract`` is Revit-coupled; everything else is pure Python and tested
without Revit installed.
"""

from .util import escape_regex, escape_html
from .pattern_builder import build_pattern, to_runs, run_to_pattern, run_to_loose
from .title_block import locate_fields_on_page, compute_region_box
from .rules_engine import (
    evaluate_rules,
    evaluate_field_rules,
    evaluate_formatting_rules,
    evaluate_project_rules,
)
from .speller import check_spelling, words_of, SetSpeller, load_dic_speller
from .rules_io import load_rules, save_rules, normalize_rules
from .report import issues_to_csv, issues_to_html

__all__ = [
    "escape_regex", "escape_html",
    "build_pattern", "to_runs", "run_to_pattern", "run_to_loose",
    "locate_fields_on_page", "compute_region_box",
    "evaluate_rules", "evaluate_field_rules", "evaluate_formatting_rules",
    "evaluate_project_rules",
    "check_spelling", "words_of", "SetSpeller", "load_dic_speller",
    "load_rules", "save_rules", "normalize_rules",
    "issues_to_csv", "issues_to_html",
]

__version__ = "0.1.0"
