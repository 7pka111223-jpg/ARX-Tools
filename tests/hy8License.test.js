import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { sha256Hex, deriveMachineId, verifyLicenseKey, LICENSE_STORAGE_KEY } from '../src/hy8/license.js';
import { makeLicenseKey } from './helpers/signHy8License.js';
import { initApp } from '../src/hy8/ui/app.js';

const MACHINE = 'A1B2-C3D4-E5F6-A7B8';
const FUTURE = '2099-12-31';

test('sha256Hex matches a known test vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('deriveMachineId is deterministic and formatted XXXX-XXXX-XXXX-XXXX', () => {
  const id = deriveMachineId(['Win32', 'en-US', 8, 16, 1920, 1080, 24, -120]);
  assert.match(id, /^([0-9A-F]{4}-){3}[0-9A-F]{4}$/);
  assert.equal(id, deriveMachineId(['Win32', 'en-US', 8, 16, 1920, 1080, 24, -120]));
  assert.notEqual(id, deriveMachineId(['Linux', 'en-US', 8, 16, 1920, 1080, 24, -120]));
});

test('a signed key validates for its machine and rejects everything else', () => {
  const key = makeLicenseKey(MACHINE, FUTURE);

  const ok = verifyLicenseKey(key, MACHINE);
  assert.equal(ok.valid, true);
  assert.equal(ok.expires, FUTURE);

  // Whitespace from copy/paste is tolerated; case of the machine ID is not significant.
  assert.equal(verifyLicenseKey(`  ${key.slice(0, 40)}\n${key.slice(40)} `, MACHINE.toLowerCase()).valid, true);

  assert.equal(verifyLicenseKey(key, 'FFFF-0000-FFFF-0000').valid, false);
  assert.match(verifyLicenseKey(key, 'FFFF-0000-FFFF-0000').reason, /not this machine/);

  // Any tampering breaks the signature: payload swap or signature bit-flip.
  const [payload, sig] = key.split('.');
  const forged = `${Buffer.from(JSON.stringify({ exp: FUTURE, m: 'FFFF-0000-FFFF-0000' })).toString('base64')}.${sig}`;
  assert.match(verifyLicenseKey(forged, 'FFFF-0000-FFFF-0000').reason, /signature/);
  assert.match(verifyLicenseKey(`${payload}.${sig.slice(0, -4)}AAAA`, MACHINE).reason, /signature/);

  assert.equal(verifyLicenseKey('', MACHINE).valid, false);
  assert.equal(verifyLicenseKey('garbage', MACHINE).valid, false);
});

test('expiry is enforced (valid through the expiry date, expired after)', () => {
  const key = makeLicenseKey(MACHINE, '2026-06-30');
  assert.equal(verifyLicenseKey(key, MACHINE, new Date(2026, 5, 30)).valid, true); // on the day
  const after = verifyLicenseKey(key, MACHINE, new Date(2026, 6, 1));
  assert.equal(after.valid, false);
  assert.match(after.reason, /expired on 2026-06-30/);
});

test('an ANY-machine key works everywhere', () => {
  const key = makeLicenseKey('ANY', FUTURE);
  assert.equal(verifyLicenseKey(key, MACHINE).valid, true);
  assert.equal(verifyLicenseKey(key, 'FFFF-0000-FFFF-0000').valid, true);
});

test('keys issued by the Python vendor tool verify in JS', () => {
  const key = execFileSync('python3', ['tools/hy8_license_admin.py', '--machine', MACHINE, '--days', '30'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const result = verifyLicenseKey(key, MACHINE);
  assert.equal(result.valid, true);
  assert.match(result.expires, /^\d{4}-\d{2}-\d{2}$/);
});

test('the Python tool rejects malformed machine IDs and past expiry dates', () => {
  for (const args of [
    ['--machine', 'not-an-id', '--days', '30'],
    ['--machine', MACHINE, '--expires', '2001-01-01'],
    ['--machine', MACHINE, '--days', '0'],
  ]) {
    assert.throws(() => execFileSync('python3', ['tools/hy8_license_admin.py', ...args], { stdio: 'pipe' }));
  }
});

// -- UI gate --

// One app per JSDOM document (as in the real page). storedKey seeds
// localStorage before init, simulating a reload with a remembered key.
function makeGatedApp({ storedKey = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;
  if (storedKey) dom.window.localStorage.setItem(LICENSE_STORAGE_KEY, storedKey);
  const root = document.getElementById('app');
  const app = initApp(root, { download: () => {}, machineId: MACHINE });
  return { root, app, dom };
}

test('the tool starts locked: gate shown, app hidden, machine ID displayed', () => {
  const { root } = makeGatedApp();
  assert.notEqual(root.querySelector('#licenseGate').style.display, 'none');
  assert.equal(root.querySelector('#appBody').style.display, 'none');
  assert.equal(root.querySelector('#machineIdLabel').textContent, MACHINE);
});

test('a valid key unlocks the tool and persists across reloads; a wrong-machine key does not', () => {
  const { root } = makeGatedApp();

  root.querySelector('#licenseKeyInput').value = makeLicenseKey('FFFF-0000-FFFF-0000', FUTURE);
  root.querySelector('#activateBtn').dispatchEvent(new window.Event('click'));
  assert.notEqual(root.querySelector('#licenseGate').style.display, 'none');
  assert.match(root.querySelector('#licenseGateMsg').textContent, /not this machine/);

  root.querySelector('#licenseKeyInput').value = makeLicenseKey(MACHINE, FUTURE);
  root.querySelector('#activateBtn').dispatchEvent(new window.Event('click'));
  assert.equal(root.querySelector('#licenseGate').style.display, 'none');
  assert.notEqual(root.querySelector('#appBody').style.display, 'none');
  assert.match(root.querySelector('#licenseInfo').textContent, new RegExp(`valid through ${FUTURE}`));

  // The activated key was remembered.
  const stored = window.localStorage.getItem(LICENSE_STORAGE_KEY);
  assert.equal(stored, makeLicenseKey(MACHINE, FUTURE).replace(/\s+/g, ''));

  // "Reload": a fresh page with that key in storage comes up already unlocked.
  const reloaded = makeGatedApp({ storedKey: stored });
  assert.equal(reloaded.root.querySelector('#licenseGate').style.display, 'none');
  assert.notEqual(reloaded.root.querySelector('#appBody').style.display, 'none');
});

test('a stored expired key re-locks the tool with an explanation', () => {
  const { root } = makeGatedApp({ storedKey: makeLicenseKey(MACHINE, '2020-01-01') });
  assert.notEqual(root.querySelector('#licenseGate').style.display, 'none');
  assert.equal(root.querySelector('#appBody').style.display, 'none');
  assert.match(root.querySelector('#licenseGateMsg').textContent, /expired on 2020-01-01/);
});
