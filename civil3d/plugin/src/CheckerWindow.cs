// The checker window: XAML is loaded at runtime from the embedded
// resource (no markup compilation), controls are looked up by name and
// wired to the handlers ported from the Revit checker.
using System.Data;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using Autodesk.AutoCAD.ApplicationServices;
using ArxChecker.Acad;
using ArxChecker.Core;

namespace ArxChecker.Ui;

public class CheckerWindow
{
    private static readonly (string Header, string Key)[] GridColumns =
    {
        ("Enabled", "enabled"), ("ID", "id"), ("Category", "category"), ("Label", "label"),
        ("Pattern", "pattern"), ("Find", "find"), ("Valid", "valid"),
        ("Severity", "severity"), ("Message", "message"),
    };

    public readonly Window Win;
    private readonly Document _doc;
    private string _rulesPath;
    private JsonObject _rules;
    private Snapshot _snapshot;
    private List<Issue> _issues = new();
    private List<DrawingResult> _results;
    private List<(Entry Entry, int Count)> _matches = new();
    private DataTable _rulesTable;

    // named controls
    private readonly TabControl _tabs;
    private readonly DataGrid _resultsGrid, _rulesGrid, _findGrid;
    private readonly TextBlock _summary, _hint, _rulesPathText, _testResult, _findSummary;
    private readonly TextBox _projectName, _projectNumber, _client, _sheetPattern, _customWords;
    private readonly TextBox _example, _variableParts, _generatedPattern, _testValue, _findBox, _replaceBox;
    private readonly CheckBox _matchCase, _includeModel;

    public CheckerWindow(Document doc, string rulesPath, JsonObject rules)
    {
        _doc = doc;
        _rulesPath = rulesPath;
        _rules = rules;

        using var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream("ui.CheckerWindow.xaml");
        Win = (Window)XamlReader.Load(stream);

        T Find<T>(string name) where T : class => Win.FindName(name) as T
            ?? throw new InvalidOperationException($"XAML control missing: {name}");

        _tabs = Find<TabControl>("MainTabs");
        _resultsGrid = Find<DataGrid>("ResultsGrid");
        _rulesGrid = Find<DataGrid>("RulesGrid");
        _findGrid = Find<DataGrid>("FindGrid");
        _summary = Find<TextBlock>("SummaryText");
        _hint = Find<TextBlock>("ResultsHint");
        _rulesPathText = Find<TextBlock>("RulesPathText");
        _testResult = Find<TextBlock>("TestResultText");
        _findSummary = Find<TextBlock>("FindSummaryText");
        _projectName = Find<TextBox>("ProjectNameBox");
        _projectNumber = Find<TextBox>("ProjectNumberBox");
        _client = Find<TextBox>("ClientBox");
        _sheetPattern = Find<TextBox>("SheetNamePatternBox");
        _customWords = Find<TextBox>("CustomWordsBox");
        _example = Find<TextBox>("ExampleBox");
        _variableParts = Find<TextBox>("VariablePartsBox");
        _generatedPattern = Find<TextBox>("GeneratedPatternBox");
        _testValue = Find<TextBox>("TestValueBox");
        _findBox = Find<TextBox>("FindBox");
        _replaceBox = Find<TextBox>("ReplaceBox");
        _matchCase = Find<CheckBox>("MatchCaseCheck");
        _includeModel = Find<CheckBox>("IncludeModelCheck");
        _includeModel.IsChecked = AppConfig.Get("include_model") != "false";
        _includeModel.Click += (_, _) => RunCheck();

        Wire("RunCheckBtn", (_, _) => RunCheck());
        Wire("ExportCsvBtn", (_, _) => ExportCsv());
        Wire("ExportPdfBtn", (_, _) => ExportPdf());
        Wire("ZoomBtn", (_, _) => ZoomSelected());
        Wire("AddWordBtn", (_, _) => AddWord());
        Wire("AddRuleBtn", (_, _) => AddRule());
        Wire("DeleteRuleBtn", (_, _) => DeleteRule());
        Wire("GeneratePatternBtn", (_, _) => GeneratePattern());
        Wire("TestPatternBtn", (_, _) => TestPattern());
        Wire("ApplyPatternBtn", (_, _) => ApplyPatternToRule());
        Wire("ApplySheetNameBtn", (_, _) => Guard(() => _sheetPattern.Text = RequirePattern()));
        Wire("SaveRulesBtn", (_, _) => SaveRules());
        Wire("ReloadRulesBtn", (_, _) => PopulateRulesForm());
        Wire("ImportRulesBtn", (_, _) => ImportRules());
        Wire("ExportRulesBtn", (_, _) => ExportRules());
        Wire("ImportDictBtn", (_, _) => ImportDictionary());
        Wire("ExportDictBtn", (_, _) => ExportDictionary());
        Wire("FindAllBtn", (_, _) => FindAll());
        Wire("ReplaceAllBtn", (_, _) => ReplaceAll());
        Wire("ZoomMatchBtn", (_, _) => ZoomMatch());
        _resultsGrid.MouseDoubleClick += (_, _) => ZoomSelected();
        _findGrid.MouseDoubleClick += (_, _) => ZoomMatch();

        PopulateRulesForm();
        RunCheck();
    }

