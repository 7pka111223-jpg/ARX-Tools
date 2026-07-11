// Offline licensing gate — the C# mirror of drawingchecker/licensing.py.
// Both tools read the same %APPDATA%\ARX-Tools\license.lic (RSA-2048
// PKCS#1 v1.5 / SHA-256 signed payload) and derive the same machine
// fingerprint from the Windows MachineGuid, so one license covers the
// Revit extension and this plugin on a machine.
//
// While PublicKeyModulusHex is empty, licensing is OFF (state
// "unconfigured", tools run free). To enforce it, run
// `python3 tools/license_admin.py keygen` and paste the printed constant
// here and in licensing.py, then rebuild.
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace ArxChecker.Core;

public class LicenseStatus
{
    public string State;        // unconfigured | valid | grace | missing |
                                // invalid | wrong_machine | expired | clock
    public bool Allowed;
    public bool Warning;
    public string Message;
    public JsonObject Payload;
    public int? DaysLeft;
    public string MachineId;
    public string LicensePath;

    public string Describe()
    {
        var lines = new List<string> { Message };
        var licensee = RulesStore.Str(Payload, "licensee");
        var licenseId = RulesStore.Str(Payload, "licenseId");
        if (!string.IsNullOrEmpty(licensee)) lines.Add("Licensed to: " + licensee);
        if (!string.IsNullOrEmpty(licenseId)) lines.Add("License ID: " + licenseId);
        if (!Allowed)
        {
            if (State == "missing" && LicensePath != null)
            {
                lines.Add("");
                lines.Add("Place your license file at:");
                lines.Add("  " + LicensePath);
            }
            lines.Add("");
            lines.Add("To purchase or fix a license, send this machine ID to support:");
            lines.Add("  Machine ID: " + (MachineId ?? Licensing.MachineFingerprint()));
        }
        return string.Join("\n", lines);
    }
}

public static class Licensing
{
    // Vendor public key — paste the value printed by
    //   python3 tools/license_admin.py keygen
    // Empty = licensing disabled (development / internal builds).
    public const string PublicKeyModulusHex = "";
    public const int PublicKeyExponent = 65537;

    public const string ProductId = "arx-drawing-checker";
    public const string LicenseFormat = "arx-license/1";
    public const int ExpiryWarningDays = 14;
    public const int DefaultGraceDays = 7;
    public const long ClockToleranceSeconds = 2 * 86400;

    // ---- machine fingerprint (identical derivation to the Python side) ----

