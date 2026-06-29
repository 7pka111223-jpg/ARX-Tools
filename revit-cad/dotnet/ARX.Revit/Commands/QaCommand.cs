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

            // Loads the bundled, affix-expanded en_US.txt placed next to the add-in
            // by the installer. (For affix-aware checking you may instead wrap
            // WeCantSpell.Hunspell with the en_US .aff/.dic — see Speller.cs.)
            var wordList = Path.Combine(
                Path.GetDirectoryName(typeof(QaCommand).Assembly.Location), "en_US.txt");
            ISpeller speller = File.Exists(wordList)
                ? SetSpeller.FromFile(wordList)
                : new SetSpeller(Array.Empty<string>());
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