    private void Wire(string name, RoutedEventHandler handler)
    {
        if (Win.FindName(name) is Button button) button.Click += handler;
    }

    private void Guard(Action action)
    {
        try { action(); }
        catch (Exception err)
        {
            MessageBox.Show(Win, err.ToString(), "ARX Drawing Checker",
                            MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Info(string message) =>
        MessageBox.Show(Win, message, "ARX Drawing Checker", MessageBoxButton.OK,
                        MessageBoxImage.Information);

    // ---------------------------------------------------------------- checks

    private IEnumerable<string> ExtraWords()
    {
        var extra = new HashSet<string>(Wordlist.Abbreviations());
        var path = AppConfig.Get("custom_dictionary_path")
                   ?? AppConfig.AppDataFile("custom_dictionary.txt");
        if (File.Exists(path))
            extra.UnionWith(Wordlist.ParseWordText(File.ReadAllText(path, Encoding.UTF8)));
        return extra;
    }

    private void RunCheck() => Guard(() =>
    {
        var includeModel = _includeModel.IsChecked == true;
        AppConfig.Set("include_model", includeModel ? "true" : "false");
        _snapshot = Adapter.BuildSnapshot(_doc.Database, _doc.Name, _rules, includeModel);
        var issues = RulesEngine.Evaluate(_snapshot, _rules);
        issues.AddRange(SpellChecker.Check(
            RulesEngine.CollectTextEntries(_snapshot), Wordlist.Words(),
            _rules["spelling"] as JsonObject, ExtraWords()));
        issues = issues
            .OrderBy(i => i.Page ?? "")
            .ThenBy(i => i.Severity == "error" ? 0 : 1)
            .ToList();
        _issues = issues;
        _results = Report.BuildResults(_snapshot, issues);

        var table = new DataTable();
        foreach (var column in new[] { "Severity", "Category", "Sheet", "Found", "Message", "Id" })
            table.Columns.Add(column);
        foreach (var issue in issues)
            table.Rows.Add(issue.Severity.ToUpperInvariant(), issue.Category,
                           issue.Page ?? "(project)", issue.FoundText ?? "",
                           issue.Message, issue.ElementId ?? "");
        _resultsGrid.ItemsSource = table.DefaultView;

        int errors = issues.Count(i => i.Severity == "error");
        _summary.Text = string.Format("{0} — {1} sheets, {2} errors, {3} warnings",
            errors == 0 ? "PASS" : "FAIL", _snapshot.Sheets.Count, errors, issues.Count - errors);
    });

    private Issue SelectedIssue()
    {
        if (_resultsGrid.SelectedItem is not DataRowView row)
        {
            Info("Select a row first.");
            return null;
        }
        var id = row["Id"] as string;
        var message = row["Message"] as string;
        return _issues.FirstOrDefault(i => (i.ElementId ?? "") == id && i.Message == message);
    }

    private void ZoomSelected() => Guard(() =>
    {
        var issue = SelectedIssue();
        if (issue == null) return;
        if (string.IsNullOrEmpty(issue.ElementId))
        {
            Info("This issue is not tied to a drawing object.");
            return;
        }
        Actions.ZoomTo(_doc, issue.ElementId, Adapter.LayoutForPage(_snapshot, issue.Page));
        _hint.Text = "Zoomed — close this window to work on it, then run ARXCHECK again.";
    });

    private void AddWord() => Guard(() =>
    {
        var issue = SelectedIssue();
        if (issue == null) return;
        if (issue.Category != "spelling")
        {
            Info("Pick a spelling issue to add its word to the dictionary.");
            return;
        }
        var spelling = (JsonObject)_rules["spelling"];
        var dictionary = spelling["customDictionary"] as JsonArray ?? new JsonArray();
        spelling["customDictionary"] = dictionary;
        if (dictionary.All(w => w.ToString() != issue.FoundText))
        {
            dictionary.Add(issue.FoundText);
            WriteRulesFile();
            PopulateRulesForm();
            RunCheck();
        }
    });

    private string AskSavePath(string extension, string defaultName, string filter)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            DefaultExt = "." + extension,
            FileName = defaultName,
            Filter = $"{filter} (*.{extension})|*.{extension}",
            InitialDirectory = AppConfig.Get("export_dir") ?? "",
        };
        if (dialog.ShowDialog(Win) != true) return null;
        AppConfig.Set("export_dir", Path.GetDirectoryName(dialog.FileName));
        return dialog.FileName;
    }

    private void ExportCsv() => Guard(() =>
    {
        if (_results == null) return;
        var path = AskSavePath("csv", "drawing-check-report", "CSV report");
        if (path == null) return;
        File.WriteAllText(path, Report.GenerateCsv(_results), new UTF8Encoding(true));
        Info("Report saved to:\n" + path);
    });

    private void ExportPdf() => Guard(() =>
    {
        if (_snapshot == null || _snapshot.Sheets.Count == 0) return;
        var path = AskSavePath("pdf", "annotated-drawings", "PDF");
        if (path == null) return;
        var (sheets, markers) = Actions.ExportAnnotatedPdf(_doc, _snapshot, _issues, path);
        Info($"Exported {sheets} sheet(s) with {markers} red marker(s) to:\n{path}\n\n" +
             "The markers exist only in the PDF — the drawing is unchanged.");
    });

    // ----------------------------------------------------------------- rules

    private void PopulateRulesForm() => Guard(() =>
    {
        string ProjectValue(string id) =>
            ((JsonArray)_rules["project"]).Cast<JsonObject>()
                .Where(f => RulesStore.Str(f, "id") == id)
                .Select(f => RulesStore.Str(f, "value") ?? "").FirstOrDefault() ?? "";

        _projectName.Text = ProjectValue("name");
        _projectNumber.Text = ProjectValue("number");
        _client.Text = ProjectValue("client");
        _sheetPattern.Text = RulesStore.Str(_rules["revit"], "sheetNamePattern") ?? "";
        var dictionary = (_rules["spelling"] as JsonObject)?["customDictionary"] as JsonArray;
        _customWords.Text = dictionary == null ? ""
            : string.Join("\n", dictionary.Select(w => w.ToString()));
        _rulesPathText.Text = "Rules file: " + RulesSavePath();

        _rulesTable = new DataTable();
        _rulesTable.Columns.Add("Enabled", typeof(bool));
        foreach (var (header, _) in GridColumns.Skip(1))
            _rulesTable.Columns.Add(header);
        foreach (var rule in ((JsonArray)_rules["rules"]).Cast<JsonObject>())
            _rulesTable.Rows.Add(RulesStore.Flag(rule, "enabled"),
                RulesStore.Str(rule, "id") ?? "", RulesStore.Str(rule, "category") ?? "",
                RulesStore.Str(rule, "label") ?? "", RulesStore.Str(rule, "pattern") ?? "",
                RulesStore.Str(rule, "find") ?? "", RulesStore.Str(rule, "valid") ?? "",
                RulesStore.Str(rule, "severity") ?? "warn", RulesStore.Str(rule, "message") ?? "");
        _rulesGrid.ItemsSource = _rulesTable.DefaultView;
    });

    private void AddRule() => Guard(() =>
        _rulesTable.Rows.Add(true, $"rule{_rulesTable.Rows.Count + 1}", "titleBlock",
                             "", "", "", "", "warn", ""));

    private void DeleteRule() => Guard(() =>
    {
        if (_rulesGrid.SelectedItem is not DataRowView row)
        {
            Info("Select a rule row first.");
            return;
        }
        row.Row.Delete();
        _rulesTable.AcceptChanges();
    });

    private JsonArray GridToRules()
    {
        _rulesGrid.CommitEdit(DataGridEditingUnit.Cell, true);
        _rulesGrid.CommitEdit(DataGridEditingUnit.Row, true);
        var rules = new JsonArray();
        var seen = new HashSet<string>();
        foreach (DataRow row in _rulesTable.Rows)
        {
            string Text(string header) => (row[header] as string ?? "").Trim();
            var texts = GridColumns.Skip(1).ToDictionary(c => c.Key, c => Text(c.Header));
            if (texts.Values.All(string.IsNullOrEmpty)) continue;
            var id = texts["id"];
            if (id.Length == 0)
                throw new ArgumentException($"Every rule needs an ID (row with label \"{texts["label"]}\")");
            if (!seen.Add(id))
                throw new ArgumentException($"Duplicate rule ID \"{id}\"");
            var category = texts["category"].Length > 0 ? texts["category"] : "titleBlock";
            if (!RulesStore.ValidCategories.Contains(category))
                throw new ArgumentException(
                    $"Rule \"{id}\": category must be one of {string.Join(", ", RulesStore.ValidCategories)}");
            if (category == "formatting" && (texts["find"].Length == 0 || texts["valid"].Length == 0))
                throw new ArgumentException($"Rule \"{id}\": formatting rules need both find and valid regexes");

            var rule = new JsonObject
            {
                ["id"] = id,
                ["category"] = category,
                ["label"] = texts["label"].Length > 0 ? texts["label"] : id,
                ["severity"] = texts["severity"].Length > 0 ? texts["severity"] : "warn",
                ["message"] = texts["message"].Length > 0 ? texts["message"]
                    : $"Check failed for \"{(texts["label"].Length > 0 ? texts["label"] : id)}\"",
                ["enabled"] = row["Enabled"] is bool flag && flag,
            };
            foreach (var key in new[] { "pattern", "find", "valid" })
                if (texts[key].Length > 0) rule[key] = texts[key];
            RulesStore.ValidateRule(rule);
            rules.Add(rule);
        }
        return rules;
    }

    private JsonObject RulesFromUi()
    {
        var updated = (JsonObject)JsonNode.Parse(_rules.ToJsonString());
        updated["rules"] = GridToRules();

        foreach (var field in ((JsonArray)updated["project"]).Cast<JsonObject>())
        {
            var value = RulesStore.Str(field, "id") switch
            {
                "name" => _projectName.Text,
                "number" => _projectNumber.Text,
                "client" => _client.Text,
                _ => null,
            };
            if (value != null) field["value"] = value.Trim();
        }

        var pattern = _sheetPattern.Text.Trim();
        if (pattern.Length > 0)
        {
            try { _ = new Regex(pattern); }
            catch (Exception err)
            {
                throw new ArgumentException($"Invalid regex for layout name pattern: {err.Message}");
            }
        }
        ((JsonObject)updated["revit"])["sheetNamePattern"] =
            pattern.Length > 0 ? pattern : null;

        var words = new JsonArray();
        foreach (var word in Wordlist.ParseWordList(_customWords.Text)) words.Add(word);
        ((JsonObject)updated["spelling"])["customDictionary"] = words;
        return updated;
    }

    private string RulesSavePath()
    {
        if (!string.IsNullOrEmpty(_rulesPath) && _rulesPath != AppConfig.BundledMarker)
            return _rulesPath;
        return AppConfig.AppDataFile("rules.json");
    }

    private void WriteRulesFile()
    {
        var path = RulesSavePath();
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, RulesStore.Dumps(_rules), new UTF8Encoding(false));
        _rulesPath = path;
        _rulesPathText.Text = "Rules file: " + path;
    }

