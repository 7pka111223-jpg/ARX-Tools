# -*- coding: utf-8 -*-
"""Tiny JSON config for the Civil 3D checker (rules path, export dir),
stored next to the shared rules at %APPDATA%/ARX-Tools/."""
import io
import json
import os

_FILE_NAME = 'civil3d_config.json'


def _config_path():
    appdata = os.environ.get('APPDATA') or os.path.expanduser('~')
    return os.path.join(appdata, 'ARX-Tools', _FILE_NAME)


def load_config():
    try:
        with io.open(_config_path(), 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (IOError, OSError, ValueError):
        return {}


def save_config(config):
    path = _config_path()
    directory = os.path.dirname(path)
    if not os.path.isdir(directory):
        os.makedirs(directory)
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(config, fh, indent=2)
