using System.Collections.Generic;
using System.Linq;
using Arx.RuleCore;
using Xunit;

namespace Arx.RuleCore.Tests
{
    // Mirrors the verified Python tests (revit-cad/pyrevit/tests/test_rulecore.py)
    // so all three hosts (JS, Python, .NET) are checked against the same cases.
    public class RuleCoreTests
    {
        private static readonly Region FullRegion =
            new Region { Corner = "bottom-right", WidthPct = 100, HeightPct = 100 };

        private static Page MakePage(IEnumerable<string> texts, string num = "1") =>
            new Page
            {
                PageNumber = num, Width = 100, Height = 100,
                Items = texts.Select(t => new TextItem { Text = t, X = 50, Y = 50 }).ToList(),
            };

        [Fact]
        public void EscapeRegex_DoesNotEscapeSpaces()
            => Assert.Equal("A\\-1\\.0\\(x\\)", RegexUtil.EscapeRegex("A-1.0(x)"));

        [Fact]
        public void Build_ExampleAndVariable()
        {
            var b = PatternBuilder.Build("J2501-JPD-EBH-DG-20100", "20100", false);
            Assert.Null(b.Error);
            Assert.Equal("^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$", b.Valid);
            Assert.Contains("\\d+", b.Locate);
        }

        [Fact]
        public void Build_ExactMode_DoesNotEscapeSpace()
            => Assert.Equal("^REV A$", PatternBuilder.Build("REV A", null, true).Valid);

        [Fact]
        public void Build_VariableNotFound_IsError()
            => Assert.Contains("was not found", PatternBuilder.Build("ABC", "ZZ", false).Error);

        [Fact]
        public void TitleBlock_LabelOnly_DoesNotCaptureColon()
        {
            var page = MakePage(new[] { "REV:", "B" });
            var fields = TitleBlockLocator.LocateFieldsOnPage(
                page, new List<Rule> { new Rule { Id = "r", Label = "REV" } }, FullRegion);
            Assert.Equal("B", fields["r"].Value);
        }

        [Fact]
        public void EvaluateRules_FlagsBadFormatMissingFieldAndWrongProject()
        {
            var config = new RuleSet
            {
                TitleBlockRegion = FullRegion,
                Project = new List<ProjectField> { new ProjectField { Id = "proj", Label = "PROJECT", Value = "RIYADH" } },
                Rules = new List<Rule>
                {
                    new Rule { Id = "dwgno", Label = "DWG NO", Category = "titleBlock",
                               Severity = "error", Example = "A-100", Variable = "100" },
                    new Rule { Id = "revfmt", Category = "formatting", Severity = "warn",
                               Find = "REV\\s*[A-Za-z]", Valid = "REV [A-Z]",
                               Message = "Revision should read 'REV X'" },
                },
            };
            RulesIo.Normalize(config);

            var clean = new List<Page> { MakePage(new[] { "PROJECT: RIYADH", "DWG NO: A-100", "REV B" }) };
            Assert.Empty(Evaluator.EvaluateRules(clean, config));

            var bad = new List<Page> { MakePage(new[] { "PROJECT: DUBAI", "DWG NO: A-XYZ", "REV b" }) };
            var ids = Evaluator.EvaluateRules(bad, config).Select(i => i.RuleId).ToHashSet();
            Assert.Contains("dwgno", ids);
            Assert.Contains("revfmt", ids);
            Assert.Contains("proj", ids);
        }

        [Fact]
        public void Spelling_FlagsUnknownRespectsCustom()
        {
            var speller = new SetSpeller(new[] { "concrete", "the" });
            var pages = new List<Page> { MakePage(new[] { "the concrete concret rebar" }) };
            var issues = Speller.CheckSpelling(Evaluator.WordsOf(pages), speller,
                customDictionary: new[] { "rebar" });
            var found = issues.Select(i => i.FoundText.ToLowerInvariant()).ToHashSet();
            Assert.DoesNotContain("concrete", found);
            Assert.DoesNotContain("rebar", found);
            Assert.Contains("concret", found);
        }
    }
}
