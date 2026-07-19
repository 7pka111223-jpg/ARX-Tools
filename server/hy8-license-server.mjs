#!/usr/bin/env node
// ARX HY-8 license server — VENDOR side. Confirms InstaPay subscription
// payments and issues signed license keys to waiting installations.
//
// Flow: the locked tool POSTs /api/request {machineId, plan} after the
// customer transfers the plan amount (with their Machine ID in the transfer
// note), then polls GET /api/status. The vendor sees the credit in their
// banking app, opens /admin?secret=..., and clicks Approve on the matching
// request — the server signs a license key for the plan's period and the
// tool activates itself on its next poll. Keys are signed here with the
// PRIVATE key, so this server (and its config) must never be public;
// deploy it anywhere Node 18+ runs and keep the admin secret safe.
//
//   node server/hy8-license-server.mjs           # config from server/config.json
//   PORT=8787 node server/hy8-license-server.mjs
//
// POST /api/webhook {secret, machineId, plan} approves programmatically —
// wire a PSP's payment webhook (Paymob/Kashier/...) to it later to remove
// the manual approval step.
//
// Zero dependencies. Orders persist in server/orders.json.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.HY8_LICENSE_CONFIG || join(__dirname, 'config.json');
const ORDERS_PATH = process.env.HY8_LICENSE_ORDERS || join(__dirname, 'orders.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const PRIVATE_N = BigInt('0x' + config.privateN);
const PRIVATE_D = BigInt('0x' + config.privateD);
const ADMIN_SECRET = config.adminSecret;
const KEY_LEN = (config.privateN.length / 2) | 0;

const PLAN_DAYS = { monthly: 30, yearly: 365 };
const PLAN_LABEL = { monthly: '1 Month — $5', yearly: '1 Year — $50' };
const MACHINE_RE = /^([0-9A-F]{4}-){3}[0-9A-F]{4}$/;

if (!ADMIN_SECRET || ADMIN_SECRET.length < 12) {
  console.error('config.adminSecret must be set (12+ characters)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Signing (mirror of tools/hy8_license_admin.py)
// ---------------------------------------------------------------------------

const SHA256_DER_PREFIX = '3031300d060960864801650304020105000420';

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

function issueKey(machineId, days) {
  const expires = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const payloadText = JSON.stringify({ exp: expires, m: machineId.toUpperCase() });
  const digestHex = createHash('sha256').update(payloadText, 'utf8').digest('hex');
  const tail = SHA256_DER_PREFIX + digestHex;
  const emHex = '0001' + 'f'.repeat(KEY_LEN * 2 - 6 - tail.length) + '00' + tail;
  const sig = modPow(BigInt('0x' + emHex), PRIVATE_D, PRIVATE_N);
  const sigB64 = Buffer.from(sig.toString(16).padStart(KEY_LEN * 2, '0'), 'hex').toString('base64');
  return { key: `${Buffer.from(payloadText, 'utf8').toString('base64')}.${sigB64}`, expires };
}

// ---------------------------------------------------------------------------
// Order store (orders.json): { [machineId]: {plan, status, requested, key?, expires?} }
// ---------------------------------------------------------------------------

function loadOrders() {
  return existsSync(ORDERS_PATH) ? JSON.parse(readFileSync(ORDERS_PATH, 'utf8')) : {};
}

function saveOrders(orders) {
  writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*', // the tool runs from file:// (origin "null")
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('bad JSON'));
      }
    });
    req.on('error', reject);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Constant-time-ish secret compare.
function secretOk(secret) {
  const a = createHash('sha256').update(String(secret || '')).digest();
  const b = createHash('sha256').update(ADMIN_SECRET).digest();
  return a.equals(b);
}

