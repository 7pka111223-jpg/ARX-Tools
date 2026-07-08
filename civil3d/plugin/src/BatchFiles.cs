// Multi-file batch processing: open each DWG as a side database (no UI, the
// file is not the active document), run the checks or apply batch find &
// replace, and — for replace — save the edited drawing in place or as a copy.
using System.Text.Json.Nodes;
using Autodesk.AutoCAD.DatabaseServices;
using ArxChecker.Acad;
using ArxChecker.Core;

namespace ArxChecker.Batch;

public record FileCheckResult(string Path, List<DrawingResult> Results, string Error);

public record FileReplaceResult(string Path, int Changed, string SavedTo, string Error);

public static class Files
{
    /// .dwg files under a folder (optionally recursing). Skips AutoCAD's
    /// per-session .bak and lock artifacts.
    public static List<string> DwgsInFolder(string folder, bool recurse)
    {
        var option = recurse ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        return Directory.EnumerateFiles(folder, "*.dwg", option)
            .Where(p => !Path.GetFileName(p).StartsWith("~"))
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static List<FileCheckResult> CheckFiles(
        IEnumerable<string> paths, JsonObject rules, bool includeModel,
        IReadOnlyCollection<string> extraWords, Action<string> progress)
    {
        var results = new List<FileCheckResult>();
        foreach (var path in paths)
        {
            progress?.Invoke(path);
            try
            {
                using var db = new Database(false, true);
                db.ReadDwgFile(path, FileOpenMode.OpenForReadAndAllShare, false, null);
                var snapshot = Adapter.BuildSnapshot(db, Path.GetFileName(path), rules, includeModel);
                var issues = Checker.Run(snapshot, rules, extraWords);
                results.Add(new FileCheckResult(path, Report.BuildResults(snapshot, issues), null));
            }
            catch (Exception err)
            {
                results.Add(new FileCheckResult(path, null, err.Message));
            }
        }
        return results;
    }

    /// Apply the batch pairs to every file. inPlace overwrites the original;
    /// otherwise the edited drawing is written to outputDir with the same name.
    /// Files with no matches are left untouched and reported as 0 changes.
    public static List<FileReplaceResult> ReplaceFiles(
        IEnumerable<string> paths, IReadOnlyList<(string Find, string Replace)> pairs,
        bool matchCase, bool inPlace, string outputDir, Action<string> progress)
    {
        if (!inPlace)
            Directory.CreateDirectory(outputDir);

        var results = new List<FileReplaceResult>();
        foreach (var path in paths)
        {
            progress?.Invoke(path);
            try
            {
                using var db = new Database(false, true);
                db.ReadDwgFile(path, FileOpenMode.OpenForReadAndWriteNoShare, false, null);
                db.CloseInput(true);   // release the read lock so SaveAs can reuse the path
                int changed = Actions.BatchReplaceDatabase(db, pairs, matchCase);

                string savedTo = null;
                if (changed > 0)
                {
                    savedTo = inPlace ? path : Path.Combine(outputDir, Path.GetFileName(path));
                    db.SaveAs(savedTo, db.OriginalFileVersion);  // keep the drawing's DWG version
                }
                results.Add(new FileReplaceResult(path, changed, savedTo, null));
            }
            catch (Exception err)
            {
                results.Add(new FileReplaceResult(path, 0, null, err.Message));
            }
        }
        return results;
    }
}
