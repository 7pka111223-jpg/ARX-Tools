# -*- coding: utf-8 -*-
"""Licensing gate: signature verification, node-lock, expiry/grace and
the clock-rollback guard, against fixtures signed by tools/license_admin.py
(the same fixtures the C# plugin smoke test verifies, locking the two
implementations together)."""
from __future__ import unicode_literals

import calendar
import io
import json
import os
import shutil
import tempfile
import time
import unittest

from . import _path  # noqa: F401

from drawingchecker import licensing

FIXTURES = _path.FIXTURES_DIR
TEST_MACHINE = licensing.fingerprint_from_string('TEST-MACHINE-GUID')


def _public_modulus():
    with io.open(os.path.join(FIXTURES, 'license_test_key_public.json'),
                 encoding='utf-8') as fh:
        return json.load(fh)['n']


MODULUS = _public_modulus()


def check(license_name, **kwargs):
    kwargs.setdefault('modulus_hex', MODULUS)
    kwargs.setdefault('machine_id', TEST_MACHINE)
    kwargs.setdefault('state_path', None)
    path = license_name
    if license_name and not os.path.isabs(license_name):
        path = os.path.join(FIXTURES, license_name)
    return licensing.check_license(license_path=path, **kwargs)


def day(date_string):
    """Epoch seconds at UTC noon of a YYYY-MM-DD date."""
    return calendar.timegm(time.strptime(date_string, '%Y-%m-%d')) + 43200


class TestFingerprint(unittest.TestCase):
    def test_known_vector_matches_csharp_smoke_test(self):
        self.assertEqual(TEST_MACHINE, '337D-1DB6-F946-6C08')

    def test_normalizes_case_and_whitespace(self):
        self.assertEqual(licensing.fingerprint_from_string(' Test-Machine-GUID '),
                         TEST_MACHINE)

    def test_env_override(self):
        os.environ['ARX_MACHINE_ID'] = 'TEST-MACHINE-GUID'
        try:
            self.assertEqual(licensing.machine_fingerprint(), TEST_MACHINE)
        finally:
            del os.environ['ARX_MACHINE_ID']


class TestCheckLicense(unittest.TestCase):
    def test_unconfigured_key_allows_everything(self):
        status = licensing.check_license(modulus_hex='')
        self.assertEqual(status['state'], 'unconfigured')
        self.assertTrue(status['allowed'])
        self.assertFalse(status['warning'])

    def test_valid_node_locked_license(self):
        status = check('license_valid.lic', now=day('2026-07-11'))
        self.assertEqual(status['state'], 'valid')
        self.assertTrue(status['allowed'])
        self.assertFalse(status['warning'])
        self.assertEqual(status['payload']['licensee'], 'Test Firm Ltd')

    def test_perpetual_license_on_any_machine(self):
        status = check('license_perpetual.lic', machine_id='FFFF-0000-FFFF-0000')
        self.assertEqual(status['state'], 'valid')
        self.assertIsNone(status['daysLeft'])

    def test_missing_file_blocks(self):
        status = check(os.path.join(FIXTURES, 'no_such.lic'))
        self.assertEqual(status['state'], 'missing')
        self.assertFalse(status['allowed'])

    def test_tampered_payload_blocks(self):
        status = check('license_tampered.lic')
        self.assertEqual(status['state'], 'invalid')
        self.assertFalse(status['allowed'])

    def test_wrong_machine_blocks(self):
        status = check('license_valid.lic', machine_id='FFFF-0000-FFFF-0000')
        self.assertEqual(status['state'], 'wrong_machine')
        self.assertFalse(status['allowed'])

    def test_expiring_soon_warns_but_allows(self):
        status = check('license_valid.lic', now=day('2092-12-25'))
        self.assertEqual(status['state'], 'valid')
        self.assertTrue(status['allowed'])
        self.assertTrue(status['warning'])
        self.assertLessEqual(status['daysLeft'], licensing.EXPIRY_WARNING_DAYS)

    def test_grace_period_after_expiry(self):
        status = check('license_expired.lic', now=day('2020-01-05'))
        self.assertEqual(status['state'], 'grace')
        self.assertTrue(status['allowed'])
        self.assertTrue(status['warning'])

    def test_expired_beyond_grace_blocks(self):
        status = check('license_expired.lic', now=day('2020-02-01'))
        self.assertEqual(status['state'], 'expired')
        self.assertFalse(status['allowed'])

    def test_describe_includes_machine_id_when_blocked(self):
        status = check('license_valid.lic', machine_id='FFFF-0000-FFFF-0000')
        text = licensing.describe(status)
        self.assertIn('FFFF-0000-FFFF-0000', text)
        self.assertIn('Test Firm Ltd', text)


class TestClockRollback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.state = os.path.join(self.tmp, 'license_state.json')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rollback_past_tolerance_blocks(self):
        first = check('license_valid.lic', now=day('2026-07-11'),
                      state_path=self.state)
        self.assertEqual(first['state'], 'valid')
        rolled = check('license_valid.lic', now=day('2026-07-01'),
                       state_path=self.state)
        self.assertEqual(rolled['state'], 'clock')
        self.assertFalse(rolled['allowed'])

    def test_small_clock_changes_are_tolerated(self):
        check('license_valid.lic', now=day('2026-07-11'), state_path=self.state)
        nudged = check('license_valid.lic', now=day('2026-07-11') - 3600,
                       state_path=self.state)
        self.assertEqual(nudged['state'], 'valid')


class TestAdminToolRoundTrip(unittest.TestCase):
    """The signer in tools/license_admin.py and the verifier here must
    agree — issue a fresh license with a fresh key and check it."""

    def test_issue_and_verify(self):
        import sys
        tools_dir = os.path.normpath(os.path.join(
            os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools'))
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        import license_admin as admin

        with io.open(os.path.join(FIXTURES, 'license_test_key_private.json'),
                     encoding='utf-8') as fh:
            raw = json.load(fh)
        n, d = int(raw['n'], 16), int(raw['d'], 16)
        payload = json.dumps({'product': licensing.PRODUCT_ID,
                              'licensee': 'Round Trip', 'expires': None},
                             separators=(',', ':'), sort_keys=True)
        signature = admin.sign(payload.encode('utf-8'), n, d)
        self.assertTrue(licensing.verify_signature(
            payload.encode('utf-8'), signature, n, licensing.PUBLIC_KEY_EXPONENT))
        # any bit flip must fail
        self.assertFalse(licensing.verify_signature(
            payload.encode('utf-8') + b' ', signature, n,
            licensing.PUBLIC_KEY_EXPONENT))


if __name__ == '__main__':
    unittest.main()
