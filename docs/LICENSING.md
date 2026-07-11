# Licensing the ARX Drawing Checker tools

The Revit extension, the Civil 3D COM checker and the Civil 3D NETLOAD
plugin share one offline licensing gate. A license is a small signed
file the customer drops at:

    %APPDATA%\ARX-Tools\license.lic

One file covers **all three tools** on a machine. Everything works
offline — no license server, no phone-home.

**Out of the box licensing is OFF.** The embedded public key is empty,
so every tool runs unrestricted (`state: unconfigured`). Nothing changes
for development or internal use until you complete the setup below.

## How it works

- A license file holds a JSON payload (licensee, expiry, machine IDs,
  plan, …) and an **RSA-2048 / SHA-256 signature** over that payload.
- Only the **public** key ships inside the tools; the private key stays
  with you. Editing any byte of a license invalidates it.
- **Node-locking**: the payload can list machine fingerprints derived
  from the Windows `MachineGuid`. The Revit and Civil 3D tools derive
  the identical fingerprint, so one license works for both. An empty
  list = floating license (any machine).
- **Expiry + grace**: licenses can be perpetual or expire on a date
  (subscriptions). Users get a warning 14 days before expiry, and after
  it the tool keeps running through a grace window (default 7 days,
  settable per license) before blocking — so a late renewal never
  stops work mid-deadline.
- **Clock-rollback guard**: a last-seen timestamp in
  `%APPDATA%\ARX-Tools\license_state.json` blocks users who wind the
  system clock back to stretch an expired license (with a 2-day
  tolerance for timezone/DST changes).
- When blocked, the dialog shows the user's **Machine ID** and the
  expected file path — everything support needs.

## One-time setup (vendor)

1. Create your keypair (pure Python, no installs):

       python3 tools/license_admin.py keygen --out-dir keys

   `keys/arx_license_private.json` is the crown jewels — store it
   offline (password manager / encrypted drive), **never in git**.
   Anyone holding it can mint licenses.

2. Embed the printed public-key constant in both clients (the keygen
   command prints the exact lines):

   - `revit/DrawingChecker.extension/lib/drawingchecker/licensing.py`
     → `PUBLIC_KEY_MODULUS_HEX = '…'`
   - `civil3d/plugin/src/Licensing.cs`
     → `public const string PublicKeyModulusHex = "…";`

3. Rebuild the plugin: `dotnet build civil3d/plugin -c Release`.
   From this build on, the tools require a valid license.

## Issuing a license (per sale)

The customer reads their **Machine ID** from the license dialog any of
the tools shows (or runs `python3 tools/license_admin.py fingerprint`),
and sends it to you. Then:

    # 1-year subscription, locked to their machine
    python3 tools/license_admin.py issue \
        --key keys/arx_license_private.json \
        --licensee "Acme Engineering" --email buyer@acme.com \
        --expires 2027-07-11 --machine ABCD-1234-ABCD-1234 \
        --out license.lic

    # perpetual, floating (any machine): omit --expires and --machine
    # trial: just a short --expires (e.g. 14 days out)
    # extra seats on one license: repeat --machine for each fingerprint

Email them `license.lic`; they save it to
`%APPDATA%\ARX-Tools\license.lic`. Renewals are simply a re-issued file
with a new expiry. Enterprise deployments can point all seats at a
network copy with the `ARX_LICENSE_FILE` environment variable.

Sanity-check any file with:

    python3 tools/license_admin.py verify license.lic \
        --key keys/arx_license_public.json

## Honest limits

Offline licensing keeps honest customers honest; it does not stop a
determined attacker who edits the shipped public key (Python source is
user-visible; obfuscate the C# DLL as covered in the publishing guide).
For hard enforcement, pair this gate with an online activation service
(Keygen/Cryptolens) later — the payload schema and file location were
designed so a server-issued license can slot straight in.

## Tests

- Python: `revit/tests/test_licensing.py`
- C#: the licensing section of `civil3d/plugin-tests/Program.cs`

Both verify the **same** signed fixtures in `revit/tests/fixtures/`
(`license_test_key_*.json`, `license_*.lic` — test key only, never use
it for real licenses), which locks the two implementations together.
