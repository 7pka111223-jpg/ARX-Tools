// Reads the active drawing into the Core snapshot: paper-space layouts =
// sheets, title-block attributes matched to rule labels, TEXT/MTEXT =
// text notes. Read-only.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Autodesk.AutoCAD.DatabaseServices;
using ArxChecker.Core;

namespace ArxChecker.Acad;

public static class Adapter
{
    private static readonly Regex NormalizeRe = new("[^A-Z0-9]+");

    private static string Normalize(string label) =>
        NormalizeRe.Replace((label ?? "").ToUpperInvariant(), "");

    public static (bool Found, string Value) MatchAttribute(
        Dictionary<string, string> attributes, string label, JsonObject paramMap)
    {
        var mapped = RulesStore.Str(paramMap, label);
        if (!string.IsNullOrEmpty(mapped))
        {
            foreach (var pair in attributes)
                if (string.Equals(pair.Key, mapped, StringComparison.OrdinalIgnoreCase))
                    return (true, pair.Value);
            return (false, null);
        }

        var wanted = Normalize(label);
        if (wanted.Length == 0) return (false, null);
        var normalized = new Dictionary<string, string>();
        foreach (var pair in attributes)
            normalized.TryAdd(Normalize(pair.Key), pair.Value);
        if (normalized.TryGetValue(wanted, out var exact)) return (true, exact);
        foreach (var pair in normalized)
            if (pair.Key.Contains(wanted) || (pair.Key.Length >= 3 && wanted.Contains(pair.Key)))
                return (true, pair.Value);
        return (false, null);
    }

    public static Snapshot BuildSnapshot(Database db, string docName, JsonObject rules)
    {
        var paramMap = (rules["revit"] as JsonObject)?["paramMap"] as JsonObject;
        var fieldRules = RulesStore.EnabledRules(rules, "titleBlock", "revision").ToList();
        var dwgRule = fieldRules.FirstOrDefault(r => RulesStore.Str(r, "id") == "dwgNo");
        var otherRules = fieldRules.Where(r => RulesStore.Str(r, "id") != "dwgNo").ToList();

        var snapshot = new Snapshot { DocTitle = docName };

        using var tr = db.TransactionManager.StartTransaction();
        var layoutDict = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
        var layouts = new List<Layout>();
        foreach (DBDictionaryEntry entry in layoutDict)
        {
            var layout = (Layout)tr.GetObject(entry.Value, OpenMode.ForRead);
            if (!layout.ModelType) layouts.Add(layout);
        }
        layouts.Sort((a, b) => a.TabOrder.CompareTo(b.TabOrder));

        foreach (var layout in layouts)
        {
            var texts = new List<TextItem>();
            var attributes = new Dictionary<string, string>();
            var btr = (BlockTableRecord)tr.GetObject(layout.BlockTableRecordId, OpenMode.ForRead);
            foreach (ObjectId id in btr)
            {
                switch (tr.GetObject(id, OpenMode.ForRead))
                {
                    case DBText text when !string.IsNullOrWhiteSpace(text.TextString):
                        texts.Add(new TextItem { Handle = id.Handle.ToString(), Text = text.TextString.Trim() });
                        break;
                    case MText mtext when !string.IsNullOrWhiteSpace(mtext.Text):
                        // MText.Text is the plain text with inline codes stripped
                        texts.Add(new TextItem { Handle = id.Handle.ToString(), Text = mtext.Text.Trim() });
                        break;
                    case BlockReference reference:
                        foreach (ObjectId attId in reference.AttributeCollection)
                        {
                            if (tr.GetObject(attId, OpenMode.ForRead) is AttributeReference attribute
                                && !string.IsNullOrEmpty(attribute.Tag))
                                attributes.TryAdd(attribute.Tag, attribute.TextString);
                        }
                        break;
                }
            }

            var number = layout.LayoutName;
            if (dwgRule != null)
            {
                var (found, value) = MatchAttribute(attributes, RulesStore.Str(dwgRule, "label"), paramMap);
                if (found && !string.IsNullOrWhiteSpace(value)) number = value.Trim();
            }

            var sheet = new SheetData
            {
                LayoutName = layout.LayoutName,
                Number = number,
                Name = layout.LayoutName,
                TextNotes = texts,
            };
            foreach (var rule in otherRules)
            {
                var ruleId = RulesStore.Str(rule, "id");
                var (found, value) = MatchAttribute(attributes, RulesStore.Str(rule, "label"), paramMap);
                if (found) sheet.Params[ruleId] = value;
                else sheet.MissingParams.Add(ruleId);
            }

            foreach (var field in (JsonArray)rules["project"])
            {
                var id = RulesStore.Str(field, "id");
                if (snapshot.ProjectInfo.TryGetValue(id, out var existing) && !string.IsNullOrEmpty(existing))
                    continue;
                var (found, value) = MatchAttribute(attributes, RulesStore.Str(field, "label"), paramMap);
                if (found && !string.IsNullOrWhiteSpace(value))
                    snapshot.ProjectInfo[id] = value.Trim();
            }

            snapshot.Sheets.Add(sheet);
        }
        tr.Commit();
        return snapshot;
    }

    public static string LayoutForPage(Snapshot snapshot, string page) =>
        snapshot.Sheets.FirstOrDefault(s => s.Number == page)?.LayoutName;
}
