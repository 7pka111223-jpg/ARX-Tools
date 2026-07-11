# -*- coding: utf-8 -*-
"""Offline licensing gate shared by the ARX checkers.

A license is a small JSON file (`%APPDATA%\\ARX-Tools\\license.lic`, shared
by the Revit and Civil 3D tools) holding a payload string and an RSA
PKCS#1 v1.5 / SHA-256 signature over that exact string. Only the PUBLIC
key is embedded here; licenses are issued with `tools/license_admin.py`,
which keeps the private key on the vendor's machine. Verification is pure
stdlib (hashlib + modular exponentiation) so it runs identically under
IronPython 2.7 inside Revit and CPython 3.

The payload supports node-locking (machineIds = fingerprints derived from
the Windows MachineGuid), an expiry date with a renewal grace window, and
a clock-rollback guard via a last-seen timestamp in license_state.json.

While PUBLIC_KEY_MODULUS_HEX below is empty, licensing is OFF and every
check returns state 'unconfigured' (allowed) — development/internal
builds keep working with no license at all. To enforce licensing, run
`python3 tools/license_admin.py keygen` and paste the printed constant.
"""
from __future__ import unicode_literals

import base64
import binascii
import hashlib
import io
import json
import os
import time

# ---------------------------------------------------------------------------
# Vendor public key — paste the values printed by
#   python3 tools/license_admin.py keygen
# Empty modulus = licensing disabled (state 'unconfigured', tools run free).
# ---------------------------------------------------------------------------
PUBLIC_KEY_MODULUS_HEX = ''
PUBLIC_KEY_EXPONENT = 65537

PRODUCT_ID = 'arx-drawing-checker'
LICENSE_FORMAT = 'arx-license/1'
LICENSE_FILE_NAME = 'license.lic'
STATE_FILE_NAME = 'license_state.json'
APPDATA_DIR_NAME = 'ARX-Tools'

EXPIRY_WARNING_DAYS = 14      # start warning this many days before expiry
DEFAULT_GRACE_DAYS = 7        # still runs (with a warning) after expiry
CLOCK_TOLERANCE_SECONDS = 2 * 86400  # allowance for timezone/DST changes

# DigestInfo prefix for SHA-256 (EMSA-PKCS1-v1_5, RFC 8017)
_SHA256_PREFIX = binascii.unhexlify(b'3031300d060960864801650304020105000420')

BLOCKED_STATES = ('missing', 'invalid', 'wrong_machine', 'expired', 'clock')


# ---------------------------------------------------------------------------
# RSA PKCS#1 v1.5 / SHA-256 signature verification (pure stdlib)
# ---------------------------------------------------------------------------

def _bytes_to_int(data):
    return int(binascii.hexlify(data), 16)


def _int_to_bytes(value, length):
    hexstr = '%x' % value
    hexstr = hexstr.rjust(length * 2, '0')
    return binascii.unhexlify(hexstr.encode('ascii'))


def verify_signature(payload_bytes, signature_bytes, modulus, exponent):
    """True if signature_bytes is a valid RSASSA-PKCS1-v1_5/SHA-256
    signature of payload_bytes under the given public key."""
    key_len = (modulus.bit_length() + 7) // 8
    if len(signature_bytes) != key_len:
        return False
    decrypted = pow(_bytes_to_int(signature_bytes), exponent, modulus)
    encoded = _int_to_bytes(decrypted, key_len)
    digest = hashlib.sha256(payload_bytes).digest()
    padding_len = key_len - len(_SHA256_PREFIX) - len(digest) - 3
    if padding_len < 8:
        return False
    expected = (b'\x00\x01' + b'\xff' * padding_len + b'\x00'
                + _SHA256_PREFIX + digest)
    return encoded == expected


# ---------------------------------------------------------------------------
# Machine fingerprint (node-lock)
# ---------------------------------------------------------------------------

def fingerprint_from_string(raw):
    """XXXX-XXXX-XXXX-XXXX from any machine-unique string. The C# plugin
    implements the same derivation, so one license covers both tools."""
    digest = hashlib.sha256(raw.strip().lower().encode('utf-8')).hexdigest()
    compact = digest[:16].upper()
    return '-'.join(compact[i:i + 4] for i in range(0, 16, 4))


