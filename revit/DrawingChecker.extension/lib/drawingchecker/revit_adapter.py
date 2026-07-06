# -*- coding: utf-8 -*-
"""The only module that touches the Revit API.

Builds a plain-dict "model snapshot" of sheets, parameters, text notes,
placed views and schedules, which the pure-Python engine consumes. All
Revit imports are deferred inside functions so `import drawingchecker`
still works headlessly for unit tests. Everything here is read-only — no
Transaction is needed.
"""
from __future__ import unicode_literals

# Rule id -> BuiltInParameter name on ViewSheet. Tried first; if absent the
# adapter falls back to LookupParameter with the rule label / paramMap.
BUILTIN_PARAM_NAMES = {
    'rev': 'SHEET_CURRENT_REVISION',
    'date': 'SHEET_ISSUE_DATE',
    'drawnBy': 'SHEET_DRAWN_BY',
    'checkedBy': 'SHEET_CHECKED_BY',
    'approvedBy': 'SHEET_APPROVED_BY',
}


def _element_id_value(element_id):
    # Revit 2024+ exposes ElementId.Value; older versions IntegerValue.
    value = getattr(element_id, 'Value', None)
    if value is None:
        value = element_id.IntegerValue
    return int(value)


def _param_value(param):
    if param is None:
        return None
    value = param.AsString()
    if value is None:
        try:
            value = param.AsValueString()
        except Exception:
            value = None
    return value


def _lookup_labels(label, param_map):
    """Candidate parameter names for LookupParameter, in order."""
    labels = []
    mapped = (param_map or {}).get(label)
    if mapped:
        labels.append(mapped)
    labels.append(label)
    title_cased = ' '.join(w.capitalize() for w in label.split())
    if title_cased not in labels:
        labels.append(title_cased)
    return labels


def _resolve_sheet_param(sheet, rule, param_map):
    """BuiltInParameter first, then LookupParameter fallbacks.

    Returns (found, value): found is False when no parameter exists on the
    sheet at all (reported as a distinct warn, not a missing value).
    """
    from Autodesk.Revit.DB import BuiltInParameter

    param = None
    bip_name = BUILTIN_PARAM_NAMES.get(rule['id'])
    if bip_name and hasattr(BuiltInParameter, bip_name):
        param = sheet.get_Parameter(getattr(BuiltInParameter, bip_name))
    if param is None:
        for label in _lookup_labels(rule['label'], param_map):
            param = sheet.LookupParameter(label)
            if param is not None:
                break
    if param is None:
        return False, None
    return True, _param_value(param)


def _text_notes_in(doc, view_id):
    from Autodesk.Revit.DB import FilteredElementCollector, TextNote

    notes = []
    for note in FilteredElementCollector(doc, view_id).OfClass(TextNote):
        text = (note.Text or '').strip()
        if text:
            notes.append({'elementId': _element_id_value(note.Id), 'text': text})
    return notes


def build_snapshot(doc, rules_config):
    """Extract everything the checks need from the open document."""
    from Autodesk.Revit.DB import (
        FilteredElementCollector,
        ScheduleSheetInstance,
        ViewSheet,
    )

    revit_settings = rules_config.get('revit') or {}
    param_map = revit_settings.get('paramMap') or {}
    field_rules = [
        r for r in rules_config.get('rules', [])
        if r.get('enabled') and r.get('category') in ('titleBlock', 'revision') and r.get('id') != 'dwgNo'
    ]

    info = doc.ProjectInformation
    snapshot = {
        'docTitle': doc.Title,
        'projectInfo': {
            'name': getattr(info, 'Name', None),
            'number': getattr(info, 'Number', None),
            'client': getattr(info, 'ClientName', None),
        },
        'sheets': [],
    }

    collector = FilteredElementCollector(doc).OfClass(ViewSheet).WhereElementIsNotElementType()
    for sheet in sorted(collector, key=lambda s: s.SheetNumber):
        if getattr(sheet, 'IsPlaceholder', False):
            continue

        params = {}
        missing = []
        for rule in field_rules:
            found, value = _resolve_sheet_param(sheet, rule, param_map)
            if found:
                params[rule['id']] = value
            else:
                missing.append(rule['id'])

        placed_views = []
        for view_id in sheet.GetAllPlacedViews():
            view = doc.GetElement(view_id)
            if view is None:
                continue
            placed_views.append({
                'elementId': _element_id_value(view_id),
                'name': view.Name,
                'textNotes': _text_notes_in(doc, view_id),
            })

        schedules = []
        seen_schedule_ids = set()
        for instance in FilteredElementCollector(doc, sheet.Id).OfClass(ScheduleSheetInstance):
            schedule = doc.GetElement(instance.ScheduleId)
            if schedule is None:
                continue
            schedule_id = _element_id_value(schedule.Id)
            if schedule_id in seen_schedule_ids:
                continue  # a schedule split into segments places multiple instances
            if getattr(schedule, 'IsTitleblockRevisionSchedule', False):
                continue
            seen_schedule_ids.add(schedule_id)
            schedules.append({'elementId': schedule_id, 'name': schedule.Name})

        snapshot['sheets'].append({
            'elementId': _element_id_value(sheet.Id),
            'number': sheet.SheetNumber,
            'name': sheet.Name,
            'params': params,
            'missingParams': missing,
            'textNotes': _text_notes_in(doc, sheet.Id),
            'placedViews': placed_views,
            'schedules': schedules,
        })

    return snapshot
