using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Arx.RuleCore
{
    public static class Report
    {
        private static string Csv(string v)
        {
            v = v ?? "";
            return v.IndexOfAny(new[] { ',', '"', '\n' }) >= 0
                ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
        }

        public static string IssuesToCsv(IEnumerable<Issue> issues)
        {
            var sb = new StringBuilder();
            sb.Append("page,severity,category,ruleId,foundText,message\n");
            foreach (var i in issues)
                sb.Append(string.Join(",", new[]
                {
                    Csv(i.Page), Csv(i.Severity), Csv(i.Category),
                    Csv(i.RuleId), Csv(i.FoundText), Csv(i.Message),
                })).Append('\n');
            return sb.ToString();
        }

        private static string H(string s) => (s ?? "")
            .Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");

        public static string IssuesToHtml(IEnumerable<Issue> issues, string title = "ARX Review Report")
        {
            var list = issues.ToList();
            var rows = string.Concat(list.Select(i =>
                "<tr><td>" + H(i.Page) + "</td><td class='" + H(i.Severity) + "'>" + H(i.Severity) +
                "</td><td>" + H(i.Category) + "</td><td>" + H(i.RuleId) + "</td><td>" +
                H(i.FoundText) + "</td><td>" + H(i.Message) + "</td></tr>"));
            return "<!doctype html><meta charset='utf-8'><title>" + H(title) + "</title>" +
                   "<style>body{font:13px system-ui;margin:24px}th,td{border:1px solid #cbd5e1;padding:6px 9px}" +
                   "table{border-collapse:collapse}.error{color:#b91c1c;font-weight:600}.warn{color:#b45309}</style>" +
                   "<h1>" + H(title) + "</h1><p>" + list.Count + " issue(s)</p>" +
                   "<table><tr><th>Sheet</th><th>Severity</th><th>Category</th><th>Rule</th>" +
                   "<th>Found</th><th>Message</th></tr>" +
                   (rows.Length > 0 ? rows : "<tr><td colspan=6>No issues found.</td></tr>") + "</table>";
        }
    }
}
