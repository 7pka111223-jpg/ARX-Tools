# -*- coding: utf-8 -*-
"""Pure-Python core of the ARX Revit Drawing Checker.

Every module in this package must stay importable without Revit: the only
Revit-API code lives in revit_adapter, and its imports are deferred inside
the functions so the package can be unit-tested headlessly under CPython 3
while still running under pyRevit's IronPython 2.7.
"""