    public static string FingerprintFromString(string raw)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(raw.Trim().ToLowerInvariant()));
        var compact = Convert.ToHexString(digest)[..16];
        return string.Join("-", Enumerable.Range(0, 4).Select(i => compact.Substring(i * 4, 4)));
    }

    public static string MachineFingerprint()
    {
        var overrideId = Environment.GetEnvironmentVariable("ARX_MACHINE_ID");
        if (!string.IsNullOrEmpty(overrideId)) return FingerprintFromString(overrideId);
        if (OperatingSystem.IsWindows())
        {
            try
            {
                var guid = Microsoft.Win32.Registry.GetValue(
                    @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography",
                    "MachineGuid", null) as string;
                if (!string.IsNullOrEmpty(guid)) return FingerprintFromString(guid);
            }
            catch { }
        }
        return FingerprintFromString(Environment.MachineName);
    }

    // ---- signature verification ----

    public static bool VerifySignature(byte[] payload, byte[] signature,
                                       string modulusHex, int exponent)
    {
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportParameters(new RSAParameters
            {
                Modulus = Convert.FromHexString(
                    modulusHex.Length % 2 == 1 ? "0" + modulusHex : modulusHex),
                Exponent = ExponentBytes(exponent),
            });
            return rsa.VerifyData(payload, signature, HashAlgorithmName.SHA256,
                                  RSASignaturePadding.Pkcs1);
        }
        catch
        {
            return false;
        }
    }

    private static byte[] ExponentBytes(int exponent)
    {
        var bytes = BitConverter.GetBytes(exponent);
        if (BitConverter.IsLittleEndian) Array.Reverse(bytes);
        var start = Array.FindIndex(bytes, b => b != 0);
        return bytes[(start < 0 ? bytes.Length - 1 : start)..];
    }

    // ---- clock-rollback guard (shares license_state.json with Python) ----

    private static bool CheckClock(string statePath, long now)
    {
        if (statePath == null) return true;
        long lastSeen = 0;
        try
        {
            var state = JsonNode.Parse(File.ReadAllText(statePath, Encoding.UTF8));
            lastSeen = (long)(state?["lastSeen"]?.GetValue<double>() ?? 0);
        }
        catch { }
        if (now + ClockToleranceSeconds < lastSeen) return false;
        if (now > lastSeen)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(statePath));
                File.WriteAllText(statePath,
                    new JsonObject { ["lastSeen"] = now }.ToJsonString(),
                    new UTF8Encoding(false));
            }
            catch { }
        }
        return true;
    }

    // ---- license check ----

    private static long? ParseDate(string value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        var date = DateTime.SpecifyKind(
            DateTime.ParseExact(value, "yyyy-MM-dd", null), DateTimeKind.Utc);
        return new DateTimeOffset(date).ToUnixTimeSeconds();
    }

    public static string DefaultLicensePath() =>
        Environment.GetEnvironmentVariable("ARX_LICENSE_FILE")
        ?? AppDataFile("license.lic");

    private static string AppDataFile(string name) =>
        Path.Combine(Environment.GetFolderPath(
            Environment.SpecialFolder.ApplicationData), "ARX-Tools", name);

    private static LicenseStatus Status(string state, string message, bool allowed,
        bool warning = false, JsonObject payload = null, int? daysLeft = null,
        string machineId = null, string licensePath = null) => new()
    {
        State = state, Message = message, Allowed = allowed, Warning = warning,
        Payload = payload, DaysLeft = daysLeft, MachineId = machineId,
        LicensePath = licensePath,
    };

    public static LicenseStatus CheckLicense(string licensePath = null,
        long? nowEpoch = null, string machineId = null,
        string modulusHex = null, string statePath = "<default>")
    {
        modulusHex ??= PublicKeyModulusHex;
        if (string.IsNullOrEmpty(modulusHex))
            return Status("unconfigured",
                "Licensing is not configured; running in unrestricted mode.", true);

        licensePath ??= DefaultLicensePath();
        if (statePath == "<default>") statePath = AppDataFile("license_state.json");
        machineId ??= MachineFingerprint();
        var now = nowEpoch ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        if (licensePath == null || !File.Exists(licensePath))
            return Status("missing", "No license file was found.", false,
                          machineId: machineId, licensePath: licensePath);

        string payloadText;
        byte[] signature;
        try
        {
            var envelope = (JsonObject)JsonNode.Parse(
                File.ReadAllText(licensePath, Encoding.UTF8));
            if (RulesStore.Str(envelope, "format") != LicenseFormat)
                throw new FormatException("unsupported format");
            payloadText = RulesStore.Str(envelope, "payload");
            signature = Convert.FromBase64String(RulesStore.Str(envelope, "signature"));
        }
        catch
        {
            return Status("invalid", "The license file could not be read.", false,
                          machineId: machineId, licensePath: licensePath);
        }

        if (!VerifySignature(Encoding.UTF8.GetBytes(payloadText), signature,
                             modulusHex, PublicKeyExponent))
            return Status("invalid", "The license signature is not valid.", false,
                          machineId: machineId, licensePath: licensePath);

        JsonObject payload;
        try { payload = (JsonObject)JsonNode.Parse(payloadText); }
        catch
        {
            return Status("invalid", "The license payload could not be read.", false,
                          machineId: machineId, licensePath: licensePath);
        }

        if (RulesStore.Str(payload, "product") != ProductId)
            return Status("invalid", "The license is for a different product.", false,
                          payload: payload, machineId: machineId, licensePath: licensePath);

        var machineIds = (payload["machineIds"] as JsonArray)?
            .Select(node => node?.ToString()).Where(s => s != null).ToList() ?? new();
        if (machineIds.Count > 0 && !machineIds.Contains(machineId))
            return Status("wrong_machine", "The license is locked to a different machine.",
                          false, payload: payload, machineId: machineId,
                          licensePath: licensePath);

        if (!CheckClock(statePath, now))
            return Status("clock", "The system clock appears to have been set back; " +
                          "fix the date and time to continue.", false, payload: payload,
                          machineId: machineId, licensePath: licensePath);

        var expires = ParseDate(RulesStore.Str(payload, "expires"));
        if (expires == null)
            return Status("valid", "License valid (perpetual).", true, payload: payload,
                          machineId: machineId, licensePath: licensePath);

        var expiryEnd = expires.Value + 86400; // valid through the whole expiry day
        var graceDays = (int?)(payload["graceDays"] as JsonValue)?.GetValue<double>()
                        ?? DefaultGraceDays;
        var expiresText = RulesStore.Str(payload, "expires");
        if (now < expiryEnd)
        {
            var daysLeft = (int)((expiryEnd - now) / 86400);
            return Status("valid",
                $"License valid — expires in {daysLeft} day(s) on {expiresText}.",
                true, warning: daysLeft <= ExpiryWarningDays, payload: payload,
                daysLeft: daysLeft, machineId: machineId, licensePath: licensePath);
        }
        if (now < expiryEnd + (long)graceDays * 86400)
        {
            var remaining = (int)((expiryEnd + (long)graceDays * 86400 - now) / 86400);
            return Status("grace",
                $"License expired on {expiresText} — running in the renewal grace " +
                $"period ({remaining} day(s) left). Please renew.",
                true, warning: true, payload: payload, daysLeft: remaining,
                machineId: machineId, licensePath: licensePath);
        }
        return Status("expired", $"The license expired on {expiresText}.", false,
                      payload: payload, machineId: machineId, licensePath: licensePath);
    }
}
