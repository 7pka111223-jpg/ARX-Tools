// Model-changing / navigation actions: zoom to an entity, find & replace
// in text entities, and the annotated PDF export (temporary red markers,
// multi-sheet plot through DWG To PDF.pc3, markers always removed).
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.Colors;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.PlottingServices;
using ArxChecker.Core;
using AcadApp = Autodesk.AutoCAD.ApplicationServices.Core.Application;

namespace ArxChecker.Acad;

public static class Actions
{
    public static ObjectId? Resolve(Database db, string handleText)
    {
        try
        {
            var handle = new Handle(Convert.ToInt64(handleText, 16));
            return db.GetObjectId(false, handle, 0);
        }
        catch
        {
            return null;
        }
    }

    public static void ZoomTo(Document doc, string handleText, string layoutName)
    {
        var id = Resolve(doc.Database, handleText);
        if (id == null) return;
        if (!string.IsNullOrEmpty(layoutName))
            LayoutManager.Current.CurrentLayout = layoutName;

        Extents3d extents;
        using (var tr = doc.Database.TransactionManager.StartTransaction())
        {
            var entity = (Entity)tr.GetObject(id.Value, OpenMode.ForRead);
            extents = entity.GeometricExtents;
            tr.Commit();
        }

        var editor = doc.Editor;
        using (var view = editor.GetCurrentView())
        {
            var width = Math.Max(extents.MaxPoint.X - extents.MinPoint.X, 1.0);
            var height = Math.Max(extents.MaxPoint.Y - extents.MinPoint.Y, 1.0);
            view.CenterPoint = new Point2d(
                (extents.MinPoint.X + extents.MaxPoint.X) / 2,
                (extents.MinPoint.Y + extents.MaxPoint.Y) / 2);
            view.Width = width * 5;
            view.Height = height * 5;
            editor.SetCurrentView(view);
        }
        editor.SetImpliedSelection(new[] { id.Value });
    }

    public static (int Changed, int Skipped) ReplaceInTexts(
        Document doc, IEnumerable<string> handles, string find, string replace, bool matchCase)
    {
        int changed = 0, skipped = 0;
        var options = matchCase ? RegexOptions.None : RegexOptions.IgnoreCase;
        var finder = new Regex(Regex.Escape(find), options);
        var replacement = replace.Replace("$", "$$");

        using var tr = doc.Database.TransactionManager.StartTransaction();
        foreach (var handleText in handles.Distinct())
        {
            var id = Resolve(doc.Database, handleText);
            if (id == null) { skipped++; continue; }
            try
            {
                switch (tr.GetObject(id.Value, OpenMode.ForWrite))
                {
                    case DBText text:
                        var newText = finder.Replace(text.TextString, replacement);
                        if (newText != text.TextString) { text.TextString = newText; changed++; }
                        else skipped++;
                        break;
                    case MText mtext:
                        // replace in raw contents so inline formatting survives;
                        // a match broken up by format codes is skipped, not corrupted
                        var newContents = finder.Replace(mtext.Contents, replacement);
                        if (newContents != mtext.Contents) { mtext.Contents = newContents; changed++; }
                        else skipped++;
                        break;
                    case MLeader mleader when mleader.ContentType == ContentType.MTextContent:
                        var leaderText = mleader.MText;
                        var newLeader = finder.Replace(leaderText.Contents, replacement);
                        if (newLeader != leaderText.Contents)
                        {
                            leaderText.Contents = newLeader;
                            mleader.MText = leaderText;
                            changed++;
                        }
                        else skipped++;
                        break;
                    case Dimension dimension:
                        var newDim = finder.Replace(dimension.DimensionText ?? "", replacement);
                        if (newDim != dimension.DimensionText) { dimension.DimensionText = newDim; changed++; }
                        else skipped++;
                        break;
                    case Table table:
                        bool tableChanged = false;
                        for (int row = 0; row < table.Rows.Count; row++)
                            for (int col = 0; col < table.Columns.Count; col++)
                            {
                                try
                                {
                                    var cell = table.Cells[row, col];
                                    var updated = finder.Replace(cell.TextString ?? "", replacement);
                                    if (updated != cell.TextString)
                                    {
                                        cell.TextString = updated;
                                        tableChanged = true;
                                    }
                                }
                                catch { /* merged / non-text cells */ }
                            }
                        if (tableChanged) { table.RecomputeTableBlock(true); changed++; }
                        else skipped++;
                        break;
                    default:
                        skipped++;
                        break;
                }
            }
            catch
            {
                skipped++;
            }
        }
        tr.Commit();
        return (changed, skipped);
    }

