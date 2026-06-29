using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Arx.RuleCore;

namespace Arx.Revit
{
    // Revit -> RuleCore.Page. The ONLY Revit-coupled code in the checking path;
    // everything downstream is the shared, unit-tested engine.
    public static class RevitExtractor
    {
        public static List<Page> Collect(Document doc)
        {
            var pages = new List<Page>();
            foreach (var sheet in new FilteredElementCollector(doc)
                         .OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                var items = new List<TextItem>();

                var tb = new FilteredElementCollector(doc, sheet.Id)
                    .OfCategory(BuiltInCategory.OST_TitleBlocks).FirstElement();
                if (tb != null)
                {
                    foreach (Parameter p in tb.Parameters)
                    {
                        if (p.HasValue && p.StorageType == StorageType.String)
                            items.Add(new TextItem
                            {
                                Text = p.AsString() ?? "", X = 0, Y = 0,
                                Label = p.Definition.Name, SourceId = tb.Id.IntegerValue,
                            });
                    }
                }

                foreach (var tn in new FilteredElementCollector(doc, sheet.Id)
                             .OfClass(typeof(TextNote)).Cast<TextNote>())
                {
                    var bb = tn.get_BoundingBox(null);
                    items.Add(new TextItem
                    {
                        Text = tn.Text,
                        X = bb?.Min.X ?? 0, Y = bb?.Min.Y ?? 0,
                        SourceId = tn.Id.IntegerValue,
                    });
                }

                var xs = items.Select(i => i.X).DefaultIfEmpty(0).ToList();
                var ys = items.Select(i => i.Y).DefaultIfEmpty(0).ToList();
                pages.Add(new Page
                {
                    PageNumber = sheet.SheetNumber,
                    Width = (xs.Max() - xs.Min()) == 0 ? 1 : xs.Max() - xs.Min(),
                    Height = (ys.Max() - ys.Min()) == 0 ? 1 : ys.Max() - ys.Min(),
                    Items = items,
                });
            }
            return pages;
        }
    }
}
