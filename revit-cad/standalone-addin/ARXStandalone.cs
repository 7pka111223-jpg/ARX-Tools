// ARX Tools — self-contained Revit add-in (NO third-party libraries).
//
// This host file is compiled together with the pure-BCL engine files from
// ../dotnet/RuleCore (Models, PatternBuilder, TitleBlockLocator, Evaluator,
// Speller, Report) into ONE assembly. RulesIo.cs (the only file that used
// System.Text.Json) is deliberately excluded — the rule set is embedded below
// instead, so the built DLL depends on nothing but Revit + the .NET BCL.
//
// Edit the rules in EmbeddedRules.Default(), then re-run build.ps1.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Arx.RuleCore;

namespace Arx.Revit.Standalone
{
    // ---- the rule set, in code (replaces arx-rules.json for the zero-dependency build) ----
    public static class EmbeddedRules
    {
        public static RuleSet Default()
        {
            var set = new RuleSet
            {
                TitleBlockRegion = new Region { Corner = "bottom-right", WidthPct = 40, HeightPct = 35 },
                Project = new List<ProjectField>
                {
                    new ProjectField { Id = "proj", Label = "PROJECT", Value = "RIYADH-METRO" },
                },
                Rules = new List<Rule>
                {
                    new Rule { Id = "dwgno", Label = "DWG NO", Category = "titleBlock", Severity = "error",
                               Example = "J2501-JPD-EBH-DG-20100", Variable = "20100" },
                    new Rule { Id = "rev", Label = "REV", Category = "revision", Severity = "warn",
                               Example = "A", Variable = "A" },
                    new Rule { Id = "revfmt", Category = "formatting", Severity = "warn",
                               Find = @"REV\s*[A-Za-z]", Valid = "REV [A-Z]",
                               Message = "Revision should read 'REV X' (single space, uppercase)" },
                },
                Spelling = new SpellingConfig
                {
                    Language = "en_US",
                    Custom = new List<string> { "ARX", "rebar", "invert", "chainage", "geotextile",
                                                "dwg", "drg", "rev", "det", "typ", "dim", "dia", "nts" },
                },
            };

            // Inline normalisation (what RulesIo.Normalize does): compile each
            // example/variable rule into an anchored pattern via the shared builder.
            foreach (var r in set.Rules)
                if ((r.Category == "titleBlock" || r.Category == "revision")
                    && string.IsNullOrEmpty(r.Pattern) && !string.IsNullOrEmpty(r.Example))
                    r.Pattern = PatternBuilder.Build(r.Example, r.Variable ?? "", r.Exact).Valid;
            return set;
        }
    }

    public sealed class App : IExternalApplication
    {
        public Result OnStartup(UIControlledApplication app)
        {
            const string tab = "ARX";
            try { app.CreateRibbonTab(tab); } catch { /* tab already exists */ }
            var panel = app.CreateRibbonPanel(tab, "Review");
            var asm = Assembly.GetExecutingAssembly().Location;
            panel.AddItem(new PushButtonData("ARXQa", "Model &\nSheet QA", asm,
                "Arx.Revit.Standalone.QaCommand")
            { ToolTip = "Title-block, formatting and spelling checks across every sheet." });
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app) => Result.Succeeded;
    }

    [Transaction(TransactionMode.ReadOnly)]
    public sealed class QaCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData data, ref string message, ElementSet elements)
        {
            var doc = data.Application.ActiveUIDocument.Document;
            var pages = Collect(doc);
            var config = EmbeddedRules.Default();

            var issues = Evaluator.EvaluateRules(pages, config);

            // Spelling: load the affix-expanded en_US.txt placed next to the DLL.
            var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var wordList = Path.Combine(dir, "en_US.txt");
            ISpeller speller = File.Exists(wordList)
                ? SetSpeller.FromFile(wordList)
                : new SetSpeller(new string[0]);
            issues.AddRange(Speller.CheckSpelling(
                Evaluator.WordsOf(pages), speller, config.Spelling.Custom));

            var report = Path.Combine(Path.GetTempPath(), "arx-review.html");
            File.WriteAllText(report, Report.IssuesToHtml(issues, "ARX Model & Sheet QA"));
            File.WriteAllText(Path.ChangeExtension(report, ".csv"), Report.IssuesToCsv(issues));

            TaskDialog.Show("ARX Model & Sheet QA",
                string.Format("{0} sheet(s) checked.\n{1} issue(s) found.\n\nReport written to:\n{2}",
                              pages.Count, issues.Count, report));
            return Result.Succeeded;
        }

        // Revit -> abstract pages (same shape the engine expects).
        private static List<Page> Collect(Document doc)
        {
            var pages = new List<Page>();
            foreach (var sheet in new FilteredElementCollector(doc)
                         .OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                var items = new List<TextItem>();

                var tb = new FilteredElementCollector(doc, sheet.Id)
                    .OfCategory(BuiltInCategory.OST_TitleBlocks).FirstElement();
                if (tb != null)
                    foreach (Parameter p in tb.Parameters)
                        if (p.HasValue && p.StorageType == StorageType.String)
                            items.Add(new TextItem { Text = p.AsString() ?? "", X = 0, Y = 0,
                                                     Label = p.Definition.Name });

                foreach (var tn in new FilteredElementCollector(doc, sheet.Id)
                             .OfClass(typeof(TextNote)).Cast<TextNote>())
                {
                    var bb = tn.get_BoundingBox(null);
                    items.Add(new TextItem
                    {
                        Text = tn.Text,
                        X = bb != null ? bb.Min.X : 0,
                        Y = bb != null ? bb.Min.Y : 0,
                        SourceId = tn.Id.IntegerValue,
                    });
                }

                var xs = items.Select(i => i.X).DefaultIfEmpty(0).ToList();
                var ys = items.Select(i => i.Y).DefaultIfEmpty(0).ToList();
                pages.Add(new Page
                {
                    PageNumber = sheet.SheetNumber,
                    Width = (xs.Max() - xs.Min()) == 0 ? 1 : xs.Max() - xs.Min(),
                    Height = (ys.Max() - ys.Min()) == 0 ? 1 : ys.Max() - ys.Min(),
                    Items = items,
                });
            }
            return pages;
        }
    }
}
