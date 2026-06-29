using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Arx.RuleCore
{
    // Port of src/titleBlockLocator.js.
    public static class TitleBlockLocator
    {
        private struct Box { public double XMin, XMax, YMin, YMax; }

        private static Box ComputeRegionBox(double pageW, double pageH, Region region)
        {
            if (!Regex.IsMatch(region.Corner ?? "", "^(top|bottom)-(left|right)$"))
                throw new ArgumentException(
                    "Invalid region.corner \"" + region.Corner + "\": expected top/bottom-left/right.");

            double w = pageW * (region.WidthPct / 100.0);
            double h = pageH * (region.HeightPct / 100.0);
            bool right = region.Corner.Contains("right");
            bool bottom = region.Corner.Contains("bottom");
            return new Box
            {
                XMin = right ? pageW - w : 0,
                XMax = right ? pageW : w,
                YMin = bottom ? pageH - h : 0,
                YMax = bottom ? pageH : h,
            };
        }

        private static bool InBox(TextItem it, Box b) =>
            it.X >= b.XMin && it.X <= b.XMax && it.Y >= b.YMin && it.Y <= b.YMax;

        private static Regex SameItem(string label) =>
            new Regex("^\\s*" + RegexUtil.EscapeRegex(label) + "\\s*[:\\-]?\\s*(\\S+)", RegexOptions.IgnoreCase);

        private static Regex LabelOnly(string label) =>
            new Regex("^\\s*" + RegexUtil.EscapeRegex(label) + "\\s*[:\\-]?\\s*$", RegexOptions.IgnoreCase);

        private static bool LooksLikeAnotherLabel(string text, IEnumerable<Rule> fields, string excludeId)
        {
            foreach (var other in fields)
            {
                if (other.Id == excludeId) continue;
                if (LabelOnly(other.Label).IsMatch(text) || SameItem(other.Label).IsMatch(text)) return true;
            }
            return false;
        }

        private static string FindFieldValue(List<TextItem> items, Rule field, List<Rule> required)
        {
            var sameRe = SameItem(field.Label);
            var labelOnlyRe = LabelOnly(field.Label);

            for (int i = 0; i < items.Count; i++)
            {
                var text = items[i].Text;
                // label-only first, to avoid the [:\-]? backtracking capture (see JS note)
                if (labelOnlyRe.IsMatch(text))
                {
                    if (i + 1 >= items.Count) return null;
                    var next = items[i + 1];
                    if (LooksLikeAnotherLabel(next.Text, required, field.Id)) return null;
                    var trimmed = next.Text.Trim();
                    return trimmed.Length > 0 ? trimmed : null;
                }
                var m = sameRe.Match(text);
                if (m.Success) return m.Groups[1].Value;
            }
            return null;
        }

        public static Dictionary<string, FieldResult> LocateFieldsOnPage(
            Page page, List<Rule> requiredFields, Region region)
        {
            var box = ComputeRegionBox(page.Width, page.Height, region);
            var items = page.Items.Where(it => InBox(it, box))
                            .OrderBy(it => it.Y).ThenBy(it => it.X).ToList();

            var fields = new Dictionary<string, FieldResult>();
            foreach (var f in requiredFields)
            {
                var value = FindFieldValue(items, f, requiredFields);
                bool valid = value != null &&
                             (string.IsNullOrEmpty(f.Pattern) || Regex.IsMatch(value, f.Pattern));
                fields[f.Id] = new FieldResult { Value = value, Found = value != null, Valid = valid };
            }
            return fields;
        }
    }
}