    private void SaveRules() => Guard(() =>
    {
        try
        {
            _rules = RulesFromUi();
        }
        catch (ArgumentException err)
        {
            Info(err.Message);
            return;
        }
        WriteRulesFile();
        PopulateRulesForm();
        RunCheck();
        _tabs.SelectedIndex = 0;
    });

    private void ImportRules() => Guard(() =>
    {
        var dialog = new Microsoft.Win32.OpenFileDialog { Filter = "Rules file (*.json)|*.json" };
        if (dialog.ShowDialog(Win) != true) return;
        try
        {
            _rules = RulesStore.Load(File.ReadAllText(dialog.FileName, Encoding.UTF8));
        }
        catch (Exception err)
        {
            Info("Could not import rules:\n" + err.Message);
            return;
        }
        _rulesPath = dialog.FileName;
        AppConfig.Set("rules_path", dialog.FileName);
        PopulateRulesForm();
        RunCheck();
    });

    private void ExportRules() => Guard(() =>
    {
        JsonObject rules;
        try
        {
            rules = RulesFromUi();
        }
        catch (ArgumentException err)
        {
            Info(err.Message);
            return;
        }
        var path = AskSavePath("json", "rules", "Rules file");
        if (path == null) return;
        File.WriteAllText(path, RulesStore.Dumps(rules), new UTF8Encoding(false));
        Info($"Rules exported to:\n{path}\n\nThis file also works in the web and Revit checkers.");
    });

