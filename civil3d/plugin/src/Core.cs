// Pure checking core — a C# port of the shared drawingchecker library
// (revit/DrawingChecker.extension/lib). No AutoCAD types in this file, so
// it can be exercised headlessly by the smoke-test console project.
// The rules model is JsonObject to round-trip unknown keys, keeping the
// rules.json interchangeable with the web and Revit checkers.
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ArxChecker.Core;

public class Issue
{
    public string Category;
    public string Severity;
    public string RuleId;
    public string FoundText;
    public string Page;       // sheet number (null = project-level)
    public string ElementId;  // entity handle (null = not element-tied)
    public string Message;
}

public class TextItem
{
    public string Handle;      // the editable entity (replace target)
    public string ZoomHandle;  // what to zoom to when different (e.g. block insert)
    public string Text;
    public string Context;     // where the text lives; null = plain text note
}

public class SheetData
{
    public string LayoutName;
    public string Number;
    public string Name;
    public bool IsModelSpace;   // pseudo-sheet for model space text: text checks only
    public Dictionary<string, string> Params = new();
    public List<string> MissingParams = new();
    public List<TextItem> TextNotes = new();
}

public class Snapshot
{
    public string DocTitle;
    public Dictionary<string, string> ProjectInfo = new();
    public List<SheetData> Sheets = new();
}

public class Entry
{
    public string Text;
    public string Page;
    public string Handle;
    public string ZoomHandle;
    public string Context;

    public string ZoomTarget => ZoomHandle ?? Handle;
}

public static class Data
{
    // Embedded resource first; ARX_DATA_DIR env var as headless fallback.
    public static string GetText(string name)
    {
        var assembly = Assembly.GetExecutingAssembly();
        foreach (var resource in assembly.GetManifestResourceNames())
        {
            if (resource.EndsWith(name, StringComparison.OrdinalIgnoreCase))
            {
                using var stream = assembly.GetManifestResourceStream(resource);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                return reader.ReadToEnd();
            }
        }
        var dir = Environment.GetEnvironmentVariable("ARX_DATA_DIR");
        if (dir != null && File.Exists(Path.Combine(dir, name)))
            return File.ReadAllText(Path.Combine(dir, name), Encoding.UTF8);
        throw new InvalidOperationException($"Bundled data file not found: {name}");
    }
}

public static class RulesStore
{
    public static readonly string[] ValidSeverities = { "error", "warn" };
    public static readonly string[] ValidCategories = { "titleBlock", "revision", "formatting" };

    public static JsonObject DefaultRules() =>
        (JsonObject)JsonNode.Parse(Data.GetText("default_rules.json"));

    public static string Str(JsonNode node, string key)
    {
        var value = (node as JsonObject)?[key];
        if (value is not JsonValue jsonValue) return value?.ToString();
        // handles both JsonElement-backed nodes (parsed) and CLR-backed
        // nodes (set programmatically)
        return jsonValue.TryGetValue<string>(out var text) ? text : jsonValue.ToString();
    }

    public static bool Flag(JsonNode node, string key)
    {
        var value = (node as JsonObject)?[key];
        try { return value != null && value.GetValue<bool>(); }
        catch { return false; }
    }

    public static void ValidateRule(JsonObject rule)
    {
        var severity = Str(rule, "severity");
        if (!ValidSeverities.Contains(severity))
            throw new ArgumentException(
                $"Invalid severity \"{severity}\" for rule \"{Str(rule, "id")}\"; must be \"error\" or \"warn\"");
        foreach (var field in new[] { "pattern", "find", "valid" })
        {
            var pattern = Str(rule, field);
            if (pattern == null) continue;
            try { _ = new Regex(pattern); }
            catch (Exception err)
            {
                throw new ArgumentException(
                    $"Invalid regex in \"{field}\" for rule \"{Str(rule, "id")}\": {err.Message}");
            }
        }
    }

