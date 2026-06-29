using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Arx.RuleCore
{
    public static class RegexUtil
    {
        private static readonly HashSet<char> Special =
            new HashSet<char>(".*+?^${}()|[]\\-");

        // Port of src/util.js escapeRegex — note spaces are NOT escaped.
        public static string EscapeRegex(string value)
        {
            var sb = new StringBuilder();
            foreach (var c in value ?? "")
            {
                if (Special.Contains(c)) sb.Append('\\');
                sb.Append(c);
            }
            return sb.ToString();
        }
    }

    // Port of the Rule Check tool's buildPattern (+ toRuns/runToPattern/runToLoose).
    public static class PatternBuilder
    {
        private sealed class Run { public string Cls; public string Text; }

        private static readonly Dictionary<string, string> ClassLabel =
            new Dictionary<string, string>
            {
                { "digit", "digit" }, { "upper", "uppercase letter" }, { "lower", "lowercase letter" }
            };

        private static string Classify(char ch)
        {
            if (ch >= '0' && ch <= '9') return "digit";
            if (ch >= 'A' && ch <= 'Z') return "upper";
            if (ch >= 'a' && ch <= 'z') return "lower";
            return "literal";
        }

        private static List<Run> ToRuns(string text)
        {
            var runs = new List<Run>();
            foreach (var ch in text)
            {
                var cls = Classify(ch);
                if (runs.Count > 0 && runs[runs.Count - 1].Cls == cls)
                    runs[runs.Count - 1].Text += ch;
                else
                    runs.Add(new Run { Cls = cls, Text = ch.ToString() });
            }
            return runs;
        }

        private static string RunToPattern(Run r)
        {
            if (r.Cls == "literal") return RegexUtil.EscapeRegex(r.Text);
            var cls = r.Cls == "digit" ? "\\d" : r.Cls == "upper" ? "[A-Z]" : "[a-z]";
            return r.Text.Length == 1 ? cls : cls + "{" + r.Text.Length + "}";
        }

        private static string RunToLoose(Run r)
        {
            if (r.Cls == "literal") return RegexUtil.EscapeRegex(r.Text);
            return r.Cls == "digit" ? "\\d+" : r.Cls == "upper" ? "[A-Z]+" : "[a-z]+";
        }

        private static string RunToDesc(Run r)
        {
            if (r.Cls == "literal") return "the text \"" + r.Text + "\"";
            int n = r.Text.Length;
            return n + " " + ClassLabel[r.Cls] + (n == 1 ? "" : "s");
        }

        public static PatternResult Build(string example, string variablePart, bool exact)
        {
            if (string.IsNullOrEmpty(example))
                return new PatternResult { Error = "Enter an example value first." };

            if (exact)
            {
                return new PatternResult
                {
                    Valid = "^" + RegexUtil.EscapeRegex(example) + "$",
                    Locate = "(?<![A-Za-z0-9])" + RegexUtil.EscapeRegex(example) + "(?![A-Za-z0-9])",
                    Explanation = "Will match exactly: \"" + example + "\"",
                };
            }

            if (string.IsNullOrEmpty(variablePart))
                return new PatternResult { Error = "Enter the part of the example that changes — or set exact to true." };

            int index = example.IndexOf(variablePart, System.StringComparison.Ordinal);
            if (index == -1)
                return new PatternResult { Error = "\"" + variablePart + "\" was not found inside the example value." };

            string warning = example.IndexOf(variablePart, index + 1, System.StringComparison.Ordinal) != -1
                ? "\"" + variablePart + "\" appears more than once in the example — the first occurrence was used."
                : null;

            string prefix = example.Substring(0, index);
            string suffix = example.Substring(index + variablePart.Length);
            var runs = ToRuns(variablePart);

            string valid = "^" + RegexUtil.EscapeRegex(prefix)
                         + string.Concat(runs.Select(RunToPattern))
                         + RegexUtil.EscapeRegex(suffix) + "$";
            string locate = "(?<![A-Za-z0-9])" + RegexUtil.EscapeRegex(prefix)
                          + string.Concat(runs.Select(RunToLoose))
                          + RegexUtil.EscapeRegex(suffix) + "(?![A-Za-z0-9])";

            var parts = new List<string>();
            if (prefix.Length > 0) parts.Add("the text \"" + prefix + "\"");
            parts.AddRange(runs.Select(RunToDesc));
            if (suffix.Length > 0) parts.Add("the text \"" + suffix + "\"");

            return new PatternResult
            {
                Valid = valid,
                Locate = locate,
                Explanation = "Will match: " + string.Join(" + ", parts),
                Warning = warning,
            };
        }
    }
}
