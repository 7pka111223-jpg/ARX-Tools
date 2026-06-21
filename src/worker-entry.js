import nspell from 'nspell';
import { processFile } from './processFile.js';

// build.js injects `self.__DICTIONARY__ = { aff, dic }` (plain text strings
// read from the dictionary-en package at build time) into the bundle before
// this code runs, so no file system access happens in the browser.
let spellInstance = null;
function getSpellInstance() {
  if (!spellInstance) {
    spellInstance = nspell({ aff: self.__DICTIONARY__.aff, dic: self.__DICTIONARY__.dic });
  }
  return spellInstance;
}

self.onmessage = async (event) => {
  const { fileName, pdfBytes, rulesConfig, jobId } = event.data;
  try {
    const result = await processFile(fileName, pdfBytes, rulesConfig, getSpellInstance());
    self.postMessage({ jobId, result });
  } catch (err) {
    self.postMessage({
      jobId,
      result: {
        fileName,
        pass: false,
        issues: [{ category: 'extraction', severity: 'error', ruleId: 'unexpected', foundText: null, page: null, message: `Unexpected error: ${err.message}` }],
        counts: { error: 1, warn: 0 },
      },
    });
  }
};
