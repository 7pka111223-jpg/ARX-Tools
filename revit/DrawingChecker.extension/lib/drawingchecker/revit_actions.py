# -*- coding: utf-8 -*-
"""Write-side Revit operations for the checker window.

Like revit_adapter, every Revit import is deferred so the package stays
importable headlessly. These are the only functions that modify the model,
each inside its own Transaction.
"""
from __future__ import unicode_literals


def make_element_id(element_id_int):
    """Build an ElementId from a plain int.

    Revit 2024+ has ElementId(Int64) alongside the BuiltInParameter/
    BuiltInCategory enum constructors, which makes ElementId(python int)
    ambiguous under IronPython ("Multiple targets could match"). Passing
    an explicit System.Int64 disambiguates; older Revits take Int32.
    """
    import System
    from Autodesk.Revit.DB import ElementId

    try:
        return ElementId(System.Int64(element_id_int))
    except TypeError:
        return ElementId(System.Int32(element_id_int))


def select_and_show(uidoc, element_id_int):
    """Select the element and ask Revit to show it (zoom/open view)."""
    from System.Collections.Generic import List
    from Autodesk.Revit.DB import ElementId

    element_id = make_element_id(element_id_int)
    if uidoc.Document.GetElement(element_id) is None:
        return False
    ids = List[ElementId]()
    ids.Add(element_id)
    uidoc.Selection.SetElementIds(ids)
    try:
        uidoc.ShowElements(element_id)
    except Exception:
        pass  # some views cannot be activated while a dialog is open
    return True


def _note_owner_map(snapshot):
    """text note elementId -> owning view/sheet elementId, from the snapshot."""
    owners = {}
    for sheet in snapshot.get('sheets', []):
        for note in sheet.get('textNotes', []):
            owners[note.get('elementId')] = sheet.get('elementId')
        for view in sheet.get('placedViews', []):
            for note in view.get('textNotes', []):
                owners[note.get('elementId')] = view.get('elementId')
    owners.pop(None, None)
    return owners


def _default_text_type_id(doc):
    from Autodesk.Revit.DB import (
        ElementId,
        ElementTypeGroup,
        FilteredElementCollector,
        TextNoteType,
    )

    type_id = doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType)
    if type_id is not None and type_id != ElementId.InvalidElementId:
        return type_id
    for note_type in FilteredElementCollector(doc).OfClass(TextNoteType):
        return note_type.Id
    return None


def _marker_text(issues_for_target):
    lines = []
    for issue in issues_for_target:
        lines.append('>> %s: %s' % (issue['severity'].upper(), issue['message']))
    return '\r'.join(lines)


def _try_paint_red(doc, view, element_id):
    from Autodesk.Revit.DB import Color, OverrideGraphicSettings

    try:
        settings = OverrideGraphicSettings()
        settings.SetProjectionLineColor(Color(255, 0, 0))
        view.SetElementOverrides(element_id, settings)
    except Exception:
        pass  # color is cosmetic; never fail the export over it


def export_annotated_pdf(doc, snapshot, issues, folder, file_name):
    """Export every checked sheet to one combined PDF with the mistakes
    written on the drawings as red '>>' markers.

    Markers next to each flagged text note, plus a summary block on each
    sheet listing its other issues (bad sheet number, missing fields,
    naming problems); project-level issues go on the first sheet. The
    markers are temporary: they are created, the PDF is exported, and
    they are always deleted again (the model ends unchanged; the two
    steps appear in the undo history).

    Returns (sheet_count, marker_count). Requires Revit 2022+ (native
    PDF export API).
    """
    from System.Collections.Generic import List
    from Autodesk.Revit.DB import ElementId, TextNote, Transaction, XYZ

    try:
        from Autodesk.Revit.DB import PDFExportOptions
    except ImportError:
        raise RuntimeError('PDF export needs Revit 2022 or newer.')

    sheets = snapshot.get('sheets', [])
    if not sheets:
        raise RuntimeError('No sheets to export.')

    owners = _note_owner_map(snapshot)

    # issues attached to a text note -> marker at the note
    note_issues = {}
    # everything else lands in the owning sheet's summary block
    sheet_blocks = {}
    for issue in issues:
        element_id = issue.get('elementId')
        if element_id in owners:
            note_issues.setdefault(element_id, []).append(issue)
        else:
            page = issue.get('page') or sheets[0].get('number')
            sheet_blocks.setdefault(page, []).append(issue)

    created = List[ElementId]()
    marker_count = 0
    transaction = Transaction(doc, 'ARX Drawing Checker — PDF annotations')
    transaction.Start()
    try:
        type_id = _default_text_type_id(doc)
        if type_id is None:
            raise RuntimeError('The model has no text note type to annotate with.')

        for note_id, note_issue_list in note_issues.items():
            note = doc.GetElement(make_element_id(note_id))
            if note is None:
                continue
            view = doc.GetElement(note.OwnerViewId)
            box = note.get_BoundingBox(view) if view is not None else None
            if box is None:
                continue
            position = XYZ(box.Max.X, box.Max.Y, 0)
            marker = TextNote.Create(doc, view.Id, position,
                                     _marker_text(note_issue_list), type_id)
            _try_paint_red(doc, view, marker.Id)
            created.Add(marker.Id)
            marker_count += 1

        for sheet in sheets:
            block_issues = sheet_blocks.get(sheet.get('number'))
            if not block_issues:
                continue
            sheet_element = doc.GetElement(make_element_id(sheet['elementId']))
            if sheet_element is None:
                continue
            outline = sheet_element.Outline
            position = XYZ(outline.Min.U + 0.03, outline.Max.V - 0.03, 0)
            block_text = 'ARX DRAWING CHECK — %d ISSUE(S)\r%s' % (
                len(block_issues), _marker_text(block_issues))
            marker = TextNote.Create(doc, sheet_element.Id, position, block_text, type_id)
            _try_paint_red(doc, sheet_element, marker.Id)
            created.Add(marker.Id)
            marker_count += 1

        transaction.Commit()
    except Exception:
        transaction.RollBack()
        raise

    try:
        options = PDFExportOptions()
        options.Combine = True
        options.FileName = file_name
        sheet_ids = List[ElementId]()
        for sheet in sheets:
            sheet_ids.Add(make_element_id(sheet['elementId']))
        if not doc.Export(folder, sheet_ids, options):
            raise RuntimeError('Revit reported that the PDF export failed.')
    finally:
        cleanup = Transaction(doc, 'ARX Drawing Checker — remove annotations')
        cleanup.Start()
        try:
            for element_id in created:
                if doc.GetElement(element_id) is not None:
                    doc.Delete(element_id)
            cleanup.Commit()
        except Exception:
            cleanup.RollBack()

    return len(sheets), marker_count


def replace_in_text_notes(doc, replacements):
    """Apply [(elementId, newText)] to TextNotes in one transaction."""
    from Autodesk.Revit.DB import Transaction

    changed = 0
    transaction = Transaction(doc, 'ARX Drawing Checker — Find & Replace')
    transaction.Start()
    try:
        for element_id_int, new_text in replacements:
            note = doc.GetElement(make_element_id(element_id_int))
            if note is None:
                continue
            if note.Text != new_text:
                note.Text = new_text
                changed += 1
        transaction.Commit()
    except Exception:
        transaction.RollBack()
        raise
    return changed