    private void ImportDictionary() => Guard(() =>
    {
        var dialog = new Microsoft.Win32.OpenFileDialog { Filter = "Word list (*.txt)|*.txt" };
        if (dialog.ShowDialog(Win) != true) return;
        var imported = Wordlist.ParseWordList(File.ReadAllText(dialog.FileName, Encoding.UTF8));
        var existing = Wordlist.ParseWordList(_customWords.Text);
        var added = imported.Where(w => !existing.Contains(w)).ToList();
        _customWords.Text = string.Join("\n", existing.Concat(added));
        Info($"{added.Count} word(s) added ({imported.Count - added.Count} already present).\n\n" +
             "Click \"Save Rules and Re-run\" to apply.");
    });

    private void ExportDictionary() => Guard(() =>
    {
        var words = Wordlist.ParseWordList(_customWords.Text);
        var path = AskSavePath("txt", "custom_dictionary", "Word list");
        if (path == null) return;
        File.WriteAllText(path, string.Join("\n", words) + (words.Count > 0 ? "\n" : ""),
                          new UTF8Encoding(false));
        Info($"Exported {words.Count} word(s) to:\n{path}");
    });

    // ------------------------------------------------------- pattern builder

    private string RequirePattern()
    {
        if (string.IsNullOrEmpty(_generatedPattern.Text))
            throw new ArgumentException("Generate a pattern first.");
        return _generatedPattern.Text;
    }

