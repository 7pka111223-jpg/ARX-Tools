import { parseHy8, serializeHy8 } from '../hy8File.js';
import { parseCulvertCsv, rowsToCulverts, parseCsvGrid } from '../csvCulverts.js';
import { parseCreatorRows } from '../creatorRows.js';
import { buildHy8Project } from '../hy8Writer.js';
import { buildCreatorTemplateXlsx } from '../xlsxWriter.js';
import { parseXlsxRows, rowsToText } from '../xlsx.js';
import { mapCulverts } from '../mapper.js';
import { diffPair } from '../differ.js';
import { generateDifferencesCsv } from '../diffExport.js';
import { parseFlowInput, applyFlows } from '../flowUpdater.js';
import { applyGeometryImport } from '../applyImport.js';
import { buildComputedSummary, buildExtractedSummary, buildFullAnalysis } from '../summary.js';
import { generateSummaryCsv, generateFullAnalysisCsv } from '../summaryExport.js';
import { parseDocxSummaryTables } from '../docx.js';
import { extractReportResults } from '../reportExtract.js';
import { geometryByName } from '../geometry.js';
import { runChecks, countFailures, DEFAULT_THRESHOLDS } from '../checks.js';
import { buildReportExcel, buildChecksExcel } from '../excelReports.js';
import { browserMachineId, verifyLicenseKey, LICENSE_STORAGE_KEY } from '../license.js';
import { PAYMENT_CONFIG, PLANS, paymentConfigured, serverConfigured, requestLicense, checkLicenseStatus } from '../payment.js';
import { escapeHtml } from '../../util.js';
import {
  renderMappingRow,
  renderUnmatchedCsvRow,
  renderUnmatchedHy8Row,
  renderDiffSection,
  renderSummaryTable,
  renderReportTable,
  renderFullAnalysis,
  renderCreatorTable,
  renderChecksTable,
} from './render.js';