def _windows_machine_guid():
    try:
        try:
            import winreg  # CPython 3 on Windows
        except ImportError:
            import _winreg as winreg  # IronPython 2.7
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                             r'SOFTWARE\Microsoft\Cryptography')
        try:
            value, _kind = winreg.QueryValueEx(key, 'MachineGuid')
            return value
        finally:
            winreg.CloseKey(key)
    except Exception:
        return None


def machine_fingerprint():
    """Fingerprint of this machine. ARX_MACHINE_ID overrides (tests,
    virtual desktops); otherwise the Windows MachineGuid; last-resort
    fallback is the hostname + MAC so non-Windows dev boxes get a value."""
    override = os.environ.get('ARX_MACHINE_ID')
    if override:
        return fingerprint_from_string(override)
    guid = _windows_machine_guid()
    if guid:
        return fingerprint_from_string(guid)
    import platform
    import uuid
    return fingerprint_from_string('%s|%s' % (platform.node(), uuid.getnode()))


# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

def _appdata_path(file_name):
    appdata = os.environ.get('APPDATA')
    if not appdata:
        return None
    return os.path.join(appdata, APPDATA_DIR_NAME, file_name)


def default_license_path():
    return os.environ.get('ARX_LICENSE_FILE') or _appdata_path(LICENSE_FILE_NAME)


def default_state_path():
    return _appdata_path(STATE_FILE_NAME)


# ---------------------------------------------------------------------------
# Clock-rollback guard
# ---------------------------------------------------------------------------

def _check_clock(state_path, now):
    """Returns False if the clock appears to have been wound back past the
    tolerance; records the newest time seen. Unwritable state is ignored —
    the guard degrades gracefully rather than blocking paying users."""
    if not state_path:
        return True
    last_seen = 0
    try:
        with io.open(state_path, 'r', encoding='utf-8') as fh:
            last_seen = float(json.load(fh).get('lastSeen', 0))
    except Exception:
        pass
    if now + CLOCK_TOLERANCE_SECONDS < last_seen:
        return False
    if now > last_seen:
        try:
            directory = os.path.dirname(state_path)
            if directory and not os.path.isdir(directory):
                os.makedirs(directory)
            with io.open(state_path, 'w', encoding='utf-8') as fh:
                fh.write(json.dumps({'lastSeen': now}))
        except Exception:
            pass
    return True


# ---------------------------------------------------------------------------
# License check
# ---------------------------------------------------------------------------

def _parse_date(value):
    """'YYYY-MM-DD' -> epoch seconds at UTC midnight, or None."""
    if not value:
        return None
    import calendar
    return calendar.timegm(time.strptime(value, '%Y-%m-%d'))


def _status(state, message, allowed, warning=False, payload=None,
            days_left=None, machine_id=None, license_path=None):
    return {
        'state': state,
        'allowed': allowed,
        'warning': warning,
        'message': message,
        'payload': payload,
        'daysLeft': days_left,
        'machineId': machine_id,
        'licensePath': license_path,
    }


