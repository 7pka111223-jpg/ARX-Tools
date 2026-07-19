import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { verifyLicenseKey, LICENSE_STORAGE_KEY } from '../src/hy8/license.js';
import { PAYMENT_CONFIG, PLANS, paymentConfigured, requestLicense, checkLicenseStatus } from '../src/hy8/payment.js';
import { initApp } from '../src/hy8/ui/app.js';

const MACHINE = 'A1B2-C3D4-E5F6-A7B8';
const SECRET = 'test-secret-0123456789';

// Boot a real license server on an ephemeral port with a temp config/orders.
let server;
let baseUrl;
let workDir;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'hy8-license-'));
  const example = JSON.parse(readFileSync('server/config.example.json', 'utf8'));
  writeFileSync(join(workDir, 'config.json'), JSON.stringify({ ...example, adminSecret: SECRET }));
  process.env.HY8_LICENSE_CONFIG = join(workDir, 'config.json');
  process.env.HY8_LICENSE_ORDERS = join(workDir, 'orders.json');
  const { createLicenseServer } = await import('../server/hy8-license-server.mjs');
  server = createLicenseServer();
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(workDir, { recursive: true, force: true });
});

test('plans are 1 month at $5 and 1 year at $50', () => {
  assert.deepEqual(
    PLANS.map((p) => [p.label, p.usd, p.days]),
    [['1 Month', 5, 30], ['1 Year', 50, 365]]
  );
  // Shipped default is a placeholder — the gate must show the manual fallback.
  assert.equal(paymentConfigured(), false);
  assert.equal(paymentConfigured({ instapayAddress: 'arx@instapay' }), true);
});

test('request -> pending -> admin approve -> status returns a valid signed key', async () => {
  const cfg = { ...PAYMENT_CONFIG, serverUrl: baseUrl };

  const req = await requestLicense(MACHINE, 'monthly', cfg);
  assert.equal(req.status, 'pending');
  assert.equal((await checkLicenseStatus(MACHINE, cfg)).status, 'pending');

  // Vendor approves from the admin page's form endpoint.
  const approveRes = await fetch(`${baseUrl}/admin/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: SECRET, machine: MACHINE, plan: 'monthly' }),
    redirect: 'manual',
  });
  assert.equal(approveRes.status, 303);

  const status = await checkLicenseStatus(MACHINE, cfg);
  assert.equal(status.status, 'approved');
  const verdict = verifyLicenseKey(status.key, MACHINE);
  assert.equal(verdict.valid, true);
  // 30-day plan: expiry ~30 days out.
  const days = Math.round((new Date(verdict.expires) - Date.now()) / 86400000);
  assert.ok(days >= 28 && days <= 31, `expected ~30 days, got ${days}`);

  // Re-requesting after approval returns the key straight away.
  const again = await requestLicense(MACHINE, 'monthly', cfg);
  assert.equal(again.status, 'approved');
  assert.equal(again.key, status.key);
});

test('the webhook endpoint approves programmatically and enforces the secret', async () => {
  const machine = 'BBBB-2222-CCCC-3333';
  const bad = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'wrong', machineId: machine, plan: 'yearly' }),
  });
  assert.equal(bad.status, 403);

  const ok = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, machineId: machine, plan: 'yearly' }),
  });
  assert.equal(ok.status, 200);
  const { key } = await ok.json();
  const verdict = verifyLicenseKey(key, machine);
  assert.equal(verdict.valid, true);
  const days = Math.round((new Date(verdict.expires) - Date.now()) / 86400000);
  assert.ok(days >= 363 && days <= 366, `expected ~365 days, got ${days}`);
});

test('the admin page requires the secret and lists requests', async () => {
  assert.equal((await fetch(`${baseUrl}/admin?secret=wrong`)).status, 403);
  const page = await fetch(`${baseUrl}/admin?secret=${SECRET}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(MACHINE));
  assert.ok(html.includes('1 Month — $5'));
});

test('bad requests are rejected', async () => {
  const cfg = { ...PAYMENT_CONFIG, serverUrl: baseUrl };
  await assert.rejects(() => requestLicense('not-a-machine', 'monthly', cfg), /400/);
  await assert.rejects(() => requestLicense(MACHINE, 'weekly', cfg), /400/);
});

test('the locked tool confirms payment online and activates itself', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;
  const machine = 'DDDD-4444-EEEE-5555';

  // Configure the gate for this test: real server, configured InstaPay.
  const saved = { ...PAYMENT_CONFIG };
  Object.assign(PAYMENT_CONFIG, { instapayAddress: 'arx@instapay', serverUrl: baseUrl });
  try {
    const root = document.getElementById('app');
    const app = initApp(root, { download: () => {}, machineId: machine });

    // Locked, both plans shown with USD and EGP amounts.
    assert.notEqual(root.querySelector('#licenseGate').style.display, 'none');
    const planText = root.querySelector('#planRow').textContent;
    assert.ok(planText.includes('$5') && planText.includes('EGP 250'));
    assert.ok(planText.includes('$50') && planText.includes('EGP 2500'));

    // Selecting a plan shows the InstaPay steps with the machine ID reference.
    app.selectPlan('monthly');
    const details = root.querySelector('#paymentDetails').textContent;
    assert.ok(details.includes('arx@instapay'));
    assert.ok(details.includes('EGP 250'));
    assert.ok(details.includes(machine));

    // Customer clicks "I've paid" -> request registered, still pending.
    await requestLicense(machine, 'monthly', PAYMENT_CONFIG);
    assert.equal(await app.checkPayment(), 'pending');
    assert.notEqual(root.querySelector('#licenseGate').style.display, 'none');

    // Vendor approves; the next poll activates the tool for the plan period.
    await fetch(`${baseUrl}/api/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: SECRET, machineId: machine, plan: 'monthly' }),
    });
    assert.equal(await app.checkPayment(), 'activated');
    assert.equal(root.querySelector('#licenseGate').style.display, 'none');
    assert.notEqual(root.querySelector('#appBody').style.display, 'none');
    assert.match(root.querySelector('#licenseInfo').textContent, /valid through \d{4}-\d{2}-\d{2}/);
    // The key was persisted for future loads.
    assert.ok(dom.window.localStorage.getItem(LICENSE_STORAGE_KEY));
  } finally {
    Object.assign(PAYMENT_CONFIG, saved);
  }
});
