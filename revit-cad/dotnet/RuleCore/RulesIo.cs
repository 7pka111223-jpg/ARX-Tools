using System;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Arx.RuleCore
{
    // Load + normalise the shared arx-rules.json (same file the PDF tool and a
    // future AutoCAD add-in consume). Example/variable title-block & revision
    // rules are compiled into anchored patterns via the shared PatternBuilder.
    public static class RulesIo
    {
        private static readonly JsonSerializerOptions Opts = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,   // titleBlockRegion/widthPct match PascalCase props
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        };

        public static RuleSet Parse(string json)
        {
            var set = JsonSerializer.Deserialize<RuleSet>(json, Opts) ?? new RuleSet();
            Normalize(set);
            return set;
        }

        public static RuleSet Load(string path) => Parse(File.ReadAllText(path, Encoding.UTF8));

        public static void Normalize(RuleSet set)
        {
            if (set.TitleBlockRegion == null) set.TitleBlockRegion = new Region();
            foreach (var rule in set.Rules)
            {
                if ((rule.Category == "titleBlock" || rule.Category == "revision")
                    && string.IsNullOrEmpty(rule.Pattern) && !string.IsNullOrEmpty(rule.Example))
                {
                    var built = PatternBuilder.Build(rule.Example, rule.Variable ?? "", rule.Exact);
                    if (built.Error != null)
                        throw new InvalidDataException("Rule \"" + rule.Id + "\": " + built.Error);
                    rule.Pattern = built.Valid;
                }
            }
        }
    }
}
