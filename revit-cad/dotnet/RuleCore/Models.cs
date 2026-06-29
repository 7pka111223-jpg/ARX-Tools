using System.Collections.Generic;

namespace Arx.RuleCore
{
    // The abstract document model — the single integration boundary. Every host
    // (PDF/JS, Revit, AutoCAD) produces these shapes; the engine never sees the
    // host format. Mirrors the PDF tool's page/item/issue objects.

    public sealed class TextItem
    {
        public string Text { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public string Label { get; set; }
        public int SourceId { get; set; } = -1;
    }

    public sealed class Page
    {
        public string PageNumber { get; set; } = "";
        public double Width { get; set; }
        public double Height { get; set; }
        public List<TextItem> Items { get; set; } = new List<TextItem>();
    }

    public sealed class Issue
    {
        public string Category { get; set; }
        public string Severity { get; set; }
        public string RuleId { get; set; }
        public string FoundText { get; set; }
        public string Page { get; set; }
        public string Message { get; set; }
    }

    public sealed class Region
    {
        public string Corner { get; set; } = "bottom-right";
        public double WidthPct { get; set; } = 40;
        public double HeightPct { get; set; } = 35;
    }

    public sealed class ProjectField
    {
        public string Id { get; set; }
        public string Label { get; set; }
        public string Value { get; set; }
    }

    // One rule type covers title-block / revision (example+variable -> pattern)
    // and formatting (find/valid) rules, matching the JSON contract.
    public sealed class Rule
    {
        public string Id { get; set; }
        public string Label { get; set; }
        public string Category { get; set; }
        public string Severity { get; set; } = "warn";
        public bool Enabled { get; set; } = true;

        // title-block / revision
        public string Example { get; set; }
        public string Variable { get; set; }
        public bool Exact { get; set; }
        public string Pattern { get; set; }   // compiled by RulesIo.Normalize

        // formatting
        public string Find { get; set; }
        public string Valid { get; set; }
        public string Message { get; set; }
    }

    public sealed class SpellingConfig
    {
        public string Language { get; set; } = "en_US";
        public List<string> Custom { get; set; } = new List<string>();
    }

    public sealed class RuleSet
    {
        public Region TitleBlockRegion { get; set; } = new Region();
        public List<ProjectField> Project { get; set; } = new List<ProjectField>();
        public List<Rule> Rules { get; set; } = new List<Rule>();
        public SpellingConfig Spelling { get; set; } = new SpellingConfig();
    }

    public sealed class FieldResult
    {
        public string Value { get; set; }
        public bool Found { get; set; }
        public bool Valid { get; set; }
    }

    public sealed class PatternResult
    {
        public string Valid { get; set; }
        public string Locate { get; set; }
        public string Explanation { get; set; }
        public string Warning { get; set; }
        public string Error { get; set; }
    }
}
