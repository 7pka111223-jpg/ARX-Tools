"""Revit -> abstract page model. This is the ONLY Revit-coupled module; the rest
of arx_rulecore is pure Python and unit-tested without Revit.

Each ViewSheet becomes a "page"; its title-block string parameters and the
TextNotes placed on it become "items". The Revit API is imported lazily inside
the functions so this module can be imported (and the rest of the package
tested) under plain CPython with no Revit present.
"""


def _revit_db():
    # Imported lazily: only available inside Revit via pyRevit/IronPython.
    from Autodesk.Revit import DB  # noqa: E402  (host-provided)
    return DB


def collect_pages(doc):
    """Return a list of abstract page dicts for every sheet in ``doc``."""
    DB = _revit_db()
    pages = []
    sheets = DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet)
    for sheet in sheets:
        items = []

        title_block = (
            DB.FilteredElementCollector(doc, sheet.Id)
            .OfCategory(DB.BuiltInCategory.OST_TitleBlocks)
            .FirstElement()
        )
        if title_block is not None:
            for p in title_block.Parameters:
                try:
                    if p.HasValue and p.StorageType == DB.StorageType.String:
                        items.append({
                            "text": p.AsString() or "",
                            "x": 0.0, "y": 0.0,
                            "label": p.Definition.Name,
                            "sourceId": title_block.Id.IntegerValue,
                        })
                except Exception:
                    continue

        for tn in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.TextNote):
            box = tn.get_BoundingBox(None)
            x = box.Min.X if box else 0.0
            y = box.Min.Y if box else 0.0
            items.append({
                "text": tn.Text, "x": x, "y": y,
                "sourceId": tn.Id.IntegerValue,
            })

        # The locator works in a normalised coordinate box, so width/height just
        # need to bound the items; use the spread of placed text.
        xs = [it["x"] for it in items] or [0.0]
        ys = [it["y"] for it in items] or [0.0]
        pages.append({
            "pageNumber": sheet.SheetNumber,
            "width": (max(xs) - min(xs)) or 1.0,
            "height": (max(ys) - min(ys)) or 1.0,
            "items": items,
        })
    return pages


def collect_textnotes(doc):
    """Return [(elementId:int, text:str)] for batch find & replace previews."""
    DB = _revit_db()
    out = []
    for tn in DB.FilteredElementCollector(doc).OfClass(DB.TextNote):
        out.append((tn.Id.IntegerValue, tn.Text))
    return out


def collect_names(doc):
    """Return abstract pages of model *names* (sheets, views, families) for the
    standards/naming check. One synthetic page per category."""
    DB = _revit_db()

    def page(num, names):
        return {"pageNumber": num, "width": 1.0, "height": 1.0,
                "items": [{"text": n, "x": 0.0, "y": 0.0} for n in names if n]}

    sheets = [s.SheetNumber for s in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet)]
    views = [v.Name for v in DB.FilteredElementCollector(doc).OfClass(DB.View) if not v.IsTemplate]
    return [page("sheets", sheets), page("views", views)]
