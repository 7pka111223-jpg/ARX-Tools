using System;
using System.Reflection;
using Autodesk.Revit.UI;

namespace Arx.Revit
{
    // Builds the "ARX" ribbon tab on startup. Each tool is an IExternalCommand
    // (see Commands/). All checking logic lives in Arx.RuleCore — this assembly
    // is only the Revit host + UI.
    public sealed class App : IExternalApplication
    {
        public Result OnStartup(UIControlledApplication app)
        {
            const string tab = "ARX";
            try { app.CreateRibbonTab(tab); } catch { /* already exists */ }

            var panel = app.CreateRibbonPanel(tab, "Review");
            var asm = Assembly.GetExecutingAssembly().Location;

            AddButton(panel, asm, "Arx.Revit.Commands.QaCommand", "ModelSheetQa",
                      "Model &\nSheet QA", "Run title-block, formatting and spelling checks over every sheet.");
            // Wire the remaining commands the same way as they are implemented:
            // AddButton(panel, asm, "Arx.Revit.Commands.FindReplaceCommand", ...);
            // AddButton(panel, asm, "Arx.Revit.Commands.StandardsCommand",   ...);
            // AddButton(panel, asm, "Arx.Revit.Commands.FinderAuditCommand", ...);
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app) => Result.Succeeded;

        private static void AddButton(RibbonPanel panel, string asmPath, string className,
                                      string name, string text, string tooltip)
        {
            var data = new PushButtonData(name, text, asmPath, className) { ToolTip = tooltip };
            panel.AddItem(data);
        }
    }
}
