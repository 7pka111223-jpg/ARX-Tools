# -*- coding: utf-8 -*-
"""Shift+Click configuration: pick the rules file and custom dictionary.

Paths are stored in the pyRevit user config; when unset the checker falls
back to %APPDATA%/ARX-Tools/rules.json and finally the bundled defaults.
"""
from __future__ import unicode_literals

from pyrevit import forms, script

config = script.get_config()

PICK_RULES = 'Pick rules file (rules.json)'
PICK_DICTIONARY = 'Pick custom dictionary (one word per line)'
CLEAR = 'Clear configured paths (use defaults)'
SHOW = 'Show current configuration'


def main():
    choice = forms.CommandSwitchWindow.show(
        [PICK_RULES, PICK_DICTIONARY, CLEAR, SHOW],
        message='ARX Drawing Checker configuration',
    )
    if choice == PICK_RULES:
        path = forms.pick_file(file_ext='json')
        if path:
            config.rules_path = path
            script.save_config()
    elif choice == PICK_DICTIONARY:
        path = forms.pick_file(file_ext='txt')
        if path:
            config.custom_dictionary_path = path
            script.save_config()
    elif choice == CLEAR:
        config.rules_path = None
        config.custom_dictionary_path = None
        script.save_config()
    elif choice == SHOW:
        forms.alert(
            'Rules file: %s\nCustom dictionary: %s'
            % (
                config.get_option('rules_path', None) or '(default)',
                config.get_option('custom_dictionary_path', None) or '(none)',
            ),
            title='ARX Drawing Checker',
        )


if __name__ == '__main__':
    main()