    private void GeneratePattern() => Guard(() =>
    {
        try
        {
            _generatedPattern.Text = PatternBuilder.FromExample(_example.Text, _variableParts.Text);
        }
        catch (ArgumentException err)
        {
            Info(err.Message);
            return;
        }
        if (_testValue.Text.Length > 0) TestPattern();
        else _testResult.Text = "";
    });

    private void TestPattern() => Guard(() =>
    {
        if (string.IsNullOrEmpty(_generatedPattern.Text))
        {
            Info("Generate a pattern first.");
            return;
        }
        var matches = Regex.IsMatch(_testValue.Text, _generatedPattern.Text);
        _testResult.Text = $"\"{_testValue.Text}\" {(matches ? "MATCHES" : "does NOT match")} the pattern";
    });

    private void ApplyPatternToRule() => Guard(() =>
    {
        var pattern = RequirePattern();
        if (_rulesGrid.SelectedItem is not DataRowView row)
        {
            Info("Select a rule row in the grid first.");
            return;
        }
        row["Pattern"] = pattern;
        Info($"Pattern applied to rule \"{row["ID"]}\".\n\nClick \"Save Rules and Re-run\" to apply.");
    });

    // -------------------------------------------------------- find & replace

    private List<(Entry Entry, int Count)> CurrentMatches()
    {
        if (_snapshot == null) RunCheck();
        return Core.TextSearch.FindMatches(RulesEngine.CollectTextEntries(_snapshot),
                                           _findBox.Text, _matchCase.IsChecked == true);
    }

