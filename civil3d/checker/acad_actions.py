# -*- coding: utf-8 -*-
"""Write-side / navigation actions against the running Civil 3D session:
zoom to an entity, find & replace in text entities, and the annotated
PDF export (temporary red markers, plot every layout, delete markers,
merge into one PDF)."""
import os
import re
import tempfile


def _variant_point(x, y, z=0.0):
    import pythoncom
    from win32com.client import VARIANT
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, (float(x), float(y), float(z)))


def _activate_layout(doc, layout_name):
    if not layout_name:
        return
    for i in range(doc.Layouts.Count):
        layout = doc.Layouts.Item(i)
        if layout.Name == layout_name:
            doc.ActiveLayout = layout
            return


def zoom_to(app, doc, handle, layout_name):
    """Switch to the entity's layout, select-ish zoom to its extents."""
    entity = doc.HandleToObject(handle)
    _activate_layout(doc, layout_name)
    min_point, max_point = entity.GetBoundingBox()
    pad_x = max(1.0, (max_point[0] - min_point[0]) * 2.0)
    pad_y = max(1.0, (max_point[1] - min_point[1]) * 2.0)
    app.ZoomWindow(
        _variant_point(min_point[0] - pad_x, min_point[1] - pad_y),
        _variant_point(max_point[0] + pad_x, max_point[1] + pad_y),
    )
    try:
        entity.Highlight(True)
    except Exception:
        pass


def replace_in_texts(doc, handles, find, replace, match_case=False):
    """Replace `find` with `replace` in the given text entities.

    DBText is edited directly; MText is edited in its raw contents so
    inline formatting survives — a match that is split by a formatting
    code inside the word is skipped (counted) rather than corrupted.
    Returns (changed, skipped).
    """
    flags = 0 if match_case else re.IGNORECASE
    finder = re.compile(re.escape(find), flags)
    changed = 0
    skipped = 0
    doc.StartUndoMark()
    try:
        for handle in handles:
            try:
                entity = doc.HandleToObject(handle)
                raw = entity.TextString
                new_raw = finder.sub(lambda m: replace, raw)
                if new_raw != raw:
                    entity.TextString = new_raw
                    changed += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1
    finally:
        doc.EndUndoMark()
    return changed, skipped


def _add_marker(doc, block, x, y, text):
    marker = block.AddMText(_variant_point(x, y), 120.0, text)
    try:
        marker.Height = 3.0
    except Exception:
        pass
    try:
        marker.color = 1  # acRed
    except Exception:
        pass
    return marker


def _marker_lines(issues_for_target):
    return '\n'.join(
        '>> %s: %s' % (issue['severity'].upper(), issue['message'])
        for issue in issues_for_target
    )


def export_annotated_pdf(app, doc, snapshot, issues, pdf_path):
    """Plot every layout to PDF with red '>>' markers on the mistakes,
    then combine into one PDF at pdf_path (needs pypdf; falls back to
    one PDF per sheet in the same folder). The markers are temporary —
    created, plotted, deleted. Returns (sheet_count, marker_count,
    combined: bool)."""
    sheets = snapshot.get('sheets', [])
    if not sheets:
        raise RuntimeError('No layouts to export.')

    text_handles = {}
    for sheet in sheets:
        for note in sheet.get('textNotes', []):
            text_handles[note['elementId']] = sheet['layoutName']

    by_entity = {}
    by_sheet = {}
    for issue in issues:
        element_id = issue.get('elementId')
        if element_id in text_handles:
            by_entity.setdefault(element_id, []).append(issue)
        else:
            page = issue.get('page') or sheets[0]['number']
            by_sheet.setdefault(page, []).append(issue)

    markers = []
    marker_count = 0
    doc.StartUndoMark()
    try:
        layout_blocks = {}
        for i in range(doc.Layouts.Count):
            layout = doc.Layouts.Item(i)
            if not layout.ModelType:
                layout_blocks[layout.Name] = layout.Block

        for handle, entity_issues in by_entity.items():
            try:
                entity = doc.HandleToObject(handle)
                _, max_point = entity.GetBoundingBox()
                block = layout_blocks.get(text_handles[handle])
                if block is None:
                    continue
                markers.append(_add_marker(doc, block, max_point[0] + 2.0, max_point[1] + 2.0,
                                           _marker_lines(entity_issues)))
                marker_count += 1
            except Exception:
                pass

        for sheet in sheets:
            sheet_issues = by_sheet.get(sheet['number'])
            block = layout_blocks.get(sheet['layoutName'])
            if not sheet_issues or block is None:
                continue
            text = 'ARX DRAWING CHECK — %d ISSUE(S)\n%s' % (
                len(sheet_issues), _marker_lines(sheet_issues))
            try:
                markers.append(_add_marker(doc, block, 15.0, 15.0, text))
                marker_count += 1
            except Exception:
                pass

        sheet_pdfs = _plot_layouts(doc, [s['layoutName'] for s in sheets], pdf_path)
    finally:
        for marker in markers:
            try:
                marker.Delete()
            except Exception:
                pass
        doc.EndUndoMark()

    combined = _combine_pdfs(sheet_pdfs, pdf_path)
    return len(sheet_pdfs), marker_count, combined


def _plot_layouts(doc, layout_names, pdf_path):
    """Plot each layout to its own temp PDF with DWG To PDF.pc3."""
    out_dir = tempfile.mkdtemp(prefix='arx-check-')
    doc.SetVariable('BACKGROUNDPLOT', 0)
    created = []
    original_layout = doc.ActiveLayout
    try:
        for name in layout_names:
            _activate_layout(doc, name)
            layout = doc.ActiveLayout
            original_config = layout.ConfigName
            try:
                layout.ConfigName = 'DWG To PDF.pc3'
                target = os.path.join(out_dir, '%s.pdf' % _safe_name(name))
                if doc.Plot.PlotToFile(target):
                    created.append(target)
            finally:
                try:
                    layout.ConfigName = original_config
                except Exception:
                    pass
    finally:
        try:
            doc.ActiveLayout = original_layout
        except Exception:
            pass
    if not created:
        raise RuntimeError('Plotting failed for every layout — check that the '
                           '"DWG To PDF.pc3" plotter is available.')
    return created


def _safe_name(name):
    return re.sub(r'[^A-Za-z0-9 _\-]+', '_', name)


def _combine_pdfs(sheet_pdfs, pdf_path):
    """Merge per-sheet PDFs into pdf_path; on failure copy them next to
    it instead and return False."""
    try:
        from pypdf import PdfWriter
        writer = PdfWriter()
        for pdf in sheet_pdfs:
            writer.append(pdf)
        with open(pdf_path, 'wb') as fh:
            writer.write(fh)
        return True
    except Exception:
        import shutil
        folder = os.path.dirname(pdf_path)
        base = os.path.splitext(os.path.basename(pdf_path))[0]
        for pdf in sheet_pdfs:
            shutil.copy(pdf, os.path.join(folder, '%s - %s' % (base, os.path.basename(pdf))))
        return False