    public static JsonObject Load(string jsonText)
    {
        var parsed = JsonNode.Parse(jsonText) as JsonObject
            ?? throw new ArgumentException("Invalid rules file: not a JSON object");
        foreach (var key in new[] { "project", "spelling", "rules", "titleBlockRegion" })
            if (!parsed.ContainsKey(key))
                throw new ArgumentException($"Invalid rules file: missing \"{key}\"");
        if (parsed["rules"] is not JsonArray rules)
            throw new ArgumentException("Invalid rules file: \"rules\" must be an array");
        foreach (var rule in rules)
            ValidateRule((JsonObject)rule);

        var revit = parsed["revit"] as JsonObject ?? new JsonObject();
        parsed.Remove("revit");
        foreach (var (key, fallback) in new (string, JsonNode)[] {
                ("sheetNamePattern", null), ("viewNamePattern", null),
                ("scheduleNamePattern", null), ("paramMap", new JsonObject()),
                ("skipViewsNotOnSheets", JsonValue.Create(true)) })
            if (!revit.ContainsKey(key))
                revit[key] = fallback;
        parsed["revit"] = revit;
        return parsed;
    }

    public static string Dumps(JsonObject rules) =>
        rules.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

    public static IEnumerable<JsonObject> EnabledRules(JsonObject rules, params string[] categories) =>
        ((JsonArray)rules["rules"]).Cast<JsonObject>()
            .Where(r => Flag(r, "enabled") && categories.Contains(Str(r, "category")));
}

public static class Tokenizer
{
    public const int MinWordLength = 3;
    private static readonly Regex CleanRe = new("[^A-Za-z'\\-]+");
    private static readonly Regex DigitRe = new("\\d");
    private static readonly Regex AlphaRe = new("[A-Za-z]");

    public static List<(string Display, List<string> Parts)> Tokenize(string text)
    {
        var tokens = new List<(string, List<string>)>();
        if (string.IsNullOrEmpty(text)) return tokens;
        foreach (var raw in text.Split((char[])null, StringSplitOptions.RemoveEmptyEntries))
        {
            if (DigitRe.IsMatch(raw)) continue;
            var clean = CleanRe.Replace(raw, "").Trim('\'', '-');
            if (clean.Length < MinWordLength || !AlphaRe.IsMatch(clean)) continue;
            var parts = new List<string>();
            foreach (var piece in clean.Split('-', StringSplitOptions.RemoveEmptyEntries))
            {
                var part = piece.Trim('\'');
                if (part.EndsWith("'s", StringComparison.OrdinalIgnoreCase))
                    part = part[..^2];
                if (part.Length >= MinWordLength)
                    parts.Add(part.ToLowerInvariant());
            }
            if (parts.Count > 0) tokens.Add((clean, parts));
        }
        return tokens;
    }
}

public static class Wordlist
{
    private static HashSet<string> _words;
    private static HashSet<string> _abbreviations;

    public static HashSet<string> ParseWordText(string text)
    {
        var words = new HashSet<string>();
        foreach (var line in (text ?? "").Split('\n'))
        {
            var word = line.Trim().ToLowerInvariant();
            if (word.Length > 0 && !word.StartsWith('#')) words.Add(word);
        }
        return words;
    }

    public static HashSet<string> Words() =>
        _words ??= ParseWordText(Data.GetText("words_en.txt"));

    public static HashSet<string> Abbreviations() =>
        _abbreviations ??= ParseWordText(Data.GetText("abbreviations_drafting.txt"));

    public static List<string> ParseWordList(string text)
    {
        var words = new List<string>();
        foreach (var chunk in Regex.Split(text ?? "", "[\\n\\r,;]+"))
        {
            var word = chunk.Trim();
            if (word.Length > 0 && !words.Contains(word)) words.Add(word);
        }
        return words;
    }
}

