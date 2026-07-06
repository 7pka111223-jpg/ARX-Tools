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