def check_license(license_path=None, now=None, machine_id=None,
                  modulus_hex=None, exponent=None, state_path=None):
    """Validate the license and return a status dict:

    state    unconfigured | valid | grace | missing | invalid |
             wrong_machine | expired | clock
    allowed  True when the tool may run (unconfigured / valid / grace)
    warning  True when allowed but the user should be told (grace,
             or valid but expiring within EXPIRY_WARNING_DAYS)

    All parameters default to the embedded key and the shared
    %APPDATA%\\ARX-Tools files; tests inject their own.
    """
    modulus_hex = PUBLIC_KEY_MODULUS_HEX if modulus_hex is None else modulus_hex
    exponent = PUBLIC_KEY_EXPONENT if exponent is None else exponent
    if not modulus_hex:
        return _status('unconfigured', 'Licensing is not configured; running '
                       'in unrestricted mode.', allowed=True)
    modulus = int(modulus_hex, 16)

    if license_path is None:
        license_path = default_license_path()
    if state_path is None:
        state_path = default_state_path()
    if machine_id is None:
        machine_id = machine_fingerprint()
    if now is None:
        now = time.time()

    if not license_path or not os.path.isfile(license_path):
        return _status('missing', 'No license file was found.', allowed=False,
                       machine_id=machine_id, license_path=license_path)

    try:
        with io.open(license_path, 'r', encoding='utf-8-sig') as fh:
            envelope = json.load(fh)
        payload_text = envelope['payload']
        signature = base64.b64decode(envelope['signature'])
        if envelope.get('format') != LICENSE_FORMAT:
            raise ValueError('unsupported format')
    except Exception:
        return _status('invalid', 'The license file could not be read.',
                       allowed=False, machine_id=machine_id,
                       license_path=license_path)

    if not verify_signature(payload_text.encode('utf-8'), signature,
                            modulus, exponent):
        return _status('invalid', 'The license signature is not valid.',
                       allowed=False, machine_id=machine_id,
                       license_path=license_path)

    try:
        payload = json.loads(payload_text)
    except Exception:
        return _status('invalid', 'The license payload could not be read.',
                       allowed=False, machine_id=machine_id,
                       license_path=license_path)

    if payload.get('product') != PRODUCT_ID:
        return _status('invalid', 'The license is for a different product.',
                       allowed=False, payload=payload, machine_id=machine_id,
                       license_path=license_path)

    machine_ids = payload.get('machineIds') or []
    if machine_ids and machine_id not in machine_ids:
        return _status('wrong_machine', 'The license is locked to a '
                       'different machine.', allowed=False, payload=payload,
                       machine_id=machine_id, license_path=license_path)

    if not _check_clock(state_path, now):
        return _status('clock', 'The system clock appears to have been set '
                       'back; fix the date and time to continue.',
                       allowed=False, payload=payload, machine_id=machine_id,
                       license_path=license_path)

    expires = _parse_date(payload.get('expires'))
    if expires is None:
        return _status('valid', 'License valid (perpetual).', allowed=True,
                       payload=payload, machine_id=machine_id,
                       license_path=license_path)

    expiry_end = expires + 86400  # valid through the whole expiry day
    grace_days = payload.get('graceDays')
    if grace_days is None:
        grace_days = DEFAULT_GRACE_DAYS
    if now < expiry_end:
        days_left = int((expiry_end - now) // 86400)
        warn = days_left <= EXPIRY_WARNING_DAYS
        message = ('License valid — expires in %d day(s) on %s.'
                   % (days_left, payload.get('expires')))
        return _status('valid', message, allowed=True, warning=warn,
                       payload=payload, days_left=days_left,
                       machine_id=machine_id, license_path=license_path)
    if now < expiry_end + grace_days * 86400:
        remaining = int((expiry_end + grace_days * 86400 - now) // 86400)
        message = ('License expired on %s — running in the renewal grace '
                   'period (%d day(s) left). Please renew.'
                   % (payload.get('expires'), remaining))
        return _status('grace', message, allowed=True, warning=True,
                       payload=payload, days_left=remaining,
                       machine_id=machine_id, license_path=license_path)
    return _status('expired', 'The license expired on %s.'
                   % payload.get('expires'), allowed=False, payload=payload,
                   machine_id=machine_id, license_path=license_path)


def describe(status):
    """User-facing text for the gate dialog, including everything a
    customer needs to send to support (machine ID, expected path)."""
    lines = [status['message']]
    payload = status.get('payload') or {}
    if payload.get('licensee'):
        lines.append('Licensed to: %s' % payload['licensee'])
    if payload.get('licenseId'):
        lines.append('License ID: %s' % payload['licenseId'])
    if not status['allowed']:
        if status['state'] == 'missing' and status.get('licensePath'):
            lines.append('')
            lines.append('Place your license file at:')
            lines.append('  %s' % status['licensePath'])
        lines.append('')
        lines.append('To purchase or fix a license, send this machine ID '
                      'to support:')
        lines.append('  Machine ID: %s' % (status.get('machineId') or
                                           machine_fingerprint()))
    return '\n'.join(lines)