// license: false disables the gate (unit tests of the tool itself);
// machineId overrides the derived fingerprint (gate tests).
export function initApp(root, { download = defaultDownload, license = true, machineId = null } = {}) {
  const state = {
    csvFileName: null,
    hy8FileName: null,
    csvRows: [],
    hy8Doc: null,
    mode: 'name',
    toleranceM: 15,
    mapResult: { pairs: [], unmatchedCsv: [], unmatchedHy8: [] },
    summaryRows: null,
    summarySource: null,
    reportRows: null,
    reportTables: null,
    reportFileName: null,
    fullAnalysis: null,
    creatorCulverts: [],
    creatorErrors: [],
    creatorFileName: null,
    thresholds: { ...DEFAULT_THRESHOLDS },
    checkRows: null,
    checkSource: null,
  };

  root.innerHTML = `
    <section class="card license-gate" id="licenseGate" style="display:none">
      <div class="card__header">
        <h2 class="card__title">License required</h2>
      </div>
      <p class="hint">This copy of the HY-8 tool is locked. Send the Machine ID below to ARX to
        receive a license key, then paste the key here to activate. Activation is fully offline —
        nothing leaves this browser.</p>
      <div class="field">
        <label>Machine ID</label>
        <div class="machine-id-row">
          <code id="machineIdLabel"></code>
          <button id="copyMachineIdBtn" class="btn">Copy</button>
        </div>
      </div>
      <div class="field">
        <label>Subscribe</label>
        <div class="plan-row" id="planRow"></div>
        <div id="paymentDetails"></div>
      </div>
      <div class="field">
        <label for="licenseKeyInput">License key</label>
        <textarea id="licenseKeyInput" rows="5" placeholder="Paste your license key"></textarea>
      </div>
      <button id="activateBtn" class="btn btn-primary">Activate</button>
      <p id="licenseGateMsg" class="status"></p>
    </section>

    <div id="appBody" style="display:none">
    <p id="licenseInfo" class="license-info"></p>
    <div class="tabs" role="tablist">
      <button id="tabBtnImport" class="tab is-active" role="tab" aria-selected="true">Import into existing HY-8</button>
      <button id="tabBtnCreate" class="tab" role="tab" aria-selected="false">Create new HY-8</button>
      <button id="tabBtnChecks" class="tab" role="tab" aria-selected="false">Checks</button>
    </div>

    <div id="importTab">
    <section class="card">
      <div class="card__header">
        <h2 class="card__title">1. Load files</h2>
        <span class="card__hint">Nothing is uploaded — files are read locally in this browser</span>
      </div>
      <div class="field">
        <label for="csvInput">Culvert schedule — CSV or Excel .xlsx (SI units)</label>
        <input type="file" id="csvInput" accept=".csv,.xlsx">
        <span class="field-hint" id="csvFileLabel">No file loaded</span>
      </div>
      <div class="field">
        <label for="hy8Input">HY-8 project file (.hy8, US units)</label>
        <input type="file" id="hy8Input" accept=".hy8">
        <span class="field-hint" id="hy8FileLabel">No file loaded</span>
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">2. Mapping mode</h2>
      </div>
      <div class="field-row">
        <label class="field-checkbox"><input type="radio" name="mapMode" id="modeName" checked> Match by culvert name</label>
        <label class="field-checkbox"><input type="radio" name="mapMode" id="modeStation"> Match by nearest station</label>
      </div>
      <div class="field" id="toleranceField" style="display:none">
        <label for="tolerance">Station tolerance (m)</label>
        <input type="number" id="tolerance" value="15" min="0" step="1">
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">3. Mapping preview</h2>
      </div>
      <p id="mappingSummary" class="hint">Load both a CSV and a .hy8 file to compute the mapping.</p>
      <table id="mappingTable">
        <thead><tr><th>CSV name</th><th>CSV station</th><th>HY-8 culvert</th><th>HY-8 crossing</th></tr></thead>
        <tbody></tbody>
      </table>
      <h3 class="card__title">Unmatched CSV rows</h3>
      <table id="unmatchedCsvTable">
        <thead><tr><th>Name</th><th>Station</th></tr></thead>
        <tbody></tbody>
      </table>
      <h3 class="card__title">Unmatched HY-8 crossings</h3>
      <table id="unmatchedHy8Table">
        <thead><tr><th>Culvert</th><th>Crossing</th></tr></thead>
        <tbody></tbody>
      </table>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">4. Differences</h2>
        <span class="card__hint">All values shown in SI — fields that would change on import (tolerance ~0.003 m)</span>
      </div>
      <div id="diffContainer"></div>
      <button id="exportDiffsBtn" class="btn" disabled>Export differences as CSV</button>
      <p id="diffStatusMsg" class="status"></p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">5. Design flows (optional)</h2>
        <span class="card__hint">Paste "name, flow (m3/s)" pairs, or load a small CSV — max = design + 5, min = 0</span>
      </div>
      <textarea id="flowText" rows="6" placeholder="CU-JSS-01, 10"></textarea>
      <div class="field">
        <label for="flowFileInput">Or load a flow file (CSV or Excel .xlsx)</label>
        <input type="file" id="flowFileInput" accept=".csv,.txt,.xlsx">
      </div>
      <p id="flowUnmatched" class="hint"></p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">6. Import &amp; download</h2>
      </div>
      <button id="importBtn" class="btn btn-primary" disabled>Import &amp; download updated .hy8</button>
      <p id="statusMsg" class="status"></p>
      <p class="hint">No data leaves this browser — the CSV and HY-8 file are read and written entirely client-side.</p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">7. Culvert summary (SI)</h2>
        <span class="card__hint">HW/D, normal &amp; critical depth, headwater elevation, outlet velocity per culvert</span>
      </div>
      <div class="field-row">
        <button id="computeSummaryBtn" class="btn" disabled>Compute summary (approx. HDS-5)</button>
        <button id="extractSummaryBtn" class="btn" disabled>Extract HY-8 results from loaded file</button>
        <button id="exportSummaryBtn" class="btn" disabled>Export summary as CSV</button>
      </div>
      <div class="field-row">
        <button id="analyzeAllBtn" class="btn" disabled>Analyze all crossings (full flow table)</button>
        <button id="exportAnalysisBtn" class="btn" disabled>Export full analysis as CSV</button>
      </div>
      <div id="analysisContainer"></div>
      <p class="hint" id="summaryHint">Compute runs an approximate FHWA HDS-5 analysis (box culverts,
        square-edge headwall inlet) on the imported geometry and design flows — spot-check against HY-8.
        Extract reads HY-8's own results from a .hy8 file that HY-8 has analyzed and saved.</p>
      <div id="summaryContainer"></div>
      <p id="summaryStatusMsg" class="status"></p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">8. HY-8 report extraction (DOCX)</h2>
        <span class="card__hint">Pull each culvert's design-flow results out of an HY-8 culvert analysis report</span>
      </div>
      <div class="field">
        <label for="docxInput">HY-8 culvert analysis report (.docx)</label>
        <input type="file" id="docxInput" accept=".docx" disabled>
        <span class="field-hint">Load the matching .hy8 file first — the design flow for each culvert is read from it.
          HW/D is computed as max(inlet, outlet control depth) ÷ rise (rise from the loaded culvert
          schedule, or the .hy8 file if no schedule is loaded), not taken from the report's HW/D column.</span>
      </div>
      <button id="exportReportBtn" class="btn" disabled>Export report results as Excel (.xlsx)</button>
      <div id="reportContainer"></div>
      <p id="reportStatusMsg" class="status"></p>
      <p class="hint">The Excel workbook has two sheets — <strong>Hydraulic Results</strong> and
        <strong>Geometric Data</strong> (barrels, cell width/height, cover, slope, invert elevations,
        length, skew) — with red conditional formatting where HW/D, outlet velocity, or cover cross
        the thresholds set in the Checks tab.</p>
    </section>
    </div>

    <div id="createTab" style="display:none">
    <section class="card">
      <div class="card__header">
        <h2 class="card__title">Create a new HY-8 file</h2>
        <span class="card__hint">One culvert per row — fully offline, nothing is uploaded</span>
      </div>
      <p class="hint">Download the template, fill one row per culvert (SI units), then load it back here.
        Give <strong>USIL &amp; DSIL</strong> directly, or leave both blank and give a <strong>Slope (m/m)</strong> —
        the downstream invert is then taken as 0 and the upstream invert as slope × length.
        Every crossing gets the standard roadway: crest elevation = USIL + cell height + 2 m cover,
        crest length 20 m, top width 8 m, constant roadway elevation, paved surface.</p>
      <div class="field-row">
        <button id="templateBtn" class="btn">Download Excel template (.xlsx)</button>
      </div>
      <div class="field">
        <label for="creatorInput">Filled culvert list — CSV or Excel .xlsx (SI units)</label>
        <input type="file" id="creatorInput" accept=".csv,.xlsx">
        <span class="field-hint" id="creatorFileLabel">No file loaded</span>
      </div>
      <div id="creatorContainer"></div>
      <div id="creatorErrors"></div>
      <div class="field">
        <label for="creatorProjectName">Output file name</label>
        <input type="text" id="creatorProjectName" value="New_Project">
        <span class="field-hint">The file downloads as &lt;name&gt;.hy8 — open it in HY-8, or load it in the other tab to analyze it.</span>
      </div>
      <button id="createBtn" class="btn btn-primary" disabled>Create &amp; download .hy8</button>
      <p id="creatorStatusMsg" class="status"></p>
    </section>
    </div>

    <div id="checksTab" style="display:none">
    <section class="card">
      <div class="card__header">
        <h2 class="card__title">Result checks</h2>
        <span class="card__hint">Flags culverts whose cover, HW/D, or outlet velocity cross the thresholds</span>
      </div>
      <p class="hint">Load a .hy8 file in the Import tab first. Cover is a <strong>minimum</strong>
        (flagged when below); HW/D and outlet velocity are <strong>maxima</strong> (flagged when above).
        HW/D and outlet velocity come from the HY-8 report (if one is loaded) or the in-browser HDS-5
        analysis; cover comes from the loaded culvert schedule's Average Cover column (matched by
        culvert name), falling back to the .hy8 file's roadway/invert data when no schedule is loaded.</p>
      <div class="field-row">
        <div class="field threshold-field">
          <label for="thCover">Cover — min (m)</label>
          <input type="number" id="thCover" value="1" min="0" step="0.1">
        </div>
        <div class="field threshold-field">
          <label for="thHwOverD">HW/D — max</label>
          <input type="number" id="thHwOverD" value="1" min="0" step="0.1">
        </div>
        <div class="field threshold-field">
          <label for="thVelocity">Outlet velocity — max (m/s)</label>
          <input type="number" id="thVelocity" value="4.5" min="0" step="0.1">
        </div>
      </div>
      <div class="field-row">
        <label class="field-checkbox"><input type="radio" name="checkSource" id="checkSrcReport"> Use HY-8 report results</label>
        <label class="field-checkbox"><input type="radio" name="checkSource" id="checkSrcComputed" checked> Use computed (approx. HDS-5)</label>
      </div>
      <div class="field-row">
        <button id="runChecksBtn" class="btn btn-primary" disabled>Run checks</button>
        <button id="exportChecksBtn" class="btn" disabled>Export checks as Excel (.xlsx)</button>
      </div>
      <div id="checksContainer"></div>
      <p id="checksStatusMsg" class="status"></p>
    </section>
    </div>
    </div>
  `;

  const els = {
    csvInput: root.querySelector('#csvInput'),
    csvFileLabel: root.querySelector('#csvFileLabel'),
    hy8Input: root.querySelector('#hy8Input'),
    hy8FileLabel: root.querySelector('#hy8FileLabel'),
    modeName: root.querySelector('#modeName'),
    modeStation: root.querySelector('#modeStation'),
    tolerance: root.querySelector('#tolerance'),
    toleranceField: root.querySelector('#toleranceField'),
    mappingSummary: root.querySelector('#mappingSummary'),
    mappingTable: root.querySelector('#mappingTable tbody'),
    unmatchedCsvTable: root.querySelector('#unmatchedCsvTable tbody'),
    unmatchedHy8Table: root.querySelector('#unmatchedHy8Table tbody'),
    diffContainer: root.querySelector('#diffContainer'),
    exportDiffsBtn: root.querySelector('#exportDiffsBtn'),
    diffStatusMsg: root.querySelector('#diffStatusMsg'),
    flowText: root.querySelector('#flowText'),
    flowFileInput: root.querySelector('#flowFileInput'),
    flowUnmatched: root.querySelector('#flowUnmatched'),
    importBtn: root.querySelector('#importBtn'),
    statusMsg: root.querySelector('#statusMsg'),
    computeSummaryBtn: root.querySelector('#computeSummaryBtn'),
    extractSummaryBtn: root.querySelector('#extractSummaryBtn'),
    exportSummaryBtn: root.querySelector('#exportSummaryBtn'),
    summaryContainer: root.querySelector('#summaryContainer'),
    summaryStatusMsg: root.querySelector('#summaryStatusMsg'),
    analyzeAllBtn: root.querySelector('#analyzeAllBtn'),
    exportAnalysisBtn: root.querySelector('#exportAnalysisBtn'),
    analysisContainer: root.querySelector('#analysisContainer'),
    docxInput: root.querySelector('#docxInput'),
    exportReportBtn: root.querySelector('#exportReportBtn'),
    reportContainer: root.querySelector('#reportContainer'),
    reportStatusMsg: root.querySelector('#reportStatusMsg'),
    tabBtnImport: root.querySelector('#tabBtnImport'),
    tabBtnCreate: root.querySelector('#tabBtnCreate'),
    tabBtnChecks: root.querySelector('#tabBtnChecks'),
    importTab: root.querySelector('#importTab'),
    createTab: root.querySelector('#createTab'),
    checksTab: root.querySelector('#checksTab'),
    templateBtn: root.querySelector('#templateBtn'),
    creatorInput: root.querySelector('#creatorInput'),
    creatorFileLabel: root.querySelector('#creatorFileLabel'),
    creatorContainer: root.querySelector('#creatorContainer'),
    creatorErrors: root.querySelector('#creatorErrors'),
    creatorProjectName: root.querySelector('#creatorProjectName'),
    createBtn: root.querySelector('#createBtn'),
    creatorStatusMsg: root.querySelector('#creatorStatusMsg'),
    thCover: root.querySelector('#thCover'),
    thHwOverD: root.querySelector('#thHwOverD'),
    thVelocity: root.querySelector('#thVelocity'),
    checkSrcReport: root.querySelector('#checkSrcReport'),
    checkSrcComputed: root.querySelector('#checkSrcComputed'),
    runChecksBtn: root.querySelector('#runChecksBtn'),
    exportChecksBtn: root.querySelector('#exportChecksBtn'),
    checksContainer: root.querySelector('#checksContainer'),
    checksStatusMsg: root.querySelector('#checksStatusMsg'),
    licenseGate: root.querySelector('#licenseGate'),
    planRow: root.querySelector('#planRow'),
    paymentDetails: root.querySelector('#paymentDetails'),
    machineIdLabel: root.querySelector('#machineIdLabel'),
    copyMachineIdBtn: root.querySelector('#copyMachineIdBtn'),
    licenseKeyInput: root.querySelector('#licenseKeyInput'),
    activateBtn: root.querySelector('#activateBtn'),
    licenseGateMsg: root.querySelector('#licenseGateMsg'),
    appBody: root.querySelector('#appBody'),
    licenseInfo: root.querySelector('#licenseInfo'),
  };

  // -- Licensing gate --
  // The tool stays hidden until a signed license key matching this machine's
  // fingerprint (and still within its validity period) is activated. The key
  // is remembered locally and re-verified on every load, so an expired key
  // locks the tool again.

  const gateMachineId = machineId || browserMachineId();
  state.licensed = license === false;
  state.licenseExpires = null;

  function storageGet() {
    try {
      return window.localStorage.getItem(LICENSE_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  function storageSet(value) {
    try {
      window.localStorage.setItem(LICENSE_STORAGE_KEY, value);
    } catch {
      /* private-mode or blocked storage: activation just won't persist */
    }
  }

  function applyLicenseState() {
    els.licenseGate.style.display = state.licensed ? 'none' : '';
    els.appBody.style.display = state.licensed ? '' : 'none';
    els.machineIdLabel.textContent = gateMachineId;
    els.licenseInfo.textContent =
      state.licensed && state.licenseExpires
        ? `Licensed to machine ${gateMachineId} — valid through ${state.licenseExpires}`
        : '';
    renderPlans();
  }

  // -- Payment (InstaPay + license server) --

  let selectedPlanId = null;
  let paymentTimer = null;

  function stopPaymentPolling() {
    if (paymentTimer) {
      clearInterval(paymentTimer);
      paymentTimer = null;
    }
  }

  function renderPlans() {
    if (!paymentConfigured()) {
      els.planRow.innerHTML =
        '<span class="hint">Online payment is not configured in this build — send the Machine ID above to ARX to purchase a license key.</span>';
      els.paymentDetails.innerHTML = '';
      return;
    }
    els.planRow.innerHTML = PLANS.map(
      (plan) =>
        `<button type="button" class="plan-card${plan.id === selectedPlanId ? ' is-selected' : ''}" data-plan="${plan.id}">
          <span class="plan-card__label">${escapeHtml(plan.label)}</span>
          <span class="plan-card__price">$${plan.usd}</span>
          <span class="plan-card__note">EGP ${plan.egp} via InstaPay</span>
        </button>`
    ).join('');
    for (const btn of els.planRow.querySelectorAll('[data-plan]')) {
      btn.addEventListener('click', () => selectPlan(btn.getAttribute('data-plan')));
    }
    renderPaymentDetails();
  }

  function renderPaymentDetails() {
    const plan = PLANS.find((p) => p.id === selectedPlanId);
    if (!plan) {
      els.paymentDetails.innerHTML = '<span class="field-hint">Choose a plan to see the payment steps.</span>';
      return;
    }
    const linkHtml = PAYMENT_CONFIG.instapayPaymentLink
      ? `<p>Or open the payment link: <a href="${escapeHtml(PAYMENT_CONFIG.instapayPaymentLink)}" target="_blank" rel="noopener">${escapeHtml(PAYMENT_CONFIG.instapayPaymentLink)}</a></p>`
      : '';
    const confirmHtml = serverConfigured()
      ? `<p><strong>3.</strong> Click the button below — the tool will confirm your payment online and activate
          itself for ${plan.days} days as soon as the transfer is verified.</p>
         <button type="button" id="paidBtn" class="btn btn-primary">I've paid — confirm my payment</button>
         <p id="paymentStatusMsg" class="status"></p>`
      : `<p><strong>3.</strong> After paying, send your Machine ID <code>${escapeHtml(gateMachineId)}</code> to ARX
          and you'll receive your ${plan.days}-day license key to paste above.</p>`;
    els.paymentDetails.innerHTML = `
      <div class="payment-box">
        <p><strong>1.</strong> In your banking or InstaPay app, transfer <strong>EGP ${plan.egp}</strong>
          (${plan.label} — $${plan.usd}) to <code>${escapeHtml(PAYMENT_CONFIG.instapayAddress)}</code>.</p>
        ${linkHtml}
        <p><strong>2.</strong> Put your Machine ID <code>${escapeHtml(gateMachineId)}</code> in the transfer note —
          that's how your payment is matched to this installation.</p>
        ${confirmHtml}
      </div>`;
    const paidBtn = els.paymentDetails.querySelector('#paidBtn');
    if (paidBtn) paidBtn.addEventListener('click', () => startPaymentConfirmation(plan));
  }

  function selectPlan(planId) {
    selectedPlanId = planId;
    stopPaymentPolling();
    renderPlans();
  }

  function setPaymentStatus(text, cls = 'status') {
    const msg = els.paymentDetails.querySelector('#paymentStatusMsg');
    if (msg) {
      msg.textContent = text;
      msg.className = cls;
    }
  }

  // Polls the license server until the vendor confirms the transfer; the
  // returned key goes through the normal activation path (signature +
  // machine + expiry checks), so the server is trusted only as a courier.
  async function checkPayment() {
    try {
      const status = await checkLicenseStatus(gateMachineId);
      if (status.status === 'approved' && status.key) {
        stopPaymentPolling();
        if (tryActivate(status.key)) {
          els.licenseGateMsg.textContent = '';
          return 'activated';
        }
        setPaymentStatus('The server sent a key, but it did not validate for this machine — contact ARX.', 'status status--error');
        return 'bad-key';
      }
      setPaymentStatus('Waiting for your payment to be confirmed… this page checks automatically every few seconds.');
      return status.status;
    } catch (err) {
      setPaymentStatus(`Could not reach the license server: ${err.message}. Retrying…`, 'status status--error');
      return 'error';
    }
  }

  async function startPaymentConfirmation(plan) {
    setPaymentStatus('Registering your payment…');
    try {
      await requestLicense(gateMachineId, plan.id);
    } catch (err) {
      setPaymentStatus(`Could not reach the license server: ${err.message}`, 'status status--error');
      return;
    }
    await checkPayment();
    stopPaymentPolling();
    paymentTimer = setInterval(checkPayment, 10000);
  }

  function tryActivate(key, { persist = true, silent = false } = {}) {
    const result = verifyLicenseKey(key, gateMachineId);
    if (result.valid) {
      state.licensed = true;
      state.licenseExpires = result.expires;
      if (persist) storageSet(String(key).replace(/\s+/g, ''));
      stopPaymentPolling();
      applyLicenseState();
      return true;
    }
    if (!silent) {
      els.licenseGateMsg.textContent = `Activation failed: ${result.reason}.`;
      els.licenseGateMsg.className = 'status status--error';
    } else if (result.expires) {
      // A previously working key that no longer validates (usually expired):
      // explain why the tool re-locked instead of showing a blank gate.
      els.licenseGateMsg.textContent = `Your license is no longer valid: ${result.reason}.`;
      els.licenseGateMsg.className = 'status status--error';
    }
    return false;
  }

  if (license !== false) {
    const stored = storageGet();
    if (stored) tryActivate(stored, { persist: false, silent: true });
  }
  applyLicenseState();

  els.activateBtn.addEventListener('click', () => {
    if (tryActivate(els.licenseKeyInput.value)) {
      els.licenseGateMsg.textContent = '';
    }
  });
  els.copyMachineIdBtn.addEventListener('click', () => {
    const copied = (() => {
      try {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(gateMachineId);
          return true;
        }
      } catch {
        /* fall through to the message below */
      }
      return false;
    })();
    els.licenseGateMsg.textContent = copied
      ? 'Machine ID copied to clipboard.'
      : `Machine ID: ${gateMachineId} (select and copy it manually)`;
    els.licenseGateMsg.className = 'status';
  });

  const TABS = {
    import: { btn: els.tabBtnImport, panel: els.importTab },
    create: { btn: els.tabBtnCreate, panel: els.createTab },
    checks: { btn: els.tabBtnChecks, panel: els.checksTab },
  };
  function selectTab(which) {
    for (const [key, { btn, panel }] of Object.entries(TABS)) {
      const active = key === which;
      panel.style.display = active ? '' : 'none';
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    if (which === 'checks') refreshChecksControls();
  }
  els.tabBtnImport.addEventListener('click', () => selectTab('import'));
  els.tabBtnCreate.addEventListener('click', () => selectTab('create'));
  els.tabBtnChecks.addEventListener('click', () => selectTab('checks'));

  function recomputeMapping() {
    state.mapResult =
      state.hy8Doc && state.csvRows.length
        ? mapCulverts(state.csvRows, state.hy8Doc, { mode: state.mode, toleranceM: state.toleranceM })
        : { pairs: [], unmatchedCsv: [], unmatchedHy8: [] };
    // Inputs changed, so any previously computed summary/analysis is stale.
    state.summaryRows = null;
    state.summarySource = null;
    state.fullAnalysis = null;
    els.analysisContainer.innerHTML = '';
    els.summaryStatusMsg.textContent = '';
    // A schedule change alters the rises used for the report's HW/D —
    // re-extract an already-loaded report with the fresh values.
    if (state.reportTables && state.hy8Doc) runReportExtraction();
    render();
    renderSummary();
  }

  function updateFlowPreview() {
    if (!state.hy8Doc) {
      els.flowUnmatched.textContent = '';
      return;
    }
    const flows = parseFlowInput(els.flowText.value);
    if (!flows.length) {
      els.flowUnmatched.textContent = '';
      return;
    }
    const names = new Set(state.hy8Doc.crossings.map((c) => (c.culverts[0].name || '').trim().toLowerCase()));
    const unmatched = flows.filter((f) => !names.has(String(f.name).trim().toLowerCase()));
    els.flowUnmatched.textContent = unmatched.length
      ? `Warning: ${unmatched.length} flow name(s) not found in the HY-8 file: ${unmatched.map((f) => f.name).join(', ')}`
      : `${flows.length} flow row(s) parsed, all names matched.`;
  }

  function render() {
    const { pairs, unmatchedCsv, unmatchedHy8 } = state.mapResult;
    els.mappingSummary.textContent =
      state.hy8Doc && state.csvRows.length
        ? `${pairs.length} matched, ${unmatchedCsv.length} CSV row(s) unmatched, ${unmatchedHy8.length} HY-8 crossing(s) unmatched.`
        : 'Load both a CSV and a .hy8 file to compute the mapping.';
    els.mappingTable.innerHTML = pairs.map(renderMappingRow).join('');
    els.unmatchedCsvTable.innerHTML = unmatchedCsv.map(renderUnmatchedCsvRow).join('');
    els.unmatchedHy8Table.innerHTML = unmatchedHy8.map(renderUnmatchedHy8Row).join('');

    let totalDiffs = 0;
    if (pairs.length && state.hy8Doc) {
      const blocks = [];
      for (const pair of pairs) {
        const diffs = diffPair(pair, state.hy8Doc, state.mode);
        totalDiffs += diffs.length;
        if (diffs.length) blocks.push(renderDiffSection(pair.culvert.name || pair.crossing.name || '', diffs));
      }
      els.diffContainer.innerHTML = blocks.length ? blocks.join('') : '<p class="hint">No differences found for the mapped pairs.</p>';
    } else {
      els.diffContainer.innerHTML = '';
    }

    updateFlowPreview();
    els.importBtn.disabled = pairs.length === 0;
    els.exportDiffsBtn.disabled = totalDiffs === 0;
    els.computeSummaryBtn.disabled = !state.hy8Doc;
    els.extractSummaryBtn.disabled = !state.hy8Doc;
    els.exportSummaryBtn.disabled = !state.summaryRows;
    els.analyzeAllBtn.disabled = !state.hy8Doc;
    els.exportAnalysisBtn.disabled = !state.fullAnalysis;
    els.docxInput.disabled = !state.hy8Doc;
    els.exportReportBtn.disabled = !state.reportRows;
    refreshChecksControls();
  }

  function renderSummary() {
    els.summaryContainer.innerHTML = state.summaryRows ? renderSummaryTable(state.summaryRows) : '';
    els.exportSummaryBtn.disabled = !state.summaryRows;
  }

  function setCsvText(text, fileName) {
    state.csvFileName = fileName;
    els.csvFileLabel.textContent = fileName;
    state.csvRows = parseCulvertCsv(text);
    recomputeMapping();
  }

  function setCsvRows(rows, fileName) {
    state.csvFileName = fileName;
    els.csvFileLabel.textContent = fileName;
    state.csvRows = rowsToCulverts(rows);
    recomputeMapping();
  }

  function setHy8Text(text, fileName) {
    state.hy8FileName = fileName;
    els.hy8FileLabel.textContent = fileName;
    state.hy8Doc = parseHy8(text);
    // Any previously extracted report belonged to the old file.
    state.reportRows = null;
    state.reportTables = null;
    state.reportFileName = null;
    els.reportContainer.innerHTML = '';
    els.reportStatusMsg.textContent = '';
    // Checks belonged to the old file too.
    state.checkRows = null;
    state.checkSource = null;
    els.checksContainer.innerHTML = '';
    els.checksStatusMsg.textContent = '';
    recomputeMapping();
  }

  // The imported doc: geometry patches for the current mapping plus any
  // pasted flows. When nothing is mapped, this is the loaded file as-is
  // (still useful for analyzing an already-complete .hy8).
  function buildUpdatedDoc() {
    let doc = state.hy8Doc;
    if (state.mapResult.pairs.length) {
      doc = applyGeometryImport(doc, state.mapResult.pairs, state.mode);
    }
    const flows = parseFlowInput(els.flowText.value);
    let flowResult = { updated: [], unmatchedNames: [] };
    if (flows.length) {
      const applied = applyFlows(doc, flows);
      doc = applied.doc;
      flowResult = applied;
    }
    return { doc, flows, flowResult };
  }

  function runImport() {
    if (!state.hy8Doc || !state.mapResult.pairs.length) {
      els.statusMsg.textContent = 'Load a CSV and a .hy8 file and compute a mapping before importing.';
      els.statusMsg.className = 'status status--error';
      return;
    }
    const { doc, flows, flowResult } = buildUpdatedDoc();

    const outputText = serializeHy8(doc);
    const outName = downloadName(state.hy8FileName, '_updated.hy8');
    download(outName, outputText, 'application/octet-stream');

    els.statusMsg.textContent =
      `Downloaded ${outName} — ${state.mapResult.pairs.length} culvert(s) updated` +
      (flows.length ? `, ${flowResult.updated.length} flow(s) applied` : '') +
      (flowResult.unmatchedNames.length ? ` (${flowResult.unmatchedNames.length} flow name(s) unmatched)` : '') +
      '.';
    els.statusMsg.className = 'status status--success';
  }

  els.csvInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    if (/\.xlsx$/i.test(file.name)) {
      reader.onload = () => {
        parseXlsxRows(reader.result)
          .then((rows) => setCsvRows(rows, file.name))
          .catch((err) => {
            els.csvFileLabel.textContent = `Could not read ${file.name}: ${err.message}`;
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => setCsvText(reader.result, file.name);
      reader.readAsText(file, 'iso-8859-1');
    }
  });

  els.hy8Input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setHy8Text(reader.result, file.name);
    reader.readAsText(file);
  });

  els.modeName.addEventListener('change', () => {
    if (!els.modeName.checked) return;
    state.mode = 'name';
    els.toleranceField.style.display = 'none';
    recomputeMapping();
  });
  els.modeStation.addEventListener('change', () => {
    if (!els.modeStation.checked) return;
    state.mode = 'station';
    els.toleranceField.style.display = '';
    recomputeMapping();
  });
  els.tolerance.addEventListener('input', () => {
    const v = Number(els.tolerance.value);
    state.toleranceM = Number.isFinite(v) && v >= 0 ? v : 15;
    if (state.mode === 'station') recomputeMapping();
  });

  els.flowText.addEventListener('input', () => updateFlowPreview());
  els.flowFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    if (/\.xlsx$/i.test(file.name)) {
      reader.onload = () => {
        parseXlsxRows(reader.result)
          .then((rows) => {
            els.flowText.value = rowsToText(rows);
            updateFlowPreview();
          })
          .catch((err) => {
            els.flowUnmatched.textContent = `Could not read ${file.name}: ${err.message}`;
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        els.flowText.value = reader.result;
        updateFlowPreview();
      };
      reader.readAsText(file);
    }
  });

  els.importBtn.addEventListener('click', () => {
    try {
      runImport();
    } catch (err) {
      els.statusMsg.textContent = `Import failed: ${err.message}`;
      els.statusMsg.className = 'status status--error';
    }
  });

  els.exportDiffsBtn.addEventListener('click', () => {
    try {
      const csv = generateDifferencesCsv(state.mapResult.pairs, state.hy8Doc, state.mode);
      const name = downloadName(state.hy8FileName, '_differences.csv');
      download(name, csv, 'text/csv');
      els.diffStatusMsg.textContent = `Downloaded ${name}.`;
      els.diffStatusMsg.className = 'status status--success';
    } catch (err) {
      els.diffStatusMsg.textContent = `Export failed: ${err.message}`;
      els.diffStatusMsg.className = 'status status--error';
    }
  });

  function setSummary(rows, source, label) {
    state.summaryRows = rows;
    state.summarySource = source;
    renderSummary();
    const analyzed = rows.filter((r) => !r.error).length;
    const skipped = rows.length - analyzed;
    els.summaryStatusMsg.textContent =
      `${label}: ${analyzed} culvert(s) analyzed` + (skipped ? `, ${skipped} skipped (see notes in rows)` : '') + '.';
    els.summaryStatusMsg.className = 'status status--success';
  }

  els.computeSummaryBtn.addEventListener('click', () => {
    try {
      const { doc } = buildUpdatedDoc();
      setSummary(buildComputedSummary(doc), 'computed (approx. HDS-5)', 'Computed after import');
    } catch (err) {
      els.summaryStatusMsg.textContent = `Analysis failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.extractSummaryBtn.addEventListener('click', () => {
    try {
      setSummary(buildExtractedSummary(state.hy8Doc), 'extracted from HY-8 file', 'Extracted from loaded file');
    } catch (err) {
      els.summaryStatusMsg.textContent = `Extraction failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.exportSummaryBtn.addEventListener('click', () => {
    try {
      const csv = generateSummaryCsv(state.summaryRows, state.summarySource);
      const name = downloadName(state.hy8FileName, '_summary.csv');
      download(name, csv, 'text/csv');
      els.summaryStatusMsg.textContent = `Downloaded ${name}.`;
      els.summaryStatusMsg.className = 'status status--success';
    } catch (err) {
      els.summaryStatusMsg.textContent = `Export failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.analyzeAllBtn.addEventListener('click', () => {
    try {
      const { doc } = buildUpdatedDoc();
      state.fullAnalysis = buildFullAnalysis(doc);
      els.analysisContainer.innerHTML = renderFullAnalysis(state.fullAnalysis);
      els.exportAnalysisBtn.disabled = false;
      const analyzed = state.fullAnalysis.filter((c) => !c.error).length;
      const skipped = state.fullAnalysis.length - analyzed;
      els.summaryStatusMsg.textContent =
        `Analyzed ${analyzed} crossing(s) across their full flow range` +
        (skipped ? `, ${skipped} skipped` : '') + ' — ★ marks the design flow. Click a crossing to expand its table.';
      els.summaryStatusMsg.className = 'status status--success';
    } catch (err) {
      els.summaryStatusMsg.textContent = `Analysis failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.exportAnalysisBtn.addEventListener('click', () => {
    try {
      const csv = generateFullAnalysisCsv(state.fullAnalysis);
      const name = downloadName(state.hy8FileName, '_full_analysis.csv');
      download(name, csv, 'text/csv');
      els.summaryStatusMsg.textContent = `Downloaded ${name}.`;
      els.summaryStatusMsg.className = 'status status--success';
    } catch (err) {
      els.summaryStatusMsg.textContent = `Export failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  // Extracts the design-flow results from an HY-8 report .docx, using the
  // loaded .hy8 (not the imported copy) — the report was generated from it.
  function runReportExtraction() {
    state.reportRows = extractReportResults(state.reportTables, state.hy8Doc, { csvRows: state.csvRows });
    els.reportContainer.innerHTML = renderReportTable(state.reportRows);
    els.exportReportBtn.disabled = false;
    const extracted = state.reportRows.filter((r) => !r.error).length;
    const flagged = state.reportRows.length - extracted;
    els.reportStatusMsg.textContent =
      `${state.reportFileName}: ${extracted} culvert(s) extracted at their design flow` +
      (flagged ? `, ${flagged} flagged (see notes)` : '') + '.';
    els.reportStatusMsg.className = 'status status--success';
    // A report is now available — make it the default source for the checks
    // tab and refresh a stale check run against the fresh results.
    if (els.checkSrcReport) {
      els.checkSrcReport.checked = true;
      refreshChecksControls();
      if (state.checkRows) runChecksInTab();
    }
  }

  async function setReportDocx(arrayBuffer, fileName) {
    if (!state.hy8Doc) {
      els.reportStatusMsg.textContent = 'Load the matching .hy8 file first.';
      els.reportStatusMsg.className = 'status status--error';
      return;
    }
    const tables = await parseDocxSummaryTables(arrayBuffer);
    if (!tables.length) throw new Error('no "Culvert Summary Table" found in this document');
    state.reportTables = tables;
    state.reportFileName = fileName;
    runReportExtraction();
  }

  els.docxInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReportDocx(reader.result, file.name).catch((err) => {
        els.reportStatusMsg.textContent = `Could not read ${file.name}: ${err.message}`;
        els.reportStatusMsg.className = 'status status--error';
      });
    };
    reader.readAsArrayBuffer(file);
  });

  els.exportReportBtn.addEventListener('click', () => {
    try {
      readThresholds();
      const bytes = buildReportExcel(state.reportRows, geometryWithScheduleCover(), state.thresholds);
      const name = downloadName(state.hy8FileName, '_report_results.xlsx');
      download(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      els.reportStatusMsg.textContent = `Downloaded ${name} — Hydraulic Results + Geometric Data sheets.`;
      els.reportStatusMsg.className = 'status status--success';
    } catch (err) {
      els.reportStatusMsg.textContent = `Export failed: ${err.message}`;
      els.reportStatusMsg.className = 'status status--error';
    }
  });

  // -- Create-new-HY8 tab --

  function setCreatorGrid(grid, fileName) {
    state.creatorFileName = fileName;
    const { culverts, errors } = parseCreatorRows(grid);
    state.creatorCulverts = culverts;
    state.creatorErrors = errors;

    els.creatorFileLabel.textContent =
      `${fileName} — ${culverts.length} culvert(s) parsed` + (errors.length ? `, ${errors.length} row(s) skipped` : '');
    els.creatorContainer.innerHTML = culverts.length ? renderCreatorTable(culverts) : '';
    els.creatorErrors.innerHTML = errors.length
      ? `<p class="hint">Skipped rows:</p><ul class="hint">${errors
          .map((e) => `<li>${escapeHtml(e.name || '(unnamed)')} — ${escapeHtml(e.message)}</li>`)
          .join('')}</ul>`
      : '';
    els.createBtn.disabled = culverts.length === 0;
    els.creatorStatusMsg.textContent = '';
  }

  function runCreate() {
    const text = buildHy8Project(state.creatorCulverts);
    const base = (els.creatorProjectName.value || 'New_Project').trim().replace(/\.hy8$/i, '') || 'New_Project';
    const name = `${base}.hy8`;
    download(name, text, 'application/octet-stream');
    els.creatorStatusMsg.textContent =
      `Downloaded ${name} — ${state.creatorCulverts.length} crossing(s) created. Open it in HY-8, or load it in the other tab to analyze it.`;
    els.creatorStatusMsg.className = 'status status--success';
  }

  els.templateBtn.addEventListener('click', () => {
    download('HY8_culvert_template.xlsx', buildCreatorTemplateXlsx(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    els.creatorStatusMsg.textContent = 'Downloaded HY8_culvert_template.xlsx — fill it in and load it above.';
    els.creatorStatusMsg.className = 'status status--success';
  });

  els.creatorInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    if (/\.xlsx$/i.test(file.name)) {
      reader.onload = () => {
        parseXlsxRows(reader.result)
          .then((rows) => setCreatorGrid(rows, file.name))
          .catch((err) => {
            els.creatorFileLabel.textContent = `Could not read ${file.name}: ${err.message}`;
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => setCreatorGrid(parseCsvGrid(reader.result), file.name);
      reader.readAsText(file, 'iso-8859-1');
    }
  });

  els.createBtn.addEventListener('click', () => {
    try {
      runCreate();
    } catch (err) {
      els.creatorStatusMsg.textContent = `Create failed: ${err.message}`;
      els.creatorStatusMsg.className = 'status status--error';
    }
  });

  // -- Checks tab --

  function readThresholds() {
    const num = (el, def) => {
      const v = Number(el.value);
      return Number.isFinite(v) && v >= 0 ? v : def;
    };
    state.thresholds = {
      coverMinM: num(els.thCover, DEFAULT_THRESHOLDS.coverMinM),
      hwOverDMax: num(els.thHwOverD, DEFAULT_THRESHOLDS.hwOverDMax),
      outletVelocityMaxMs: num(els.thVelocity, DEFAULT_THRESHOLDS.outletVelocityMaxMs),
    };
    return state.thresholds;
  }

  function refreshChecksControls() {
    const hasReport = !!state.reportRows;
    els.checkSrcReport.disabled = !hasReport;
    if (!hasReport && els.checkSrcReport.checked) els.checkSrcComputed.checked = true;
    els.runChecksBtn.disabled = !state.hy8Doc;
    els.exportChecksBtn.disabled = !state.checkRows;
  }

  // Geometry keyed by culvert name, with the cover replaced by the loaded
  // culvert schedule's Average Cover column (the design cover) whenever the
  // culvert is in the schedule. Falls back to the .hy8 file's own roadway
  // cover for culverts not in the schedule (or when none is loaded).
  function geometryWithScheduleCover() {
    const geom = geometryByName(state.hy8Doc);
    const coverByName = new Map();
    for (const r of state.csvRows) {
      if (r.name && Number.isFinite(r.coverM)) coverByName.set(r.name.trim().toLowerCase(), r.coverM);
    }
    // Whatever the mapping paired (covers station-mode matches too).
    for (const { csvRow, culvert, crossing } of state.mapResult.pairs) {
      if (Number.isFinite(csvRow.coverM)) {
        coverByName.set((culvert.name || crossing.name || '').trim().toLowerCase(), csvRow.coverM);
      }
    }
    for (const [key, g] of geom) {
      if (coverByName.has(key)) g.coverM = coverByName.get(key);
    }
    return geom;
  }

  // name(lowercased) -> { hwOverD, outletVelocityMs } from the chosen source.
  function chosenHydraulic() {
    const map = new Map();
    if (els.checkSrcReport.checked && state.reportRows) {
      for (const r of state.reportRows) if (!r.error) map.set((r.name || '').trim().toLowerCase(), r);
      return { map, label: 'HY-8 report results' };
    }
    for (const r of buildComputedSummary(state.hy8Doc)) {
      if (!r.error) map.set((r.name || '').trim().toLowerCase(), r);
    }
    return { map, label: 'computed (approx. HDS-5)' };
  }

  function runChecksInTab() {
    if (!state.hy8Doc) {
      els.checksStatusMsg.textContent = 'Load a .hy8 file in the Import tab first.';
      els.checksStatusMsg.className = 'status status--error';
      return;
    }
    readThresholds();
    const { map, label } = chosenHydraulic();
    state.checkRows = runChecks(geometryWithScheduleCover(), map, state.thresholds);
    state.checkSource = label;
    els.checksContainer.innerHTML = renderChecksTable(state.checkRows, state.thresholds);
    els.exportChecksBtn.disabled = false;
    const failed = countFailures(state.checkRows);
    els.checksStatusMsg.textContent = `${state.checkRows.length} culvert(s) checked against ${label} — ${failed} flagged.`;
    els.checksStatusMsg.className = failed ? 'status status--error' : 'status status--success';
  }

  els.runChecksBtn.addEventListener('click', () => {
    try {
      runChecksInTab();
    } catch (err) {
      els.checksStatusMsg.textContent = `Checks failed: ${err.message}`;
      els.checksStatusMsg.className = 'status status--error';
    }
  });

  for (const el of [els.thCover, els.thHwOverD, els.thVelocity]) {
    el.addEventListener('input', () => {
      readThresholds();
      if (state.checkRows) runChecksInTab(); // keep the flags and header live
    });
  }
  els.checkSrcReport.addEventListener('change', () => state.checkRows && runChecksInTab());
  els.checkSrcComputed.addEventListener('change', () => state.checkRows && runChecksInTab());

  els.exportChecksBtn.addEventListener('click', () => {
    try {
      const bytes = buildChecksExcel(state.checkRows, state.thresholds);
      const name = downloadName(state.hy8FileName, '_checks.xlsx');
      download(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      els.checksStatusMsg.textContent = `Downloaded ${name}.`;
      els.checksStatusMsg.className = 'status status--success';
    } catch (err) {
      els.checksStatusMsg.textContent = `Export failed: ${err.message}`;
      els.checksStatusMsg.className = 'status status--error';
    }
  });

  render();

  return {
    state,
    machineId: gateMachineId,
    tryActivate,
    selectPlan,
    checkPayment,
    setCsvText,
    setCsvRows,
    setHy8Text,
    setReportDocx,
    setCreatorGrid,
    runCreate,
    selectTab,
    runChecksInTab,
    recomputeMapping,
    runImport,
  };
}

function downloadName(originalName, suffix) {
  const base = (originalName || 'Section').replace(/\.[^./\\]+$/, '');
  return `${base}${suffix}`;
}

function defaultDownload(name, text, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
