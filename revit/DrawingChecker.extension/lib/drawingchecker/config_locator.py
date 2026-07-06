# -*- coding: utf-8 -*-
"""Locate the rules file and user dictionary the checker should use."""
from __future__ import unicode_literals

import os

from drawingchecker.wordlist import DATA_DIR

BUNDLED_DEFAULT_RULES_PATH = os.path.join(DATA_DIR, 'default_rules.json')

APPDATA_DIR_NAME = 'ARX-Tools'
RULES_FILE_NAME = 'rules.json'
CUSTOM_DICTIONARY_FILE_NAME = 'custom_dictionary.txt'


def _appdata_path(file_name):
    appdata = os.environ.get('APPDATA')
    if not appdata:
        return None
    return os.path.join(appdata, APPDATA_DIR_NAME, file_name)


def find_rules_path(configured_path=None):
    """Search order: path picked via the button's Shift+Click config, then
    %APPDATA%/ARX-Tools/rules.json, then the bundled defaults."""
    for candidate in (configured_path, _appdata_path(RULES_FILE_NAME)):
        if candidate and os.path.isfile(candidate):
            return candidate
    return BUNDLED_DEFAULT_RULES_PATH


def find_custom_dictionary_path(configured_path=None):
    """Same search order for the optional user dictionary; None if absent."""
    for candidate in (configured_path, _appdata_path(CUSTOM_DICTIONARY_FILE_NAME)):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None
