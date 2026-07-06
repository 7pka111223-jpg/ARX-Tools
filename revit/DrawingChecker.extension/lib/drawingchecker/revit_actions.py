# -*- coding: utf-8 -*-
"""Write-side Revit operations for the checker window.

Like revit_adapter, every Revit import is deferred so the package stays
importable headlessly. These are the only functions that modify the model,
each inside its own Transaction.
"""
from __future__ import unicode_literals


def select_and_show(uidoc, element_id_int):
    """Select the element and ask Revit to show it (zoom/open view)."""
    from System.Collections.Generic import List
    from Autodesk.Revit.DB import ElementId

    element_id = ElementId(element_id_int)
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


def replace_in_text_notes(doc, replacements):
    """Apply [(elementId, newText)] to TextNotes in one transaction."""
    from Autodesk.Revit.DB import ElementId, Transaction

    changed = 0
    transaction = Transaction(doc, 'ARX Drawing Checker — Find & Replace')
    transaction.Start()
    try:
        for element_id_int, new_text in replacements:
            note = doc.GetElement(ElementId(element_id_int))
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


def _cloud_curves(view, box, pad):
    """Rectangle of lines around a bounding box, in the view's plane."""
    from Autodesk.Revit.DB import Line

    right = view.RightDirection
    up = view.UpDirection
    diagonal = box.Max - box.Min
    width = diagonal.DotProduct(right)
    height = diagonal.DotProduct(up)
    if abs(width) < 1e-6 or abs(height) < 1e-6:
        return None

    p1 = box.Min - right * pad - up * pad
    p2 = p1 + right * (width + 2 * pad)
    p3 = p2 + up * (height + 2 * pad)
    p4 = p1 + up * (height + 2 * pad)
    return [
        Line.CreateBound(p1, p2),
        Line.CreateBound(p2, p3),
        Line.CreateBound(p3, p4),
        Line.CreateBound(p4, p1),
    ]


def cloud_elements(doc, element_id_ints, description='ARX Drawing Check'):
    """Draw a revision cloud around each element in its owner view.

    Creates one new revision (so the clouds are easy to filter/delete
    later) and returns (clouded, skipped).
    """
    from System.Collections.Generic import List
    from Autodesk.Revit.DB import Curve, ElementId, Revision, RevisionCloud, Transaction

    clouded = 0
    skipped = 0
    transaction = Transaction(doc, 'ARX Drawing Checker — Cloud issues')
    transaction.Start()
    try:
        revision = Revision.Create(doc)
        revision.Description = description
        for element_id_int in set(element_id_ints):
            try:
                element = doc.GetElement(ElementId(element_id_int))
                if element is None:
                    skipped += 1
                    continue
                view = doc.GetElement(element.OwnerViewId)
                box = element.get_BoundingBox(view)
                if view is None or box is None:
                    skipped += 1
                    continue
                curves = _cloud_curves(view, box, pad=0.05)
                if curves is None:
                    skipped += 1
                    continue
                curve_list = List[Curve]()
                for curve in curves:
                    curve_list.Add(curve)
                RevisionCloud.Create(doc, view, revision.Id, curve_list)
                clouded += 1
            except Exception:
                skipped += 1
        transaction.Commit()
    except Exception:
        transaction.RollBack()
        raise
    return clouded, skipped
