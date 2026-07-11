#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ARX license administration — VENDOR side only. Never ship this file or
the private key to customers.

Creates the RSA-2048 keypair, issues signed license files for the ARX
Drawing Checker tools (Revit / Civil 3D COM / Civil 3D NETLOAD), and
verifies existing licenses. Pure stdlib — no pip installs needed.

Typical flow:

  # once: create the keypair and embed the printed public key constants
  python3 tools/license_admin.py keygen --out-dir keys

  # per sale: customer sends their Machine ID (shown in the tools'
  # license dialog); issue a license locked to it
  python3 tools/license_admin.py issue --key keys/arx_license_private.json \
      --licensee "Acme Engineering" --email buyer@acme.com \
      --expires 2027-07-11 --machine ABCD-1234-ABCD-1234 \
      --out license.lic

  # sanity-check any license file
  python3 tools/license_admin.py verify --key keys/arx_license_public.json \
      license.lic

  # print this machine's fingerprint (customers see theirs in the tools)
  python3 tools/license_admin.py fingerprint
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'revit', 'DrawingChecker.extension', 'lib'))
from drawingchecker import licensing  # noqa: E402

KEY_BITS = 2048
PUBLIC_EXPONENT = 65537


# ---------------------------------------------------------------------------
# RSA key generation (Miller-Rabin, stdlib secrets for randomness)
# ---------------------------------------------------------------------------

_SMALL_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
                 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]


def _is_probable_prime(n, rounds=40):
    if n < 2:
        return False
    for p in _SMALL_PRIMES:
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _random_prime(bits):
    while True:
        candidate = secrets.randbits(bits) | (1 << (bits - 1)) | (1 << (bits - 2)) | 1
        if _is_probable_prime(candidate):
            return candidate