    // ------------------------------------------------- annotated PDF export

    public static (int Sheets, int Markers) ExportAnnotatedPdf(
        Document doc, Snapshot fullSnapshot, List<Issue> issues, string pdfPath)
    {
        // model space is checked but not printed — plot the real layouts only
        var snapshot = new Snapshot
        {
            DocTitle = fullSnapshot.DocTitle,
            ProjectInfo = fullSnapshot.ProjectInfo,
            Sheets = fullSnapshot.Sheets.Where(s => !s.IsModelSpace).ToList(),
        };
        if (snapshot.Sheets.Count == 0)
            throw new InvalidOperationException("No layouts to export.");

        var noteLayouts = new Dictionary<string, string>();
        foreach (var sheet in snapshot.Sheets)
            foreach (var note in sheet.TextNotes)
                noteLayouts.TryAdd(note.Handle, sheet.LayoutName);

        var byEntity = new Dictionary<string, List<Issue>>();
        var bySheet = new Dictionary<string, List<Issue>>();
        foreach (var issue in issues)
        {
            if (issue.ElementId != null && noteLayouts.ContainsKey(issue.ElementId))
            {
                byEntity.TryAdd(issue.ElementId, new List<Issue>());
                byEntity[issue.ElementId].Add(issue);
            }
            else
            {
                var page = issue.Page ?? snapshot.Sheets[0].Number;
                bySheet.TryAdd(page, new List<Issue>());
                bySheet[page].Add(issue);
            }
        }

        var markerIds = new List<ObjectId>();
        int markerCount = CreateMarkers(doc, snapshot, byEntity, bySheet, noteLayouts, markerIds);
        try
        {
            PlotLayoutsToPdf(doc, snapshot.Sheets.Select(s => s.LayoutName).ToList(), pdfPath);
        }
        finally
        {
            DeleteMarkers(doc, markerIds);
        }
        return (snapshot.Sheets.Count, markerCount);
    }

    private static string MarkerText(List<Issue> issuesForTarget) =>
        string.Join("\\P", issuesForTarget.Select(i => $">> {i.Severity.ToUpperInvariant()}: {i.Message}"));

    private static int CreateMarkers(Document doc, Snapshot snapshot,
        Dictionary<string, List<Issue>> byEntity, Dictionary<string, List<Issue>> bySheet,
        Dictionary<string, string> noteLayouts, List<ObjectId> markerIds)
    {
        int count = 0;
        using var tr = doc.Database.TransactionManager.StartTransaction();
        var layoutDict = (DBDictionary)tr.GetObject(doc.Database.LayoutDictionaryId, OpenMode.ForRead);
        var layoutBlocks = new Dictionary<string, BlockTableRecord>();
        foreach (DBDictionaryEntry entry in layoutDict)
        {
            var layout = (Layout)tr.GetObject(entry.Value, OpenMode.ForRead);
            if (!layout.ModelType)
                layoutBlocks[layout.LayoutName] =
                    (BlockTableRecord)tr.GetObject(layout.BlockTableRecordId, OpenMode.ForWrite);
        }

        void AddMarker(BlockTableRecord block, Point3d position, string text)
        {
            var marker = new MText
            {
                Location = position,
                Width = 120.0,
                TextHeight = 3.0,
                Contents = text,
                Color = Color.FromColorIndex(ColorMethod.ByAci, 1),
            };
            block.AppendEntity(marker);
            tr.AddNewlyCreatedDBObject(marker, true);
            markerIds.Add(marker.ObjectId);
            count++;
        }

        foreach (var pair in byEntity)
        {
            var id = Resolve(doc.Database, pair.Key);
            if (id == null || !layoutBlocks.TryGetValue(noteLayouts[pair.Key], out var block))
                continue;
            try
            {
                var entity = (Entity)tr.GetObject(id.Value, OpenMode.ForRead);
                var extents = entity.GeometricExtents;
                AddMarker(block, new Point3d(extents.MaxPoint.X + 2, extents.MaxPoint.Y + 2, 0),
                          MarkerText(pair.Value));
            }
            catch
            {
                // marker is best-effort per entity
            }
        }

        foreach (var sheet in snapshot.Sheets)
        {
            if (!bySheet.TryGetValue(sheet.Number, out var sheetIssues)
                || !layoutBlocks.TryGetValue(sheet.LayoutName, out var block))
                continue;
            var text = $"ARX DRAWING CHECK — {sheetIssues.Count} ISSUE(S)\\P{MarkerText(sheetIssues)}";
            AddMarker(block, new Point3d(15, 15, 0), text);
        }

        tr.Commit();
        return count;
    }

