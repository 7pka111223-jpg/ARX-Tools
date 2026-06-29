using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Arx.RuleCore
{
    // Any speller works as long as it can answer Correct(word). In production wrap
    // WeCantSpell.Hunspell loaded with the same en_US .aff/.dic the PDF tool ships:
    //
    //   var h = WordList.CreateFromFiles("en_US.dic", "en_US.aff");
    //   ISpeller speller = new HunspellSpeller(h);   // Correct => h.Check(word)
    public interface ISpeller
    {
        bool Correct(string word);
    }

    // Minimal set-backed speller (host-free, used by unit tests).
    public sealed class SetSpeller : ISpeller
    {
        private readonly HashSet<string> _words;
        public SetSpeller(IEnumerable<string> words) =>
            _words = new HashSet<string>(words.Select(w => w.ToLowerInvariant()));
        public bool Correct(string word) => _words.Contains(word.ToLowerInvariant());

        // Load the bundled, affix-expanded en_US.txt (the same list the pyRevit
        // tool ships) so spelling works without a Hunspell dependency.
        public static SetSpeller FromFile(string path) =>
            new SetSpeller(System.IO.File.ReadLines(path));
    }

    // Port of src/spellChecker.js checkSpelling.
    public static class Speller
    {
        public static List<Issue> CheckSpelling(
            IEnumerable<(string Text, string Page)> words, ISpeller speller,
            IEnumerable<string> customDictionary = null, IEnumerable<string> ignore = null)
        {
            var custom = new HashSet<string>((customDictionary ?? Enumerable.Empty<string>())
                .Select(w => w.ToLowerInvariant()));
            var ign = new HashSet<string>((ignore ?? Enumerable.Empty<string>())
                .Select(w => w.ToLowerInvariant()));

            var issues = new List<Issue>();
            foreach (var w in words)
            {
                var clean = Regex.Replace(w.Text, "[^A-Za-z'-]", "");
                if (clean.Length == 0 || !Regex.IsMatch(clean, "[A-Za-z]")) continue;
                var lower = clean.ToLowerInvariant();
                if (custom.Contains(lower) || ign.Contains(lower)) continue;
                if (!speller.Correct(clean))
                    issues.Add(new Issue
                    {
                        Category = "spelling", Severity = "warn", RuleId = "spelling",
                        FoundText = w.Text, Page = w.Page,
                        Message = "Possible misspelling: \"" + w.Text + "\"",
                    });
            }
            return issues;
        }
    }
}
