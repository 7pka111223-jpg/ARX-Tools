// ARX QA — Revit MACRO version (zero external libraries, zero external apps,
// no compiler install). Revit's built-in Macro Manager compiles this in-process.
//
// HOW TO USE (any Revit 2021+):
//   1. Revit -> Manage tab -> Macro Manager.
//   2. Under "Application", click Create. Pick C#. Name it "ARX". This opens
//      Revit's built-in code editor (SharpDevelop) with a ThisApplication class.
//   3. Paste the ARX_QA() method and the helpers below INSIDE the
//      ThisApplication class (next to the auto-generated Module_Startup).
//   4. Add the three `using` lines at the top of the file if not present.
//   5. Build (the hammer/Build button), then back in Macro Manager select
//      ARX_QA and click Run. If prompted, allow macros (Manage -> Macro Security).
//
// This is a compact, dependency-free subset (title-block + format rules across
// every sheet). For full features (spelling, find & replace, audit) use the
// compiled add-in in ../ — same engine, just packaged as a DLL.

// using System;
// using System.Linq;
// using System.Text;
// using Autodesk.Revit.DB;
// using Autodesk.Revit.UI;

public void ARX_QA()
{
    // ---- edit these to your project ----
    string project      = "RIYADH-METRO";                 // expected PROJECT value
    string dwgExample    = "J2501-JPD-EBH-DG-20100";      // a correct drawing number
    string dwgVariable   = "20100";                        // the part that changes
    // ------------------------------------

    var doc = this.ActiveUIDocument.Document;
    string dwgPattern = "^" + PatternFromExample(dwgExample, dwgVariable) + "$";
    var sb = new System.Text.StringBuilder();
    int issues = 0;

    foreach (ViewSheet sheet in new FilteredElementCollector(doc)
                 .OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
    {
        var tb = new FilteredElementCollector(doc, sheet.Id)
            .OfCategory(BuiltInCategory.OST_TitleBlocks).FirstElement();
        if (tb == null) continue;

        string dwg = ParamValue(tb, "DWG NO") ?? ParamValue(tb, "Drawing Number") ?? ParamValue(tb, "Sheet Number");
        string proj = ParamValue(tb, "PROJECT") ?? ParamValue(tb, "Project Name");

        if (proj != null && proj != project)
        { sb.AppendLine(sheet.SheetNumber + ": PROJECT is \"" + proj + "\" (expected \"" + project + "\")"); issues++; }

        if (dwg == null)
        { sb.AppendLine(sheet.SheetNumber + ": drawing number field is missing/empty"); issues++; }
        else if (!System.Text.RegularExpressions.Regex.IsMatch(dwg, dwgPattern))
        { sb.AppendLine(sheet.SheetNumber + ": drawing number \"" + dwg + "\" doesn't match the expected format"); issues++; }
    }

    TaskDialog.Show("ARX QA",
        (issues == 0 ? "All sheets pass." : issues + " issue(s):\n\n" + sb.ToString()));
}

// First non-empty string parameter whose name matches `label` (case-insensitive).
private string ParamValue(Element e, string label)
{
    foreach (Parameter p in e.Parameters)
        if (p.HasValue && p.StorageType == StorageType.String &&
            string.Equals(p.Definition.Name, label, System.StringComparison.OrdinalIgnoreCase))
        {
            string v = p.AsString();
            return string.IsNullOrEmpty(v) ? null : v.Trim();
        }
    return null;
}

// Compact port of the ARX "example + variable" pattern builder: the variable
// part becomes \d{n}/[A-Z]{n}/[a-z]{n}; the fixed prefix/suffix are literal.
private string PatternFromExample(string example, string variable)
{
    int i = example.IndexOf(variable, System.StringComparison.Ordinal);
    if (i < 0) return System.Text.RegularExpressions.Regex.Escape(example);
    string prefix = example.Substring(0, i);
    string suffix = example.Substring(i + variable.Length);

    var sb = new System.Text.StringBuilder();
    int k = 0;
    while (k < variable.Length)
    {
        char c = variable[k];
        System.Func<char, bool> cls =
            char.IsDigit(c) ? (System.Func<char, bool>)char.IsDigit :
            (c >= 'A' && c <= 'Z') ? (x => x >= 'A' && x <= 'Z') :
            (c >= 'a' && c <= 'z') ? (x => x >= 'a' && x <= 'z') : null;
        if (cls == null) { sb.Append(System.Text.RegularExpressions.Regex.Escape(c.ToString())); k++; continue; }
        int n = 0; while (k < variable.Length && cls(variable[k])) { n++; k++; }
        string token = char.IsDigit(c) ? "\\d" : (c >= 'A' && c <= 'Z') ? "[A-Z]" : "[a-z]";
        sb.Append(n == 1 ? token : token + "{" + n + "}");
    }
    return System.Text.RegularExpressions.Regex.Escape(prefix) + sb.ToString() + System.Text.RegularExpressions.Regex.Escape(suffix);
}
