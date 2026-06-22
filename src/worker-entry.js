// Side-effect-only import: registers globalThis.pdfjsWorker.WorkerMessageHandler
// so pdfjs-dist's PDFWorker#initialize() takes the in-thread "fake worker"
// branch (LoopbackPort, no nested real Worker, no `window` reference) instead
// of falling through to the real-Worker path that requires
// GlobalWorkerOptions.workerSrc and references `window.location` -- neither
// of which is available/correct inside this dedicated Worker's global scope.
// MUST be imported before any pdfjs-dist getDocument() call, so it is placed
// first in this file.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import nspell from 'nspell';
import { processFile } from './processFile.js';
import { spellCheckFile } from './spellCheckFile.js';
import { ruleCheckFile } from './ruleCheckFile.js';
import { annotateFile } from './annotateFile.js';

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
  const { mode, fileName, pdfBytes, rulesConfig, spellingConfig, jobId } = event.data;
  try {
    let result;
    if (mode === 'spelling') {
      result = await spellCheckFile(fileName, pdfBytes, spellingConfig, getSpellInstance());
    } else if (mode === 'rules') {
      result = await ruleCheckFile(fileName, pdfBytes, rulesConfig);
    } else if (mode === 'annotate') {
      result = await annotateFile(fileName, pdfBytes, rulesConfig);
    } else {
      result = await processFile(fileName, pdfBytes, rulesConfig, getSpellInstance());
    }
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
