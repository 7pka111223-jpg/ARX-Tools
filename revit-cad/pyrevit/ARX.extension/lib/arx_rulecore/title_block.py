"""Locate "LABEL: value" fields inside a spatial region of a page.

Faithful port of src/titleBlockLocator.js. A page is a dict::

    {"pageNumber": 1, "width": W, "height": H,
     "items": [{"text": str, "x": float, "y": float}, ...]}

In the PDF tool, items are text spans; for Revit/CAD the extractor emits the
same shape (a sheet is a "page", each title-block parameter / text note an item).
"""

import re

from .util import escape_regex


def compute_region_box(page_width, page_height, region):
    corner = region.get("corner")
    if not re.match(r"^(top|bottom)-(left|right)$", corner or ""):
        raise ValueError(
            'Invalid region.corner "%s": expected one of "top-left", '
            '"top-right", "bottom-left", "bottom-right"' % corner
        )
    width_pct = region.get("widthPct")
    height_pct = region.get("heightPct")
    if not isinstance(width_pct, (int, float)):
        raise ValueError('Invalid region.widthPct "%s": expected a number' % width_pct)
    if not isinstance(height_pct, (int, float)):
        raise ValueError('Invalid region.heightPct "%s": expected a number' % height_pct)

    w = page_width * (width_pct / 100.0)
    h = page_height * (height_pct / 100.0)
    right = "right" in corner
    bottom = "bottom" in corner
    return {
        "xMin": page_width - w if right else 0,
        "xMax": page_width if right else w,
        "yMin": page_height - h if bottom else 0,
        "yMax": page_height if bottom else h,
    }


def _in_box(item, box):
    return (box["xMin"] <= item["x"] <= box["xMax"]
            and box["yMin"] <= item["y"] <= box["yMax"])


def _same_item_regex(label):
    # "^\s*LABEL\s*[:\-]?\s*(\S+)" case-insensitive
    return re.compile(r"^\s*%s\s*[:\-]?\s*(\S+)" % escape_regex(label), re.IGNORECASE)


def _label_only_regex(label):
    # "^\s*LABEL\s*[:\-]?\s*$" case-insensitive
    return re.compile(r"^\s*%s\s*[:\-]?\s*$" % escape_regex(label), re.IGNORECASE)


def _looks_like_another_field_label(text, required_fields, exclude_field_id):
    for other in required_fields:
        if other["id"] == exclude_field_id:
            continue
        if _label_only_regex(other["label"]).search(text) or _same_item_regex(other["label"]).search(text):
            return True
    return False


def _find_field_value(items, field, required_fields):
    same_re = _same_item_regex(field["label"])
    label_only_re = _label_only_regex(field["label"])

    for i, item in enumerate(items):
        text = item["text"]
        # Test label-only FIRST so the optional [:\-]? in same_re cannot
        # backtrack and capture the colon as a bogus value (see JS comment).
        if label_only_re.search(text):
            if i + 1 >= len(items):
                return None
            nxt = items[i + 1]
            if _looks_like_another_field_label(nxt["text"], required_fields, field["id"]):
                return None
            trimmed = nxt["text"].strip()
            return trimmed if trimmed else None

        m = same_re.search(text)
        if m:
            return m.group(1)

    return None


def locate_fields_on_page(page, required_fields, region):
    box = compute_region_box(page["width"], page["height"], region)
    items = [it for it in page["items"] if _in_box(it, box)]
    items.sort(key=lambda it: (it["y"], it["x"]))

    fields = {}
    for f in required_fields:
        value = _find_field_value(items, f, required_fields)
        pattern = f.get("pattern")
        valid = value is not None and (not pattern or re.search(pattern, value) is not None)
        fields[f["id"]] = {"value": value, "found": value is not None, "valid": valid}
    return fields
