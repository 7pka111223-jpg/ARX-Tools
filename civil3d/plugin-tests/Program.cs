// Headless smoke test for the C# core port: runs the same scenario the
// Python suite covers and fails loudly on any mismatch.
// Usage: ARX_DATA_DIR=<data dir> dotnet run
using System.Text.RegularExpressions;
using ArxChecker.Core;

int failures = 0;
void Check(bool condition, string what)
{
    if (!condition) { failures++; Console.WriteLine("FAIL: " + what); }
}

// ---- rules store ----
var rules = RulesStore.DefaultRules();
Check(((System.Text.Json.Nodes.JsonArray)rules["rules"]).Count == 7, "default rules count");
try { RulesStore.Load("{}"); Check(false, "empty rules should be rejected"); }
catch (ArgumentException) { }
var roundTrip = RulesStore.Load(RulesStore.Dumps(rules));
Check(RulesStore.Str(roundTrip["revit"], "sheetNamePattern") == null, "revit block round-trip");

// ---- tokenizer ----
var tokens = Tokenizer.Tokenize("300MM AS-BUILT ENGINEER'S (CONCRETE). GA");
Check(tokens.Count == 3, "tokenizer count, got " + tokens.Count);
Check(tokens[0].Display == "AS-BUILT" && tokens[0].Parts.SequenceEqual(new[] { "built" }), "hyphen parts");
Check(tokens[1].Parts.SequenceEqual(new[] { "engineer" }), "possessive strip");
Check(tokens[2].Parts.SequenceEqual(new[] { "concrete" }), "punctuation strip");

// ---- wordlist + spelling ----
var words = Wordlist.Words();
Check(words.Count > 100000, "wordlist size " + words.Count);
Check(words.Contains("concrete") && !words.Contains("detale"), "wordlist contents");
var entries = new List<Entry>
{
    new() { Text = "REFER TO DETALE 5", Page = "C-101", Handle = "A1", Context = "text note on sheet" },
    new() { Text = "GALV UPSTAND", Page = "C-101", Handle = "A2", Context = "text note on sheet" },
};
var spellIssues = SpellChecker.Check(entries, words, null, Wordlist.Abbreviations());
Check(spellIssues.Count == 1 && spellIssues[0].FoundText == "DETALE", "spelling flags DETALE only");
Check(spellIssues[0].Severity == "warn" && spellIssues[0].Page == "C-101", "spelling issue shape");

// ---- rules engine on a broken snapshot ----
var snapshot = new Snapshot
{
    DocTitle = "site.dwg",
    ProjectInfo = new() { ["number"] = "P-999" },
    Sheets =
    {
        new SheetData
        {
            LayoutName = "C-101", Number = "A101", Name = "Ground floor plan",
            Params = new() { ["rev"] = "B", ["date"] = "07/01/2026", ["drawnBy"] = "AH", ["checkedBy"] = "" },
            MissingParams = { "approvedBy" },
            TextNotes =
            {
                new TextItem { Handle = "A1", Text = "ISSUED 12/31/2025" },
                new TextItem { Handle = "A9", Text = "07/01/2026", Context = "attribute \"DATE\"" },
                new TextItem { Handle = "A5", ZoomHandle = "B7", Text = "STANDARD DETALE NOTE",
                               Context = "text note in block \"TITLE\"" },
            },
        },
    },
};
var testRules = RulesStore.DefaultRules();
((System.Text.Json.Nodes.JsonArray)testRules["project"])[1]["value"] = "P-100";
((System.Text.Json.Nodes.JsonObject)testRules["revit"])["sheetNamePattern"] = "^[A-Z0-9 \\-]+$";
var issues = RulesEngine.Evaluate(snapshot, testRules);
List<Issue> ByRule(string id) => issues.Where(i => i.RuleId == id).ToList();
Check(ByRule("number").Count == 1 && ByRule("number")[0].Severity == "error", "project number mismatch");
Check(ByRule("dwgNo").Count == 1 && ByRule("dwgNo")[0].FoundText == "A101", "dwgNo format error");
Check(ByRule("checkedBy").Count == 1 && ByRule("checkedBy")[0].Message.Contains("Missing required"),
      "empty checkedBy is missing");