public static class SpellChecker
{
    public static List<Issue> Check(IEnumerable<Entry> entries, HashSet<string> wordset,
                                    JsonObject spellingConfig, IEnumerable<string> extraWords)
    {
        var allowed = new HashSet<string>();
        foreach (var key in new[] { "customDictionary", "ignore" })
            if (spellingConfig?[key] is JsonArray list)
                foreach (var word in list)
                    allowed.Add(word.ToString().ToLowerInvariant());
        foreach (var word in extraWords ?? Enumerable.Empty<string>())
            allowed.Add(word.ToLowerInvariant());

        var issues = new List<Issue>();
        foreach (var entry in entries)
        {
            foreach (var (display, parts) in Tokenizer.Tokenize(entry.Text))
            {
                if (allowed.Contains(display.ToLowerInvariant())) continue;
                if (parts.All(p => wordset.Contains(p) || allowed.Contains(p))) continue;
                var message = $"Possible misspelling: \"{display}\"";
                if (!string.IsNullOrEmpty(entry.Context)) message += $" ({entry.Context})";
                issues.Add(new Issue
                {
                    Category = "spelling", Severity = "warn", RuleId = "spelling",
                    FoundText = display, Page = entry.Page, ElementId = entry.ZoomTarget,
                    Message = message,
                });
            }
        }
        return issues;
    }
}

public static class RulesEngine
{
    private static Issue BadPattern(string ruleId, string pattern, Exception err) => new()
    {
        Category = "config", Severity = "warn", RuleId = ruleId, FoundText = pattern,
        Message = $"Invalid pattern for rule \"{ruleId}\": {err.Message} — rule skipped",
    };

    private static bool IsBlank(string value) => string.IsNullOrWhiteSpace(value);

    public static List<Issue> Evaluate(Snapshot snapshot, JsonObject rules)
    {
        var issues = new List<Issue>();
        EvaluateProjectRules(snapshot, rules, issues);
        var fieldRules = RulesStore.EnabledRules(rules, "titleBlock", "revision").ToList();
        foreach (var sheet in snapshot.Sheets.Where(s => !s.IsModelSpace))
            EvaluateFieldRules(sheet, fieldRules, issues);
        EvaluateNamingRules(snapshot, rules["revit"] as JsonObject, issues);
        // attribute values are text entries themselves, so formatting rules
        // see the title block without a separate params pass
        EvaluateFormattingRules(CollectTextEntries(snapshot),
                                RulesStore.EnabledRules(rules, "formatting"), issues);
        return issues;
    }

    private static void EvaluateFieldRules(SheetData sheet, List<JsonObject> fieldRules, List<Issue> issues)
    {
        foreach (var rule in fieldRules)
        {
            var ruleId = RulesStore.Str(rule, "id");
            var label = RulesStore.Str(rule, "label");
            var severity = RulesStore.Str(rule, "severity");
            var category = RulesStore.Str(rule, "category");
            string value;
            if (ruleId == "dwgNo")
            {
                value = sheet.Number;
            }
            else if (sheet.MissingParams.Contains(ruleId))
            {
                issues.Add(new Issue
                {
                    Category = category, Severity = "warn", RuleId = ruleId, Page = sheet.Number,
                    Message = $"Attribute for \"{label}\" not found on sheet — check the title " +
                              "block or add a paramMap entry in the rules file",
                });
                continue;
            }
            else
            {
                sheet.Params.TryGetValue(ruleId, out value);
            }

            if (IsBlank(value))
            {
                issues.Add(new Issue
                {
                    Category = category, Severity = severity, RuleId = ruleId, Page = sheet.Number,
                    Message = $"Missing required field \"{label}\"",
                });
                continue;
            }
            var pattern = RulesStore.Str(rule, "pattern");
            if (pattern == null) continue;
            bool matches;
            try { matches = Regex.IsMatch(value, pattern); }
            catch (Exception err) { issues.Add(BadPattern(ruleId, pattern, err)); continue; }
            if (!matches)
                issues.Add(new Issue
                {
                    Category = category, Severity = severity, RuleId = ruleId,
                    FoundText = value, Page = sheet.Number,
                    Message = $"Field \"{label}\" value \"{value}\" does not match expected format",
                });
        }
    }