    private static void DeleteMarkers(Document doc, List<ObjectId> markerIds)
    {
        using var tr = doc.Database.TransactionManager.StartTransaction();
        foreach (var id in markerIds)
        {
            try
            {
                tr.GetObject(id, OpenMode.ForWrite).Erase();
            }
            catch
            {
                // already gone — fine
            }
        }
        tr.Commit();
    }

    private static void PlotLayoutsToPdf(Document doc, List<string> layoutNames, string pdfPath)
    {
        if (PlotFactory.ProcessPlotState != ProcessPlotState.NotPlotting)
            throw new InvalidOperationException(
                "A plot is already in progress — wait for it to finish and try again.");

        var db = doc.Database;
        object previousBackgroundPlot = AcadApp.GetSystemVariable("BACKGROUNDPLOT");
        AcadApp.SetSystemVariable("BACKGROUNDPLOT", 0);
        try
        {
            using var tr = db.TransactionManager.StartTransaction();
            var layoutDict = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);

            using var engine = PlotFactory.CreatePublishEngine();
            using var progress = new PlotProgressDialog(false, layoutNames.Count, true);
            progress.set_PlotMsgString(PlotMessageIndex.DialogTitle, "ARX Drawing Checker — PDF export");
            progress.LowerPlotProgressRange = 0;
            progress.UpperPlotProgressRange = 100;
            progress.PlotProgressPos = 0;
            progress.OnBeginPlot();
            progress.IsVisible = true;

            bool documentStarted = false;
            for (int index = 0; index < layoutNames.Count; index++)
            {
                var layout = (Layout)tr.GetObject(layoutDict.GetAt(layoutNames[index]), OpenMode.ForRead);
                var settings = new PlotSettings(layout.ModelType);
                settings.CopyFrom(layout);
                var validator = PlotSettingsValidator.Current;
                validator.SetPlotConfigurationName(settings, "DWG To PDF.pc3", null);

                var info = new PlotInfo { Layout = layout.ObjectId, OverrideSettings = settings };
                var infoValidator = new PlotInfoValidator
                {
                    MediaMatchingPolicy = MatchingPolicy.MatchEnabled,
                };
                infoValidator.Validate(info);

                if (!documentStarted)
                {
                    engine.BeginPlot(progress, null);
                    engine.BeginDocument(info, doc.Name, null, 1, true, pdfPath);
                    documentStarted = true;
                }

                progress.OnBeginSheet();
                var pageInfo = new PlotPageInfo();
                engine.BeginPage(pageInfo, info, index == layoutNames.Count - 1, null);
                engine.BeginGenerateGraphics(null);
                engine.EndGenerateGraphics(null);
                engine.EndPage(null);
                progress.PlotProgressPos = (index + 1) * 100 / layoutNames.Count;
                progress.OnEndSheet();
            }

            engine.EndDocument(null);
            progress.OnEndPlot();
            engine.EndPlot(null);
            tr.Commit();
        }
        finally
        {
            AcadApp.SetSystemVariable("BACKGROUNDPLOT", previousBackgroundPlot);
        }
    }
}