Check(ByRule("approvedBy").Count == 1 && ByRule("approvedBy")[0].Severity == "warn",
      "missing attribute is a warn");
Check(ByRule("sheetName").Count == 1, "layout naming rule");
Check(ByRule("isoDate").Select(i => i.FoundText).OrderBy(x => x)
      .SequenceEqual(new[] { "07/01/2026", "12/31/2025" }), "isoDate in attribute and text");
var blockEntries = RulesEngine.CollectTextEntries(snapshot);
var snapshotSpell = SpellChecker.Check(blockEntries, words, null, Wordlist.Abbreviations());
Check(snapshotSpell.Any(i => i.FoundText == "DETALE" && i.ElementId == "B7"),
      "block text spelling issue zooms to the insert");

// attribute + block-definition entries are replaceable in find & replace
Check(TextSearch.FindMatches(blockEntries, "07/01/2026", false).Count == 1, "attribute searchable");
var blockMatch = TextSearch.FindMatches(blockEntries, "DETALE NOTE", false);
Check(blockMatch.Count == 1 && blockMatch[0].Entry.Handle == "A5"
      && blockMatch[0].Entry.ZoomTarget == "B7", "block text searchable with real handle");

// ---- pattern builder ----
var pattern = PatternBuilder.FromExample("AA-001", "001");
Check(Regex.IsMatch("AA-999", pattern) && !Regex.IsMatch("AB-123", pattern)
      && !Regex.IsMatch("AA-99", pattern), "AA-001 pattern behavior");
Check(PatternBuilder.GeneralizePart("S1") == "[A-Z]\\d", "mixed part generalization");
try { PatternBuilder.FromExample("AA-001", "999"); Check(false, "bad variable part rejected"); }
catch (ArgumentException) { }

// ---- text search / replace ----
var matches = TextSearch.FindMatches(entries, "detale", false);
Check(matches.Count == 1 && matches[0].Count == 1, "find matches");
Check(TextSearch.ReplaceText("DETALE and detale", "detale", "DETAIL", false) == "DETAIL and DETAIL",
      "case-insensitive replace");
Check(TextSearch.ReplaceText("x", "x", "a$b", false) == "a$b", "dollar literal in replacement");

// ---- batch transform (multiple find/replace pairs applied in order) ----
var batch = TextSearch.BuildTransform(new[]
{
    ("DETALE", "DETAIL"),
    ("REFER", "SEE"),
    ("12/31/2025", "2025-12-31"),
}, matchCase: false);
Check(batch("REFER TO DETALE 5") == "SEE TO DETAIL 5", "batch applies all pairs");
Check(batch("ISSUED 12/31/2025") == "ISSUED 2025-12-31", "batch third pair");
Check(batch("nothing here") == "nothing here", "batch leaves non-matches alone");
var emptyBatch = TextSearch.BuildTransform(new[] { ("", "X"), ("GALV", "GALVANISED") }, false);
Check(emptyBatch("GALV UPSTAND") == "GALVANISED UPSTAND", "batch skips empty find terms");
var caseBatch = TextSearch.BuildTransform(new[] { ("detale", "DETAIL") }, matchCase: true);
Check(caseBatch("DETALE and detale") == "DETALE and DETAIL", "batch respects match case");

// ---- csv ----
var results = Report.BuildResults(snapshot, issues);
var csv = Report.GenerateCsv(results);
Check(csv.StartsWith("fileName,pass,severity,category,ruleId,page,foundText,message"), "csv header");
Check(csv.Contains("site.dwg,false,error,project,number"), "csv project row");
Check(Report.CsvField("=SUM(A1)") == "'=SUM(A1)", "csv injection guard");
Check(Report.CsvField("a,b") == "\"a,b\"", "csv quoting");

// ---- multi-file check + combined csv ----
var fullIssues = Checker.Run(snapshot, testRules, Wordlist.Abbreviations());
Check(fullIssues.Any(i => i.RuleId == "dwgNo") && fullIssues.Any(i => i.RuleId == "spelling"),
      "Checker.Run does rules + spelling in one pass");
var multiCsv = Report.GenerateCsvForFiles(new (string, List<DrawingResult>, string)[]
{
    ("P:\\job\\site.dwg", Report.BuildResults(snapshot, issues), null),
    ("P:\\job\\broken.dwg", null, "drawing is corrupt"),
});
Check(multiCsv.StartsWith("file,fileName,pass,severity,category,ruleId,page,foundText,message"),
      "multi-file csv header has file column");