    private static void EvaluateProjectRules(Snapshot snapshot, JsonObject rules, List<Issue> issues)
    {
        foreach (var field in (JsonArray)rules["project"])
        {
            var expected = RulesStore.Str(field, "value");
            if (IsBlank(expected)) continue;
            var id = RulesStore.Str(field, "id");
            var label = RulesStore.Str(field, "label");
            snapshot.ProjectInfo.TryGetValue(id, out var actual);
            if (IsBlank(actual) || actual.Trim() != expected)
                issues.Add(new Issue
                {
                    Category = "project", Severity = "error", RuleId = id, FoundText = actual,
                    Message = $"Project field \"{label}\" expected \"{expected}\" but found " +
                              $"\"{(IsBlank(actual) ? "(missing)" : actual)}\"",
                });
        }
    }

    private static void EvaluateNamingRules(Snapshot snapshot, JsonObject revitSettings, List<Issue> issues)
    {
        var pattern = RulesStore.Str(revitSettings, "sheetNamePattern");
        if (IsBlank(pattern)) return;
        Regex regex;
        try { regex = new Regex(pattern); }
        catch (Exception err) { issues.Add(BadPattern("sheetName", pattern, err)); return; }
        foreach (var sheet in snapshot.Sheets.Where(s => !s.IsModelSpace))
        {
            if (sheet.Name != null && !regex.IsMatch(sheet.Name))
                issues.Add(new Issue
                {
                    Category = "naming", Severity = "warn", RuleId = "sheetName",
                    FoundText = sheet.Name, Page = sheet.Number,
                    Message = $"Sheet name \"{sheet.Name}\" does not match the naming convention",
                });
        }
    }

    private static void EvaluateFormattingRules(List<Entry> entries, IEnumerable<JsonObject> rules,
                                                List<Issue> issues)
    {
        foreach (var rule in rules)
        {
            var ruleId = RulesStore.Str(rule, "id");
            Regex findRe, validRe;
            try
            {
                findRe = new Regex(RulesStore.Str(rule, "find") ?? "");
                validRe = new Regex(RulesStore.Str(rule, "valid") ?? "");
            }
            catch (Exception err)
            {
                issues.Add(BadPattern(ruleId, RulesStore.Str(rule, "find"), err));
                continue;
            }
            foreach (var entry in entries)
            {
                foreach (Match match in findRe.Matches(entry.Text ?? ""))
                {
                    if (!validRe.IsMatch(match.Value))
                        issues.Add(new Issue
                        {
                            Category = "formatting",
                            Severity = RulesStore.Str(rule, "severity") ?? "warn",
                            RuleId = ruleId, FoundText = match.Value, Page = entry.Page,
                            ElementId = entry.ZoomTarget, Message = RulesStore.Str(rule, "message"),
                        });
                }
            }
        }
    }

    public static List<Entry> CollectTextEntries(Snapshot snapshot)
    {
        var entries = new List<Entry>();
        foreach (var sheet in snapshot.Sheets)
        {
            if (!sheet.IsModelSpace)
                entries.Add(new Entry
                {
                    Text = sheet.Name, Page = sheet.Number, Context = "sheet name",
                });
            foreach (var note in sheet.TextNotes)
                entries.Add(new Entry
                {
                    Text = note.Text, Page = sheet.Number, Handle = note.Handle,
                    ZoomHandle = note.ZoomHandle,
                    Context = note.Context ?? "text note on sheet",
                });
        }
        return entries;
    }
}

public static class PatternBuilder
{
    private static string ClassToken(char c)
    {
        if (char.IsDigit(c)) return "\\d";
        if (c is >= 'A' and <= 'Z') return "[A-Z]";
        if (c is >= 'a' and <= 'z') return "[a-z]";
        return Regex.Escape(c.ToString());
    }