def generate_keypair(bits=KEY_BITS):
    e = PUBLIC_EXPONENT
    while True:
        p = _random_prime(bits // 2)
        q = _random_prime(bits // 2)
        if p == q:
            continue
        phi = (p - 1) * (q - 1)
        if phi % e == 0:
            continue
        n = p * q
        if n.bit_length() != bits:
            continue
        d = pow(e, -1, phi)
        return {'n': n, 'e': e, 'd': d}


# ---------------------------------------------------------------------------
# Signing (EMSA-PKCS1-v1_5 / SHA-256 — the mirror of licensing.verify_signature)
# ---------------------------------------------------------------------------

_SHA256_PREFIX = bytes.fromhex('3031300d060960864801650304020105000420')


def sign(payload_bytes, n, d):
    key_len = (n.bit_length() + 7) // 8
    digest = hashlib.sha256(payload_bytes).digest()
    padding_len = key_len - len(_SHA256_PREFIX) - len(digest) - 3
    em = b'\x00\x01' + b'\xff' * padding_len + b'\x00' + _SHA256_PREFIX + digest
    signature = pow(int.from_bytes(em, 'big'), d, n)
    return signature.to_bytes(key_len, 'big')


# ---------------------------------------------------------------------------
# Key files
# ---------------------------------------------------------------------------

def load_key(path):
    with open(path, 'r', encoding='utf-8') as fh:
        raw = json.load(fh)
    return {name: int(value, 16) for name, value in raw.items()
            if name in ('n', 'e', 'd')}


def _write_json(path, data):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2)
    print('wrote %s' % path)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_keygen(args):
    print('Generating a %d-bit RSA keypair (a few seconds) ...' % KEY_BITS)
    key = generate_keypair()
    os.makedirs(args.out_dir, exist_ok=True)
    private_path = os.path.join(args.out_dir, 'arx_license_private.json')
    public_path = os.path.join(args.out_dir, 'arx_license_public.json')
    _write_json(private_path, {'n': '%x' % key['n'], 'e': '%x' % key['e'],
                               'd': '%x' % key['d']})
    _write_json(public_path, {'n': '%x' % key['n'], 'e': '%x' % key['e']})
    modulus_hex = '%x' % key['n']
    print()
    print('KEEP %s SECRET — anyone holding it can issue licenses.' % private_path)
    print('Store it offline (password manager / encrypted drive), never in git.')
    print()
    print('Embed the public key in the client tools:')
    print()
    print('1. revit/DrawingChecker.extension/lib/drawingchecker/licensing.py:')
    print()
    print("   PUBLIC_KEY_MODULUS_HEX = '%s'" % modulus_hex)
    print()
    print('2. civil3d/plugin/src/Licensing.cs:')
    print()
    print('   public const string PublicKeyModulusHex = "%s";' % modulus_hex)
    print()
    print('Then rebuild the plugin (dotnet build civil3d/plugin -c Release).')


def cmd_issue(args):
    key = load_key(args.key)
    if 'd' not in key:
        raise SystemExit('issue needs the PRIVATE key file '
                         '(arx_license_private.json)')
    today = datetime.date.today().isoformat()
    payload = {
        'licenseId': args.license_id or 'ARX-%s-%s' % (
            datetime.date.today().year, secrets.token_hex(4).upper()),
        'product': licensing.PRODUCT_ID,
        'plan': args.plan,
        'licensee': args.licensee,
        'email': args.email,
        'issued': today,
        'expires': args.expires,          # None = perpetual
        'graceDays': args.grace_days,
        'machineIds': args.machine or [], # [] = any machine
        'seats': args.seats,
    }
    payload_text = json.dumps(payload, separators=(',', ':'), sort_keys=True)
    signature = sign(payload_text.encode('utf-8'), key['n'], key['d'])
    envelope = {
        'format': licensing.LICENSE_FORMAT,
        'payload': payload_text,
        'signature': base64.b64encode(signature).decode('ascii'),
    }
    _write_json(args.out, envelope)
    print()
    print('Issued %s to %s' % (payload['licenseId'], payload['licensee']))
    print('  expires : %s' % (payload['expires'] or 'never (perpetual)'))
    print('  machines: %s' % (', '.join(payload['machineIds']) or 'any'))
    print()
    print('Send the file to the customer; it goes to '
          '%%APPDATA%%\\ARX-Tools\\%s' % licensing.LICENSE_FILE_NAME)


def cmd_verify(args):
    key = load_key(args.key)
    status = licensing.check_license(
        license_path=args.license, modulus_hex='%x' % key['n'],
        exponent=key['e'], machine_id=args.machine or 'ANY',
        state_path=None)
    if status['state'] == 'wrong_machine' and not args.machine:
        print('signature OK; license is node-locked — pass --machine <ID> '
              'to check a specific machine')
    print('state  : %s' % status['state'])
    print('message: %s' % status['message'])
    if status['payload']:
        print(json.dumps(status['payload'], indent=2, sort_keys=True))
    raise SystemExit(0 if status['allowed'] else 1)


def cmd_fingerprint(_args):
    print(licensing.machine_fingerprint())


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('keygen', help='create the vendor RSA keypair')
    p.add_argument('--out-dir', default='keys')
    p.set_defaults(func=cmd_keygen)

    p = sub.add_parser('issue', help='issue a signed license file')
    p.add_argument('--key', required=True, help='arx_license_private.json')
    p.add_argument('--licensee', required=True)
    p.add_argument('--email', default=None)
    p.add_argument('--expires', default=None,
                   help='YYYY-MM-DD; omit for a perpetual license')
    p.add_argument('--machine', action='append', default=None, metavar='ID',
                   help='machine fingerprint to lock to (repeatable); '
                        'omit for a floating license')
    p.add_argument('--plan', default='pro')
    p.add_argument('--seats', type=int, default=1)
    p.add_argument('--grace-days', type=int,
                   default=licensing.DEFAULT_GRACE_DAYS)
    p.add_argument('--license-id', default=None)
    p.add_argument('--out', default='license.lic')
    p.set_defaults(func=cmd_issue)

    p = sub.add_parser('verify', help='validate a license file')
    p.add_argument('license')
    p.add_argument('--key', required=True, help='arx_license_public.json')
    p.add_argument('--machine', default=None,
                   help='check as this machine fingerprint')
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser('fingerprint', help="print this machine's fingerprint")
    p.set_defaults(func=cmd_fingerprint)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
