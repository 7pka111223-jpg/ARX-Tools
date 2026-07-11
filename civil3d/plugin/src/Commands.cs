// NETLOAD entry point: the ARXCHECK command opens the checker window on
// the active drawing. Config (rules path, export dir) is shared with the
// other ARX checkers at %APPDATA%\ARX-Tools\.
using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using Autodesk.AutoCAD.Runtime;
using ArxChecker.Core;
using ArxChecker.Ui;
using AcadApp = Autodesk.AutoCAD.ApplicationServices.Core.Application;

[assembly: CommandClass(typeof(ArxChecker.Commands))]
[assembly: ExtensionApplication(typeof(ArxChecker.PluginApp))]

namespace ArxChecker;

public class PluginApp : IExtensionApplication
{
    public void Initialize()
    {
        var editor = AcadApp.DocumentManager.MdiActiveDocument?.Editor;
        editor?.WriteMessage("\nARX Drawing Checker loaded — type ARXCHECK to run.\n");
    }

    public void Terminate() { }
}

public static class AppConfig
{
    // sentinel meaning "using the embedded default rules"
    public const string BundledMarker = "<bundled>";

    private static string ConfigPath() => AppDataFile("civil3d_config.json");

    public static string AppDataFile(string name)
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "ARX-Tools", name);
    }

    private static JsonObject Read()
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(ConfigPath(), Encoding.UTF8)) as JsonObject
                   ?? new JsonObject();
        }
        catch
        {
            return new JsonObject();
        }
    }

    public static string Get(string key)
    {
        var value = RulesStore.Str(Read(), key);
        return string.IsNullOrEmpty(value) ? null : value;
    }

    public static void Set(string key, string value)
    {
        var config = Read();
        config[key] = value;
        Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath()));
        File.WriteAllText(ConfigPath(), config.ToJsonString(), new UTF8Encoding(false));
    }
}

public class Commands
{
    private static (string Path, JsonObject Rules) LoadRules()
    {
        foreach (var candidate in new[] { AppConfig.Get("rules_path"),
                                          AppConfig.AppDataFile("rules.json") })
        {
            if (candidate != null && File.Exists(candidate))
                return (candidate, RulesStore.Load(File.ReadAllText(candidate, Encoding.UTF8)));
        }
        return (AppConfig.BundledMarker, RulesStore.Load(Data.GetText("default_rules.json")));
    }

    [CommandMethod("ARXCHECK", CommandFlags.Modal)]
    public void Check()
    {
        var doc = AcadApp.DocumentManager.MdiActiveDocument;
        if (doc == null)
        {
            MessageBox.Show("Open a drawing first.", "ARX Drawing Checker");
            return;
        }
        var license = Licensing.CheckLicense();
        if (!license.Allowed)
        {
            MessageBox.Show(license.Describe(), "ARX Drawing Checker — license",
                            MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (license.Warning)
            MessageBox.Show(license.Describe(), "ARX Drawing Checker — license",
                            MessageBoxButton.OK, MessageBoxImage.Information);
        try
        {
            var (rulesPath, rules) = LoadRules();
            var window = new CheckerWindow(doc, rulesPath, rules);
            AcadApp.ShowModalWindow(window.Win);
        }
        catch (System.Exception err)
        {
            MessageBox.Show(err.ToString(), "ARX Drawing Checker — error",
                            MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
