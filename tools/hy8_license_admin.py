#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ARX HY-8 tool license key generator — VENDOR side only. NEVER ship this
file (or an .exe built from it) to customers: it embeds the private key, and
anyone holding it can issue license keys.

The HY-8 browser tool locks itself behind a license key bound to a Machine ID
(shown on the tool's lock screen). This app takes that Machine ID plus a
validity period and prints the signed license key to send back.

Run without arguments for the GUI (Tkinter, works as a windowed .exe):

    python tools/hy8_license_admin.py

Or from the command line:

    python tools/hy8_license_admin.py --machine A1B2-C3D4-E5F6-A7B8 --days 365
    python tools/hy8_license_admin.py --machine A1B2-C3D4-E5F6-A7B8 --expires 2027-01-31
    python tools/hy8_license_admin.py --machine ANY --days 30   # not machine-locked

Build the Windows .exe (on a Windows machine):

    pip install pyinstaller
    tools\\build_hy8_license_exe.bat

Key format (mirrors src/hy8/license.js): base64(payload) "." base64(sig),
payload = compact sorted JSON {"exp":"YYYY-MM-DD","m":"MACHINE-ID"},
signature = RSA-2048 EMSA-PKCS1-v1_5 / SHA-256. Pure stdlib — no pip installs
needed to run this script itself.
"""
import argparse
import base64
import datetime
import hashlib
import json
import re
import sys

# RSA-2048 private key for the HY-8 tool licenses. The matching public
# modulus is embedded in src/hy8/license.js (PUBLIC_KEY_MODULUS_HEX).
PRIVATE_N = int(
    'b01e191adcad977d73a31abbc43be21986cf733ed68a5de99b06ff532eb4b3d7'
    '31bb54b5ef995243a077e665dee1f3e9e54b3596f206ee6f5e41d500bac38dfc'
    'a0d3ccf4908be808a08ae96949bacb6b3291685b6253c0c3fca2b1fd9e778716'
    '1f2dcc1873a4f7f8553154d01535ff3b156c37d04dfd3571c5704468987538d9'
    '9f40c1d098d8b246ba17911a09da326c2490dd57c657b11e4cd8a442f525d70b'
    '548fc84384b96d71a8ae3445b133878a7f2896e21c9e8c3fadbd33d61bc075f1'
    '6ab3423da6229ceb7ce43c7881f1c7eeebb94d8188f76233e9d4324273f7e138'
    '33116dc2ba0e2ddb46a0131ad904621c03a844264131fec52d884988b4502cd5', 16)
PRIVATE_D = int(
    '93649d1e1e1229f69410ad0ef7ec260db705672defdf5d3964c5366a276c9416'
    '4548c25c81698faf895ccf35f292a7cfd85659433acb1241a260f622e62b4369'
    '6a2fd817d5e1410ff74c4a8c13688155f5bc3bda3f3058e3ad4b7c2b05b48319'
    'c07e53912337ad4fe7fca13e8481ec5946548b6189e3a016d7665dda2bbdef14'
    'cde4bd3d7fe9899b64dcaa2a780e8ac4ab73d44d3653b91ab9bf1d8ddc2f5cbb'
    '919d5131e73446a58c76637dca31508df5d93fb24665daadaee72d7c8ca58714'
    'f396d03f4af146df015055d005c588be01472e2cad36499203d4aa0cfa9caa57'
    '325b1905ebea763ea16e7ea43ed87aa80a812ca202f39b10bb58164018e2f301', 16)

_SHA256_PREFIX = bytes.fromhex('3031300d060960864801650304020105000420')
_MACHINE_RE = re.compile(r'^([0-9A-F]{4}-){3}[0-9A-F]{4}$')


def _sign(payload_bytes):
    key_len = (PRIVATE_N.bit_length() + 7) // 8
    digest = hashlib.sha256(payload_bytes).digest()
    padding_len = key_len - len(_SHA256_PREFIX) - len(digest) - 3
    em = b'\x00\x01' + b'\xff' * padding_len + b'\x00' + _SHA256_PREFIX + digest
    signature = pow(int.from_bytes(em, 'big'), PRIVATE_D, PRIVATE_N)
    return signature.to_bytes(key_len, 'big')


def normalize_machine_id(machine_id):
    cleaned = re.sub(r'\s+', '', str(machine_id)).upper()
    if cleaned != 'ANY' and not _MACHINE_RE.match(cleaned):
        raise ValueError(
            'Machine ID must look like A1B2-C3D4-E5F6-A7B8 (as shown on the '
            "tool's lock screen), or ANY for a key that works on any machine.")
    return cleaned


def resolve_expiry(days=None, expires=None):
    if (days is None) == (expires is None):
        raise ValueError('Give exactly one of: a period in days, or an expiry date.')
    if days is not None:
        days = int(days)
        if days < 1:
            raise ValueError('The period must be at least 1 day.')
        return (datetime.date.today() + datetime.timedelta(days=days)).isoformat()
    exp = datetime.date.fromisoformat(str(expires))
    if exp < datetime.date.today():
        raise ValueError('The expiry date %s is already in the past.' % exp)
    return exp.isoformat()


def issue_key(machine_id, days=None, expires=None):
    """Returns (license_key, payload_dict)."""
    payload = {
        'exp': resolve_expiry(days=days, expires=expires),
        'm': normalize_machine_id(machine_id),
    }
    payload_text = json.dumps(payload, separators=(',', ':'), sort_keys=True)
    payload_bytes = payload_text.encode('utf-8')
    key = '%s.%s' % (
        base64.b64encode(payload_bytes).decode('ascii'),
        base64.b64encode(_sign(payload_bytes)).decode('ascii'))
    return key, payload


# ---------------------------------------------------------------------------
# GUI (default when run without arguments; works as a windowed .exe)
# ---------------------------------------------------------------------------

def run_gui():
    import tkinter as tk
    from tkinter import ttk, messagebox

    root = tk.Tk()
    root.title('ARX HY-8 License Key Generator')
    root.resizable(False, False)
    frame = ttk.Frame(root, padding=16)
    frame.grid(sticky='nsew')

    ttk.Label(frame, text='Machine ID (from the tool’s lock screen):').grid(
        row=0, column=0, columnspan=3, sticky='w')
    machine_var = tk.StringVar()
    ttk.Entry(frame, textvariable=machine_var, width=44).grid(
        row=1, column=0, columnspan=3, sticky='we', pady=(2, 10))

    ttk.Label(frame, text='License period:').grid(row=2, column=0, columnspan=3, sticky='w')
    mode_var = tk.StringVar(value='days')
    days_var = tk.StringVar(value='365')
    expires_var = tk.StringVar(
        value=(datetime.date.today() + datetime.timedelta(days=365)).isoformat())
    ttk.Radiobutton(frame, text='Days from today:', variable=mode_var,
                    value='days').grid(row=3, column=0, sticky='w')
    ttk.Entry(frame, textvariable=days_var, width=8).grid(row=3, column=1, sticky='w')
    ttk.Radiobutton(frame, text='Expiry date (YYYY-MM-DD):', variable=mode_var,
                    value='date').grid(row=4, column=0, sticky='w')
    ttk.Entry(frame, textvariable=expires_var, width=14).grid(row=4, column=1, sticky='w')

    ttk.Label(frame, text='License key:').grid(row=6, column=0, columnspan=3,
                                               sticky='w', pady=(12, 0))
    key_text = tk.Text(frame, width=64, height=8, wrap='char', state='disabled')
    key_text.grid(row=7, column=0, columnspan=3, sticky='we', pady=(2, 8))
    status_var = tk.StringVar()
    ttk.Label(frame, textvariable=status_var, foreground='#15803d').grid(
        row=9, column=0, columnspan=3, sticky='w')

    def set_key(text):
        key_text.configure(state='normal')
        key_text.delete('1.0', 'end')
        key_text.insert('1.0', text)
        key_text.configure(state='disabled')

    def generate():
        try:
            kwargs = ({'days': days_var.get()} if mode_var.get() == 'days'
                      else {'expires': expires_var.get()})
            key, payload = issue_key(machine_var.get(), **kwargs)
        except ValueError as exc:
            messagebox.showerror('Cannot issue key', str(exc))
            return
        set_key(key)
        status_var.set('Issued for %s, valid through %s. Send the key to the '
                       'customer.' % (payload['m'], payload['exp']))

    def copy():
        key = key_text.get('1.0', 'end').strip()
        if not key:
            return
        root.clipboard_clear()
        root.clipboard_append(key)
        status_var.set('Copied to clipboard.')

    ttk.Button(frame, text='Generate key', command=generate).grid(
        row=5, column=0, sticky='w', pady=(10, 0))
    ttk.Button(frame, text='Copy key', command=copy).grid(
        row=8, column=0, sticky='w')

    root.mainloop()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--machine', help='Machine ID from the lock screen, or ANY')
    parser.add_argument('--days', type=int, help='validity period in days from today')
    parser.add_argument('--expires', help='expiry date YYYY-MM-DD (alternative to --days)')
    args = parser.parse_args(argv)

    if not args.machine and args.days is None and not args.expires:
        run_gui()
        return

    if not args.machine:
        parser.error('--machine is required in command-line mode')
    try:
        key, payload = issue_key(args.machine, days=args.days, expires=args.expires)
    except ValueError as exc:
        raise SystemExit('error: %s' % exc)
    print(key)
    print('machine : %s' % payload['m'], file=sys.stderr)
    print('expires : %s' % payload['exp'], file=sys.stderr)


if __name__ == '__main__':
    main()
