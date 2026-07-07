# -*- coding: utf-8 -*-
"""COM adapter: reads the open Civil 3D / AutoCAD drawing into the same
model-snapshot shape the Revit adapter produces, so the shared rules
engine and spell checker run unchanged.

Mapping: paper-space layouts = sheets; title block = the attributed
block reference in each layout (attributes matched to rule labels);
DBText/MText entities = text notes. elementId carries the entity handle
(a string — the engine treats it as opaque). Each sheet dict also gets a
'layoutName' extra so actions can activate the right layout tab.
"""
import re

from .mtext import strip_mtext

_NORMALIZE_RE = re.compile(r'[^A-Z0-9]+')


def connect():
    """Attach to the running Civil 3D / AutoCAD session."""
    try:
        import win32com.client
    except ImportError:
        raise RuntimeError(
            'pywin32 is not installed. Run the launcher .bat once, or:\n'
            '  py -3 -m pip install pywin32')
    try:
        app = win32com.client.GetActiveObject('AutoCAD.Application')
    except Exception:
        raise RuntimeError(
            'Could not connect to Civil 3D / AutoCAD.\n'
            'Start Civil 3D, open the drawing, then run the checker again.')
    try:
        doc = app.ActiveDocument
    except Exception:
        raise RuntimeError('Civil 3D is running but no drawing is open.')
    return app, doc


def _normalize(label):
    return _NORMALIZE_RE.sub('', (label or '').upper())


def _match_attribute(attributes, label, param_map):
    """Find the attribute value for a rule label.

    Order: explicit paramMap tag, exact normalized match (DWG NO ->
    DWG_NO), then containment either way (DRAWING NUMBER ~ DWGNUMBER).
    Returns (found, value).
    """
    mapped = (param_map or {}).get(label)
    if mapped:
        for tag, value in attributes.items():
            if tag.upper() == mapped.upper():
                return True, value
        return False, None

    wanted = _normalize(label)
    if not wanted:
        return False, None
    normalized = dict((_normalize(tag), value) for tag, value in attributes.items())
    if wanted in normalized:
        return True, normalized[wanted]
    for tag, value in normalized.items():
        if wanted in tag or (len(tag) >= 3 and tag in wanted):
            return True, value
    return False, None


def _iter_layouts(doc):
    layouts = []
    for i in range(doc.Layouts.Count):
        layout = doc.Layouts.Item(i)
        if not layout.ModelType:
            layouts.append(layout)
    layouts.sort(key=lambda l: l.TabOrder)
    return layouts


def _collect_layout(layout):
    """Text entities and title-block attributes of one layout."""
    texts = []
    attributes = {}
    block = layout.Block
    for j in range(block.Count):
        entity = block.Item(j)
        object_name = entity.ObjectName
        if object_name == 'AcDbText':
            value = entity.TextString
            if value and value.strip():
                texts.append({'elementId': str(entity.Handle), 'text': value.strip()})
        elif object_name == 'AcDbMText':
            value = strip_mtext(entity.TextString)
            if value and value.strip():
                texts.append({'elementId': str(entity.Handle), 'text': value.strip()})
        elif object_name == 'AcDbBlockReference':
            try:
                has_attributes = entity.HasAttributes
            except Exception:
                has_attributes = False
            if has_attributes:
                for attribute in entity.GetAttributes():
                    tag = attribute.TagString
                    if tag and tag not in attributes:
                        attributes[tag] = attribute.TextString
    return texts, attributes


def build_snapshot(doc, rules_config):
    revit_settings = rules_config.get('revit') or {}
    param_map = revit_settings.get('paramMap') or {}
    field_rules = [
        r for r in rules_config.get('rules', [])
        if r.get('enabled') and r.get('category') in ('titleBlock', 'revision')
    ]
    dwg_rule = next((r for r in field_rules if r['id'] == 'dwgNo'), None)
    other_rules = [r for r in field_rules if r['id'] != 'dwgNo']
    project_fields = rules_config.get('project') or []

    snapshot = {
        'docTitle': doc.Name,
        'projectInfo': {},
        'sheets': [],
    }
    project_info = {}

    for layout in _iter_layouts(doc):
        texts, attributes = _collect_layout(layout)

        number = layout.Name
        if dwg_rule is not None:
            found, value = _match_attribute(attributes, dwg_rule['label'], param_map)
            if found and value and value.strip():
                number = value.strip()

        params = {}
        missing = []
        for rule in other_rules:
            found, value = _match_attribute(attributes, rule['label'], param_map)
            if found:
                params[rule['id']] = value
            else:
                missing.append(rule['id'])

        for field in project_fields:
            if project_info.get(field['id']):
                continue
            found, value = _match_attribute(attributes, field['label'], param_map)
            if found and value and value.strip():
                project_info[field['id']] = value.strip()

        snapshot['sheets'].append({
            'elementId': None,
            'layoutName': layout.Name,
            'number': number,
            'name': layout.Name,
            'params': params,
            'missingParams': missing,
            'textNotes': texts,
            'placedViews': [],
            'schedules': [],
        })

    snapshot['projectInfo'] = project_info
    return snapshot


def layout_for_page(snapshot, page):
    for sheet in snapshot.get('sheets', []):
        if sheet.get('number') == page:
            return sheet.get('layoutName')
    return None
