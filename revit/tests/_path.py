# -*- coding: utf-8 -*-
"""Make the extension's lib/ importable in headless test runs.

Inside Revit, pyRevit adds the extension's lib/ directory to sys.path
automatically; the tests replicate that here.
"""
import os
import sys

LIB_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'DrawingChecker.extension', 'lib'
)
LIB_DIR = os.path.normpath(LIB_DIR)
if LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
