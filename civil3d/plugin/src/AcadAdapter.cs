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

    private const int MaxBlockDepth = 2;

    private static void CollectTexts(Transaction tr, BlockTableRecord btr, List<TextItem> texts,
                                     Dictionary<string, string> attributes, string contextSuffix,
                                     string zoomHandle, int depth)
    {
        foreach (ObjectId id in btr)
        {
            void Add(string text, string context)
            {
                if (!string.IsNullOrWhiteSpace(text))
                    texts.Add(new TextItem
                    {
                        Handle = id.Handle.ToString(),
                        ZoomHandle = zoomHandle,
                        Text = text.Trim(),
                        Context = context + contextSuffix,
                    });
            }

            switch (tr.GetObject(id, OpenMode.ForRead))
            {
                case DBText text:
                    Add(text.TextString, "text note");
                    break;
                case MText mtext:
                    // MText.Text is the plain text with inline codes stripped
                    Add(mtext.Text, "text note");
                    break;
                case MLeader mleader:
                    try
                    {
                        if (mleader.ContentType == ContentType.MTextContent && mleader.MText != null)
                            Add(mleader.MText.Text, "text note (leader)");
                    }
                    catch { /* block-content leaders have no MText */ }
                    break;
                case Dimension dimension:
                    var dimText = dimension.DimensionText;
                    if (!string.IsNullOrWhiteSpace(dimText) && dimText.Trim() != "<>")
                        Add(dimText.Replace("<>", " "), "text note (dimension override)");
                    break;
                case Table table:
                    for (int row = 0; row < table.Rows.Count; row++)
                        for (int col = 0; col < table.Columns.Count; col++)
                        {
                            try { Add(table.Cells[row, col].TextString, "text note in table"); }
                            catch { /* merged / non-text cells */ }
                        }
                    break;
                case BlockReference reference:
                    foreach (ObjectId attId in reference.AttributeCollection)
                    {
                        if (tr.GetObject(attId, OpenMode.ForRead) is not AttributeReference attribute
                            || string.IsNullOrEmpty(attribute.Tag))
                            continue;
                        attributes?.TryAdd(attribute.Tag, attribute.TextString);
                        // attribute values are searchable/replaceable per insert
                        if (!string.IsNullOrWhiteSpace(attribute.TextString))
                            texts.Add(new TextItem
                            {
                                Handle = attId.Handle.ToString(),
                                Text = attribute.TextString.Trim(),
                                Context = $"attribute \"{attribute.Tag}\"" + contextSuffix,
                            });
                    }
                    if (depth < MaxBlockDepth
                        && tr.GetObject(reference.BlockTableRecord, OpenMode.ForRead)
                            is BlockTableRecord definition
                        && !definition.IsFromExternalReference && !definition.IsLayout
                        && !definition.Name.StartsWith("*"))
                    {
                        // text inside the block definition; zoom targets the insert,
                        // and the "in block" context excludes it from find & replace
                        // (editing the definition would change every insert)
                        CollectTexts(tr, definition, texts, null,
                                     $" in block \"{definition.Name}\"",
                                     id.Handle.ToString(), depth + 1);
                    }
                    break;
            }
        }
    }

    public static Snapshot BuildSnapshot(Database db, string docName, JsonObject rules,
                                         bool includeModelSpace = true)
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
            CollectTexts(tr, btr, texts, attributes, "", null, 0);

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

        if (includeModelSpace)
        {
            var blockTable = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
            var modelBtr = (BlockTableRecord)tr.GetObject(
                blockTable[BlockTableRecord.ModelSpace], OpenMode.ForRead);
            var modelTexts = new List<TextItem>();
            CollectTexts(tr, modelBtr, modelTexts, null, "", null, 0);
            if (modelTexts.Count > 0)
                snapshot.Sheets.Add(new SheetData
                {
                    LayoutName = "Model", Number = "Model", Name = "Model",
                    IsModelSpace = true, TextNotes = modelTexts,
                });
        }

        tr.Commit();
        return snapshot;
    }

    public static string LayoutForPage(Snapshot snapshot, string page) =>
        snapshot.Sheets.FirstOrDefault(s => s.Number == page)?.LayoutName;
}