    public static string GeneralizePart(string part)
    {
        var builder = new StringBuilder();
        int i = 0;
        while (i < part.Length)
        {
            var token = ClassToken(part[i]);
            int run = 1;
            while (i + run < part.Length && ClassToken(part[i + run]) == token) run++;
            builder.Append(run == 1 ? token : $"{token}{{{run}}}");
            i += run;
        }
        return builder.ToString();
    }

    public static List<string> ParseVariableParts(string text)
    {
        var parts = new List<string>();
        foreach (var chunk in Regex.Split(text ?? "", "[,;\\n\\r]+"))
        {
            var part = chunk.Trim();
            if (part.Length > 0 && !parts.Contains(part)) parts.Add(part);
        }
        return parts;
    }

    public static string FromExample(string example, string variablePartsText)
    {
        example = (example ?? "").Trim();
        if (example.Length == 0)
            throw new ArgumentException("Type an example value first (e.g. AA-001).");

        var spans = new List<(int Start, int End, string Part)>();
        foreach (var part in ParseVariableParts(variablePartsText))
        {
            if (!example.Contains(part))
                throw new ArgumentException($"\"{part}\" is not part of the example \"{example}\".");
            int start = 0;
            while (true)
            {
                int index = example.IndexOf(part, start, StringComparison.Ordinal);
                if (index < 0) break;
                spans.Add((index, index + part.Length, part));
                start = index + part.Length;
            }
        }
        spans.Sort((a, b) => a.Start.CompareTo(b.Start));
        int previousEnd = -1;
        foreach (var span in spans)
        {
            if (span.Start < previousEnd)
                throw new ArgumentException("Variable parts overlap in the example — list each part once.");
            previousEnd = span.End;
        }

        var pattern = new StringBuilder("^");
        int position = 0;
        foreach (var span in spans)
        {
            pattern.Append(Regex.Escape(example[position..span.Start]));
            pattern.Append(GeneralizePart(span.Part));
            position = span.End;
        }
        pattern.Append(Regex.Escape(example[position..])).Append('$');
        return pattern.ToString();
    }
}

public static class TextSearch
{
    public static List<(Entry Entry, int Count)> FindMatches(IEnumerable<Entry> entries,
                                                             string find, bool matchCase)
    {
        var matches = new List<(Entry, int)>();
        if (string.IsNullOrEmpty(find)) return matches;
        var comparison = matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        foreach (var entry in entries)
        {
            // editable text: notes, leaders, dimension overrides, table cells,
            // block attribute values, and text inside block definitions (the
            // UI warns that definition edits affect every insert)
            if (entry.Handle == null || entry.Context == null
                || !(entry.Context.StartsWith("text note") || entry.Context.StartsWith("attribute")))
                continue;
            var text = entry.Text ?? "";
            int count = 0, index = 0;
            while ((index = text.IndexOf(find, index, comparison)) >= 0)
            {
                count++;
                index += find.Length;
            }
            if (count > 0) matches.Add((entry, count));
        }
        return matches;
    }

    public static string ReplaceText(string text, string find, string replace, bool matchCase) =>
        Regex.Replace(text ?? "", Regex.Escape(find), replace.Replace("$", "$$"),
                      matchCase ? RegexOptions.None : RegexOptions.IgnoreCase);

    /// One text transform applying every (find, replace) pair in order —
    /// batch replace runs this once per entity so the whole batch is a
    /// single model operation.
    public static Func<string, string> BuildTransform(
        IEnumerable<(string Find, string Replace)> pairs, bool matchCase)
    {
        var compiled = pairs
            .Where(p => !string.IsNullOrEmpty(p.Find))
            .Select(p => (
                Finder: new Regex(Regex.Escape(p.Find),
                                  matchCase ? RegexOptions.None : RegexOptions.IgnoreCase),
                Replacement: (p.Replace ?? "").Replace("$", "$$")))
            .ToList();
        return text =>
        {
            if (text == null) return null;
            foreach (var (finder, replacement) in compiled)
                text = finder.Replace(text, replacement);
            return text;
        };
    }
}