Check(multiCsv.Contains("site.dwg,site.dwg,false,error,project,number"), "multi-file csv row prefixed with file");
Check(multiCsv.Contains("broken.dwg,(could not open)") && multiCsv.Contains("drawing is corrupt"),
      "multi-file csv reports open failures");

// ---- licensing (verifies the SAME fixtures as the Python suite, locking
// the two implementations together) ----
var fixturesDir = Environment.GetEnvironmentVariable("ARX_FIXTURES_DIR")
                  ?? Path.Combine("revit", "tests", "fixtures");
Check(Licensing.FingerprintFromString("TEST-MACHINE-GUID") == "337D-1DB6-F946-6C08",
      "fingerprint matches the Python known vector");
Check(Licensing.FingerprintFromString(" Test-Machine-GUID ") == "337D-1DB6-F946-6C08",
      "fingerprint normalizes case and whitespace");
var testMachine = "337D-1DB6-F946-6C08";
var publicKey = (System.Text.Json.Nodes.JsonObject)System.Text.Json.Nodes.JsonNode.Parse(
    File.ReadAllText(Path.Combine(fixturesDir, "license_test_key_public.json")));
var testModulus = RulesStore.Str(publicKey, "n");
long Day(string date) => DateTimeOffset.Parse(date + "T12:00:00Z").ToUnixTimeSeconds();

LicenseStatus Lic(string name, string machine = null, long? now = null) =>
    Licensing.CheckLicense(Path.Combine(fixturesDir, name), now ?? Day("2026-07-11"),
                           machine ?? testMachine, testModulus, statePath: null);

var unconfigured = Licensing.CheckLicense(modulusHex: "");
Check(unconfigured.State == "unconfigured" && unconfigured.Allowed, "unconfigured key runs free");
var valid = Lic("license_valid.lic");
Check(valid.State == "valid" && valid.Allowed && !valid.Warning, "valid node-locked license");
Check(RulesStore.Str(valid.Payload, "licensee") == "Test Firm Ltd", "payload readable");
Check(Lic("license_tampered.lic").State == "invalid", "tampered payload rejected");
Check(Lic("license_valid.lic", machine: "FFFF-0000-FFFF-0000").State == "wrong_machine",
      "wrong machine blocked");
Check(Lic("no_such.lic").State == "missing", "missing license blocked");
var perpetual = Lic("license_perpetual.lic", machine: "FFFF-0000-FFFF-0000");
Check(perpetual.State == "valid" && perpetual.DaysLeft == null, "perpetual license any machine");
var expiring = Lic("license_valid.lic", now: Day("2092-12-25"));
Check(expiring.State == "valid" && expiring.Warning, "expiring-soon warns");
var grace = Lic("license_expired.lic", now: Day("2020-01-05"));
Check(grace.State == "grace" && grace.Allowed && grace.Warning, "grace period after expiry");
Check(Lic("license_expired.lic", now: Day("2020-02-01")).State == "expired",
      "expired beyond grace blocked");
var blockedText = Lic("license_valid.lic", machine: "FFFF-0000-FFFF-0000").Describe();
Check(blockedText.Contains("FFFF-0000-FFFF-0000"), "describe shows machine id when blocked");

var stateFile = Path.Combine(Path.GetTempPath(), "arx-smoke-" + Guid.NewGuid() + ".json");
try
{
    var fresh = Licensing.CheckLicense(Path.Combine(fixturesDir, "license_valid.lic"),
        Day("2026-07-11"), testMachine, testModulus, stateFile);
    Check(fresh.State == "valid", "clock guard first run valid");
    var rolled = Licensing.CheckLicense(Path.Combine(fixturesDir, "license_valid.lic"),
        Day("2026-07-01"), testMachine, testModulus, stateFile);
    Check(rolled.State == "clock" && !rolled.Allowed, "clock rollback blocked");
}
finally { File.Delete(stateFile); }

Console.WriteLine(failures == 0 ? "ALL CORE SMOKE TESTS PASSED" : $"{failures} FAILURE(S)");
return failures == 0 ? 0 : 1;
