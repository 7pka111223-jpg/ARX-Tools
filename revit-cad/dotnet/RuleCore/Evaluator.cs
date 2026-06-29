using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Arx.RuleCore
{
    // Port of src/rulesEngine.js + the spell-word helpers.
    public static class Evaluator
    {
        public static List<Issue> EvaluateFieldRules(List<Page> pages, List<Rule> fieldRules, Region region)
        {
            var issues = new List<Issue>();
            foreach (var p in pages)
            {
                var fields = TitleBlockLocator.LocateFieldsOnPage(p, fieldRules, region);
                foreach (var rule in fieldRules)
                {
                    var r = fields[rule.Id];
                    if (!r.Found)
                        issues.Add(new Issue
                        {
                            Category = rule.Category, Severity = rule.Severity, RuleId = rule.Id,
                            FoundText = null, Page = p.PageNumber,
                            Message = "Missing required field \"" + rule.Label + "\"",
                        });
                    else if (!string.IsNullOrEmpty(rule.Pattern) && !r.Valid)
                        issues.Add(new Issue
                        {
                            Category = rule.Category, Severity = rule.Severity, RuleId = rule.Id,
                            FoundText = r.Value, Page = p.PageNumber,
                            Message = "Field \"" + rule.Label + "\" value \"" + r.Value + "\" does not match expected format",
                        });
                }
            }
            return issues;
        }

        public static List<Issue> EvaluateFormattingRules(List<Page> pages, List<Rule> formattingRules)
        {
            var issues = new List<Issue>();
            foreach (var rule in formattingRules)
            {
                if (!rule.Enabled) continue;
                var findRe = new Regex(rule.Find);
                var validRe = new Regex(rule.Valid);
                foreach (var p in pages)
                {
                    var text = string.Join(" ", p.Items.Select(it => it.Text));
                    foreach (Match m in findRe.Matches(text))
                    {
                        if (!validRe.IsMatch(m.Value))
                            issues.Add(new Issue
                            {
                                Category = "formatting", Severity = rule.Severity ?? "warn",
                                RuleId = rule.Id, FoundText = m.Value, Page = p.PageNumber,
                                Message = rule.Message,
                            });
                    }
                }
            }
            return issues;
        }

        public static List<Issue> EvaluateProjectRules(List<Page> pages, List<ProjectField> projectFields, Region region)
        {
            if (pages.Count == 0) return new List<Issue>();
            var first = pages[0];
            var required = projectFields.Where(f => !string.IsNullOrEmpty(f.Value))
                .Select(f => new Rule
                {
                    Id = f.Id, Category = "project", Label = f.Label,
                    Pattern = "^" + RegexUtil.EscapeRegex(f.Value) + "$",
                }).ToList();
            if (required.Count == 0) return new List<Issue>();

            var fields = TitleBlockLocator.LocateFieldsOnPage(first, required, region);
            var issues = new List<Issue>();
            foreach (var f in required)
            {
                var r = fields[f.Id];
                if (!r.Found || !r.Valid)
                {
                    var original = projectFields.First(pf => pf.Id == f.Id);
                    issues.Add(new Issue
                    {
                        Category = "project", Severity = "error", RuleId = f.Id,
                        FoundText = r.Value, Page = first.PageNumber,
                        Message = "Project field \"" + f.Label + "\" expected \"" + original.Value +
                                  "\" but found \"" + (r.Value ?? "(missing)") + "\"",
                    });
                }
            }
            return issues;
        }

        public static List<Issue> EvaluateRules(List<Page> pages, RuleSet config)
        {
            var region = config.TitleBlockRegion;
            var enabled = config.Rules.Where(r => r.Enabled).ToList();
            var titleBlock = enabled.Where(r => r.Category == "titleBlock").ToList();
            var revision = enabled.Where(r => r.Category == "revision").ToList();
            var formatting = enabled.Where(r => r.Category == "formatting").ToList();

            var issues = new List<Issue>();
            issues.AddRange(EvaluateProjectRules(pages, config.Project, region));
            issues.AddRange(EvaluateFieldRules(pages, titleBlock, region));
            issues.AddRange(EvaluateFieldRules(pages, revision, region));
            issues.AddRange(EvaluateFormattingRules(pages, formatting));
            return issues;
        }

        // {text,page} words for the speller (whitespace-split, like words_of).
        public static List<(string Text, string Page)> WordsOf(List<Page> pages)
        {
            var outp = new List<(string, string)>();
            foreach (var p in pages)
                foreach (var it in p.Items)
                    foreach (var tok in Regex.Split(it.Text, "\\s+"))
                        if (tok.Length > 0) outp.Add((tok, p.PageNumber));
            return outp;
        }
    }
}
