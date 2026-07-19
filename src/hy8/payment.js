// InstaPay payment gate for the HY-8 tool's lock screen.
//
// InstaPay (Egypt's IPN) has no public API, so payments can't be queried
// directly. Instead: the customer transfers the plan amount to the vendor's
// InstaPay address with the Machine ID in the transfer note, then the tool
// registers a pending request with the vendor's license server (serverUrl)
// and polls it. The vendor sees the credit in their banking app, approves
// the request on the server's admin page, the server signs the license key,
// and the customer's open tool activates itself for the plan's period. The
// tool needs internet only for this step — everything else stays offline.
//
// VENDOR SETUP (then rebuild): set instapayAddress to your IPA (and
// optionally an instapay.com.eg payment link), set serverUrl to your
// deployed server/hy8-license-server.mjs, and keep the EGP amounts in sync
// with the exchange rate you charge at.

export const PAYMENT_CONFIG = {
  instapayAddress: 'your-name@instapay', // placeholder -> gate shows manual fallback
  instapayPaymentLink: '', // optional https://ipn.eg/S/... link from the InstaPay app
  serverUrl: '', // e.g. https://license.example.com — empty = manual key delivery
};

export const PLANS = [
  { id: 'monthly', label: '1 Month', usd: 5, egp: 250, days: 30 },
  { id: 'yearly', label: '1 Year', usd: 50, egp: 2500, days: 365 },
];

export function paymentConfigured(config = PAYMENT_CONFIG) {
  return Boolean(config.instapayAddress) && !/^your-name@/.test(config.instapayAddress);
}

export function serverConfigured(config = PAYMENT_CONFIG) {
  return Boolean(config.serverUrl);
}

function apiUrl(config, path) {
  return config.serverUrl.replace(/\/+$/, '') + path;
}

// Registers (idempotently) a pending license request for this machine.
export async function requestLicense(machineId, planId, config = PAYMENT_CONFIG, fetchFn = fetch) {
  const res = await fetchFn(apiUrl(config, '/api/request'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machineId, plan: planId }),
  });
  if (!res.ok) throw new Error(`license server error (HTTP ${res.status})`);
  return res.json(); // { status: 'pending' | 'approved', key? }
}

// Polls the server for this machine's request. Returns
// { status: 'none' | 'pending' | 'approved', key?, plan? }.
export async function checkLicenseStatus(machineId, config = PAYMENT_CONFIG, fetchFn = fetch) {
  const res = await fetchFn(apiUrl(config, `/api/status?machine=${encodeURIComponent(machineId)}`));
  if (!res.ok) throw new Error(`license server error (HTTP ${res.status})`);
  return res.json();
}