public class DrawingResult
{
    public string FileName;
    public bool Pass;
    public List<Issue> Issues = new();
    public int Errors;
    public int Warns;
}

public static class Report
{
    public static List<DrawingResult> BuildResults(Snapshot snapshot, List<Issue> issues)
    {
        var results = new List<DrawingResult>();
        var docIssues = issues.Where(i => i.Page == null).ToList();
        if (docIssues.Count > 0)
            results.Add(Build(snapshot.DocTitle ?? "Project", docIssues));
        foreach (var sheet in snapshot.Sheets)
            results.Add(Build($"{sheet.Number} — {sheet.Name}",
                              issues.Where(i => i.Page == sheet.Number).ToList()));
        return results;
    }

    private static DrawingResult Build(string fileName, List<Issue> issues) => new()
    {
        FileName = fileName,
        Pass = issues.All(i => i.Severity != "error"),
        Issues = issues,
        Errors = issues.Count(i => i.Severity == "error"),
        Warns = issues.Count(i => i.Severity != "error"),
    };

    public static string CsvField(string value)
    {
        var text = value ?? "";
        // OWASP CSV-injection mitigation, same as the other tools
        if (Regex.IsMatch(text, "^[=+\\-@\\t]")) text = "'" + text;
        return Regex.IsMatch(text, "[\",\\r\\n]") ? "\"" + text.Replace("\"", "\"\"") + "\"" : text;
    }

    public static string GenerateCsv(List<DrawingResult> results)
    {
        var rows = new List<string> { "fileName,pass,severity,category,ruleId,page,foundText,message" };
        foreach (var drawing in results)
            AppendDrawingRows(rows, drawing, null);
        return string.Join("\n", rows);
    }

    /// One combined CSV across many files, with a leading `file` column.
    public static string GenerateCsvForFiles(
        IEnumerable<(string File, List<DrawingResult> Results, string Error)> files)
    {
        var rows = new List<string>
            { "file,fileName,pass,severity,category,ruleId,page,foundText,message" };
        foreach (var (file, results, error) in files)
        {
            var name = Path.GetFileName(file);
            if (error != null)
            {
                rows.Add(string.Join(",", new[]
                    { name, "(could not open)", "false", "error", "extraction", "openFailed",
                      "", "", error }.Select(CsvField)));
                continue;
            }
            foreach (var drawing in results)
                AppendDrawingRows(rows, drawing, name);
        }
        return string.Join("\n", rows);
    }

    private static void AppendDrawingRows(List<string> rows, DrawingResult drawing, string filePrefix)
    {
        string Row(params string[] cells) =>
            string.Join(",", (filePrefix == null ? cells : cells.Prepend(filePrefix)).Select(CsvField));

        var pass = drawing.Pass ? "true" : "false";
        if (drawing.Issues.Count == 0)
            rows.Add(Row(drawing.FileName, pass, "", "", "", "", "", ""));
        foreach (var issue in drawing.Issues)
            rows.Add(Row(drawing.FileName, pass, issue.Severity, issue.Category, issue.RuleId,
                         issue.Page ?? "", issue.FoundText ?? "", issue.Message));
    }
}

/// Full check (rules + spelling) over one snapshot — shared by the window
/// and by multi-file batch processing.
public static class Checker
{
    public static List<Issue> Run(Snapshot snapshot, JsonObject rules, IEnumerable<string> extraWords)
    {
        var issues = RulesEngine.Evaluate(snapshot, rules);
        issues.AddRange(SpellChecker.Check(
            RulesEngine.CollectTextEntries(snapshot), Wordlist.Words(),
            rules["spelling"] as JsonObject, extraWords));
        return issues;
    }
}
