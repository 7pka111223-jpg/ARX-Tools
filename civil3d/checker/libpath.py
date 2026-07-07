# -*- coding: utf-8 -*-
"""Locate the shared drawingchecker library.

The canonical copy lives in the pyRevit extension
(revit/DrawingChecker.extension/lib); the deployed Civil 3D zip carries
its own copy in ./lib. Both tools share the same rules engine, spell
checker, pattern builder and rules.json format.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))

_CANDIDATES = (
    os.path.normpath(os.path.join(_HERE, '..', 'lib')),                       # deployed zip
    os.path.normpath(os.path.join(_HERE, '..', '..', 'revit',
                                  'DrawingChecker.extension', 'lib')),         # repo layout
)


def add_lib_to_path():
    for candidate in _CANDIDATES:
        if os.path.isdir(os.path.join(candidate, 'drawingchecker')):
            if candidate not in sys.path:
                sys.path.insert(0, candidate)
            return candidate
    raise RuntimeError('Could not find the drawingchecker library next to the checker.')
