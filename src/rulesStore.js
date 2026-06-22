const VALID_SEVERITIES = ['error', 'warn'];

export const DEFAULT_RULES = {
  project: [
    { id: 'name', label: 'PROJECT NAME', value: '' },
    { id: 'number', label: 'PROJECT NO', value: '' },
    { id: 'client', label: 'CLIENT', value: '' },
  ],
  spelling: { language: 'en', customDictionary: [], ignore: [] },
  rules: [
    { id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', message: 'Drawing number must match AA-000', severity: 'error', enabled: true },
    { id: 'rev', category: 'revision', label: 'REV', message: 'Revision must be present', severity: 'error', enabled: true },
    { id: 'date', category: 'revision', label: 'DATE', message: 'Date must be present', severity: 'error', enabled: true },
    { id: 'drawnBy', category: 'revision', label: 'DRAWN BY', message: 'Drawn-by must be present', severity: 'error', enabled: true },
    { id: 'checkedBy', category: 'revision', label: 'CHECKED BY', message: 'Checked-by must be present', severity: 'error', enabled: true },
    { id: 'approvedBy', category: 'revision', label: 'APPROVED BY', message: 'Approved-by must be present', severity: 'error', enabled: true },
    { id: 'isoDate', category: 'formatting', label: 'ISO date format', find: '\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b', valid: '^\\d{4}-\\d{2}-\\d{2}$', message: 'Use ISO date format (YYYY-MM-DD)', severity: 'warn', enabled: true },
  ],
};

function validateRulesShape(r) {
  for (const key of ['project', 'spelling', 'rules']) {
    if (!(key in r)) throw new Error(`Invalid rules file: missing "${key}"`);
  }
  if (!Array.isArray(r.rules)) throw new Error('Invalid rules file: "rules" must be an array');
}

function validateRule(rule) {
  if (!VALID_SEVERITIES.includes(rule.severity)) {
    throw new Error(`Invalid severity "${rule.severity}" for rule "${rule.id}"; must be "error" or "warn"`);
  }
  for (const field of ['pattern', 'find', 'valid']) {
    if (rule[field] == null) continue;
    try {
      new RegExp(rule[field]);
    } catch (err) {
      throw new Error(`Invalid regex in "${field}" for rule "${rule.id}": ${err.message}`);
    }
  }
}

export function createRulesStore(initial = DEFAULT_RULES) {
  let state = structuredClone(initial);

  return {
    getRules: () => structuredClone(state),

    listRules: () => state.rules.map(({ id, category, label, enabled, severity }) => ({ id, category, label, enabled, severity })),

    getRule: (id) => {
      const rule = state.rules.find((r) => r.id === id);
      return rule ? structuredClone(rule) : null;
    },

    addRule(rule) {
      if (state.rules.some((r) => r.id === rule.id)) {
        throw new Error(`Rule id "${rule.id}" already exists`);
      }
      const candidate = { enabled: true, severity: 'warn', ...rule };
      validateRule(candidate);
      state.rules.push(candidate);
    },

    updateRule(id, updates) {
      const idx = state.rules.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error(`Rule id "${id}" not found`);
      const candidate = { ...state.rules[idx], ...updates, id };
      validateRule(candidate);
      state.rules[idx] = candidate;
    },

    removeRule(id) {
      state.rules = state.rules.filter((r) => r.id !== id);
    },

    setProjectFieldValue(id, value) {
      const field = state.project.find((f) => f.id === id);
      if (!field) throw new Error(`Project field "${id}" not found`);
      field.value = value;
    },

    addCustomDictionaryWord(word) {
      if (!state.spelling.customDictionary.includes(word)) {
        state.spelling.customDictionary.push(word);
      }
    },

    removeCustomDictionaryWord(word) {
      state.spelling.customDictionary = state.spelling.customDictionary.filter((w) => w !== word);
    },

    // Merges whitespace/newline-separated words from a dictionary file into the
    // custom dictionary, skipping ones already present. Returns the number of
    // genuinely new words added.
    importDictionary(text) {
      const words = String(text).split(/\s+/).map((w) => w.trim()).filter(Boolean);
      let added = 0;
      for (const w of words) {
        if (!state.spelling.customDictionary.includes(w)) {
          state.spelling.customDictionary.push(w);
          added += 1;
        }
      }
      return added;
    },

    // Serializes the custom dictionary as one word per line, for export to a
    // plain-text file the user can keep, edit, or re-import later.
    exportDictionary() {
      return state.spelling.customDictionary.join('\n');
    },

    importRules(json) {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      validateRulesShape(parsed);
      parsed.rules.forEach(validateRule);
      state = parsed;
    },

    exportRules() {
      return JSON.stringify(state, null, 2);
    },
  };
}