function approve(orders, machineId, plan, days = null) {
  const id = String(machineId || '').toUpperCase();
  if (!MACHINE_RE.test(id)) return { error: 'bad machine id' };
  const planDays = days || PLAN_DAYS[plan];
  if (!planDays) return { error: 'unknown plan' };
  const { key, expires } = issueKey(id, planDays);
  orders[id] = {
    ...(orders[id] || {}),
    plan: plan || orders[id]?.plan || 'custom',
    status: 'approved',
    approved: new Date().toISOString(),
    key,
    expires,
  };
  saveOrders(orders);
  return { key, expires };
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------

function adminPage(orders, secret) {
  const rows = Object.entries(orders)
    .sort(([, a], [, b]) => String(b.requested || '').localeCompare(String(a.requested || '')))
    .map(([machine, o]) => {
      const action =
        o.status === 'approved'
          ? `<em>approved — valid through ${escapeHtml(o.expires || '?')}</em>`
          : `<form method="post" action="/admin/approve" style="display:inline">
               <input type="hidden" name="secret" value="${escapeHtml(secret)}">
               <input type="hidden" name="machine" value="${escapeHtml(machine)}">
               <input type="hidden" name="plan" value="${escapeHtml(o.plan)}">
               <button type="submit">Approve ${escapeHtml(PLAN_LABEL[o.plan] || o.plan)}</button>
             </form>`;
      return `<tr><td><code>${escapeHtml(machine)}</code></td><td>${escapeHtml(PLAN_LABEL[o.plan] || o.plan)}</td>
        <td>${escapeHtml(o.requested || '')}</td><td>${escapeHtml(o.status)}</td><td>${action}</td></tr>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>HY-8 license requests</title>
  <style>body{font-family:system-ui;margin:40px auto;max-width:900px}table{border-collapse:collapse;width:100%}
  td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}code{background:#f5f5f5;padding:2px 6px}
  button{padding:6px 12px;cursor:pointer}</style>
  <h1>HY-8 license requests</h1>
  <p>Approve a request only after the matching InstaPay transfer (Machine ID in the note) shows in your account.</p>
  <table><tr><th>Machine</th><th>Plan</th><th>Requested</th><th>Status</th><th></th></tr>${rows ||
    '<tr><td colspan="5">No requests yet.</td></tr>'}</table>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createLicenseServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
      } else if (req.method === 'POST' && url.pathname === '/api/request') {
        const body = await readBody(req);
        const id = String(body.machineId || '').toUpperCase();
        if (!MACHINE_RE.test(id)) return sendJson(res, 400, { error: 'bad machine id' });
        if (!PLAN_DAYS[body.plan]) return sendJson(res, 400, { error: 'unknown plan' });
        const orders = loadOrders();
        const existing = orders[id];
        if (existing?.status === 'approved') {
          return sendJson(res, 200, { status: 'approved', key: existing.key, plan: existing.plan });
        }
        orders[id] = { plan: body.plan, status: 'pending', requested: existing?.requested || new Date().toISOString() };
        saveOrders(orders);
        sendJson(res, 200, { status: 'pending', plan: body.plan });
      } else if (req.method === 'GET' && url.pathname === '/api/status') {
        const id = String(url.searchParams.get('machine') || '').toUpperCase();
        const order = loadOrders()[id];
        if (!order) return sendJson(res, 200, { status: 'none' });
        sendJson(res, 200, {
          status: order.status,
          plan: order.plan,
          ...(order.status === 'approved' ? { key: order.key, expires: order.expires } : {}),
        });
      } else if (req.method === 'POST' && url.pathname === '/api/webhook') {
        // Programmatic approval — point a PSP payment webhook here.
        const body = await readBody(req);
        if (!secretOk(body.secret)) return sendJson(res, 403, { error: 'bad secret' });
        const result = approve(loadOrders(), body.machineId, body.plan, body.days);
        sendJson(res, result.error ? 400 : 200, result);
      } else if (req.method === 'GET' && url.pathname === '/admin') {
        const secret = url.searchParams.get('secret');
        if (!secretOk(secret)) return sendJson(res, 403, { error: 'bad secret' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(adminPage(loadOrders(), secret));
      } else if (req.method === 'POST' && url.pathname === '/admin/approve') {
        let data = '';
        for await (const chunk of req) data += chunk;
        const form = new URLSearchParams(data);
        if (!secretOk(form.get('secret'))) return sendJson(res, 403, { error: 'bad secret' });
        approve(loadOrders(), form.get('machine'), form.get('plan'));
        res.writeHead(303, { location: `/admin?secret=${encodeURIComponent(form.get('secret'))}` });
        res.end();
      } else {
        sendJson(res, 404, { error: 'not found' });
      }
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || config.port || 8787);
  createLicenseServer().listen(port, () => {
    console.log(`HY-8 license server on http://0.0.0.0:${port}`);
    console.log(`admin page: http://localhost:${port}/admin?secret=***`);
  });
}