    private void ShowMatches(List<(Entry Entry, int Count)> matches)
    {
        _matches = matches;
        var table = new DataTable();
        foreach (var column in new[] { "Sheet", "Where", "Matches", "Text", "Id" })
            table.Columns.Add(column);
        foreach (var (entry, count) in matches)
            table.Rows.Add(entry.Page ?? "", entry.Context ?? "", count.ToString(),
                           entry.Text ?? "", entry.Handle ?? "");
        _findGrid.ItemsSource = table.DefaultView;
        _findSummary.Text = $"{matches.Sum(m => m.Count)} occurrence(s) in {matches.Count} text object(s).";
    }

    private void FindAll() => Guard(() =>
    {
        if (_findBox.Text.Length == 0)
        {
            Info("Type the text to find first.");
            return;
        }
        ShowMatches(CurrentMatches());
    });

    private void ReplaceAll() => Guard(() =>
    {
        if (_findBox.Text.Length == 0)
        {
            Info("Type the text to find first.");
            return;
        }
        var matches = CurrentMatches();
        if (matches.Count == 0)
        {
            Info("No occurrences found.");
            return;
        }
        var total = matches.Sum(m => m.Count);
        var question = $"Replace {total} occurrence(s) of \"{_findBox.Text}\" with " +
                       $"\"{_replaceBox.Text}\" in {matches.Count} text object(s)?";
        var inBlockDefinitions = matches.Count(m => m.Entry.Context.Contains("in block"));
        if (inBlockDefinitions > 0)
            question += $"\n\nWARNING: {inBlockDefinitions} of them are inside block definitions " +
                        "(e.g. the title block) — replacing those updates EVERY insert of the " +
                        "block, on every layout that uses it.";
        if (MessageBox.Show(Win, question, "ARX Drawing Checker", MessageBoxButton.YesNo,
                            MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        var (changed, skipped) = Actions.ReplaceInTexts(
            _doc, matches.Select(m => m.Entry.Handle), _findBox.Text, _replaceBox.Text,
            _matchCase.IsChecked == true);
        RunCheck();
        ShowMatches(CurrentMatches());
        var message = $"Updated {changed} text object(s).";
        if (skipped > 0)
            message += $"\n{skipped} object(s) were skipped (the match is interrupted by inline " +
                       "formatting — edit those by hand).";
        Info(message);
    });

    private void ZoomMatch() => Guard(() =>
    {
        if (_findGrid.SelectedItem is not DataRowView row)
        {
            Info("Select a match first.");
            return;
        }
        var handle = row["Id"] as string;
        var page = row["Sheet"] as string;
        if (string.IsNullOrEmpty(handle)) return;
        // for text inside a block definition, zoom to the insert instead
        var match = _matches.FirstOrDefault(m => m.Entry.Handle == handle);
        Actions.ZoomTo(_doc, match.Entry?.ZoomTarget ?? handle,
                       Adapter.LayoutForPage(_snapshot, page));
    });
}
