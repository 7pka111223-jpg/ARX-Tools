using System;
using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Arx.RuleCore;

namespace Arx.Revit.Commands
{
    // Model & Sheet QA — the Drawing Checker analog. Read-only (Transaction-free).
    [Transaction(TransactionMode.ReadOnly)]
    public sealed class QaCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData data, ref string message, ElementSet elements)
        {
            var doc = data.Application.ActiveUIDocument.Document;

            var rulesPath = Path.Combine(
                Path.GetDirectoryName(typeof(QaCommand).Assembly.Location), "arx-rules.json");
            if (!File.Exists(rulesPath))
            {
                message = "arx-rules.json not found next to the add-in.";
                return Result.Failed;
            }
            var config = RulesIo.Load(rulesPath);

            var pages = RevitExtractor.Collect(doc);
            var issues = Evaluator.EvaluateRules(pages, config);

            // Production: wrap WeCantSpell.Hunspell with the vendored en_US dictionary.
            // var hunspell = WordList.CreateFromFiles(dicPath, affPath);
            // ISpeller speller = new HunspellSpeller(hunspell);
            ISpeller speller = new SetSpeller(Array.Empty<string>());
            issues.AddRange(Speller.CheckSpelling(
                Evaluator.WordsOf(pages), speller, config.Spelling.Custom));

            var report = Path.Combine(Path.GetTempPath(), "arx-review.html");
            File.WriteAllText(report, Report.IssuesToHtml(issues, "ARX Model & Sheet QA"));
            File.WriteAllText(Path.ChangeExtension(report, ".csv"), Report.IssuesToCsv(issues));

            TaskDialog.Show("ARX Model & Sheet QA",
                $"{pages.Count} sheet(s) checked.\n{issues.Count} issue(s).\n\nReport: {report}");
            return Result.Succeeded;
        }
    }
}
