import { escapeRegex } from './util.js';

function computeRegionBox(pageWidth, pageHeight, region) {
  if (!/^(top|bottom)-(left|right)$/.test(region.corner)) {
    throw new Error(
      `Invalid region.corner "${region.corner}": expected one of "top-left", "top-right", "bottom-left", "bottom-right"`
    );
  }
  if (!Number.isFinite(region.widthPct)) {
    throw new Error(`Invalid region.widthPct "${region.widthPct}": expected a finite number`);
  }
  if (!Number.isFinite(region.heightPct)) {
    throw new Error(`Invalid region.heightPct "${region.heightPct}": expected a finite number`);
  }

  const w = pageWidth * (region.widthPct / 100);
  const h = pageHeight * (region.heightPct / 100);
  const right = region.corner.includes('right');
  const bottom = region.corner.includes('bottom');
  return {
    xMin: right ? pageWidth - w : 0,
    xMax: right ? pageWidth : w,
    yMin: bottom ? pageHeight - h : 0,
    yMax: bottom ? pageHeight : h,
  };
}

function inBox(item, box) {
  return item.x >= box.xMin && item.x <= box.xMax && item.y >= box.yMin && item.y <= box.yMax;
}

// The on-page rectangle of a single text item, in the same top-down y
// coordinate space the extractor produces (used to place PDF annotations).
export function itemBox(item) {
  return { x: item.x, y: item.y, w: item.width || 0, h: item.height || 0 };
}

// Matches "LABEL: value" or "LABEL value" at the START of an item's own text,
// capturing the value token. Anchored per-item (not against a flattened blob)
// so that one label can never "hide inside" an unrelated word, and so that a
// longer label (e.g. "REVISION DATE") doesn't get shadowed by a shorter one
// that is a substring of it (e.g. "DATE").
function sameItemRegex(label) {
  return new RegExp(`^\\s*${escapeRegex(label)}\\s*[:\\-]?\\s*(\\S+)`, 'i');
}

// Matches an item whose text is JUST the label (optionally with a trailing
// ":" or "-") and nothing else - i.e. the value, if any, lives in a
// following item.
function labelOnlyRegex(label) {
  return new RegExp(`^\\s*${escapeRegex(label)}\\s*[:\\-]?\\s*$`, 'i');
}

// True if `text` looks like a label (label-only or label+value) for ANY field
// in `requiredFields` other than `excludeFieldId`. Used to stop a field from
// swallowing the next item as its "value" when that next item is actually
// somebody else's label.
function looksLikeAnotherFieldLabel(text, requiredFields, excludeFieldId) {
  return requiredFields.some((other) => {
    if (other.id === excludeFieldId) return false;
    return labelOnlyRegex(other.label).test(text) || sameItemRegex(other.label).test(text);
  });
}

// Finds the value next to a field's label within an ordered item list, and
// the on-page box of the item the value came from. Returns null if the label
// isn't present (or is present but has no real value).
function findLabeledField(items, field, requiredFields) {
  const sameRe = sameItemRegex(field.label);
  const labelOnlyRe = labelOnlyRegex(field.label);

  for (let i = 0; i < items.length; i += 1) {
    const text = items[i].text;

    // Check label-only FIRST: for an item like "DWG NO:" with nothing after
    // the label, sameRe's optional [:\-]? can backtrack to leave the colon
    // itself as the captured "value" (since (\S+) is happy to match ":").
    // Testing labelOnlyRe before sameRe avoids that false capture.
    if (labelOnlyRe.test(text)) {
      const next = items[i + 1];
      if (!next) {
        return null;
      }
      if (looksLikeAnotherFieldLabel(next.text, requiredFields, field.id)) {
        return null;
      }
      const nextTrimmed = next.text.trim();
      return nextTrimmed.length > 0 ? { value: nextTrimmed, box: itemBox(next) } : null;
    }

    const sameMatch = text.match(sameRe);
    if (sameMatch) {
      return { value: sameMatch[1], box: itemBox(items[i]) };
    }
  }

  return null;
}

function findFieldValue(items, field, requiredFields) {
  const found = findLabeledField(items, field, requiredFields);
  return found ? found.value : null;
}

export function locateFieldsOnPage(page, requiredFields, region) {
  const box = computeRegionBox(page.width, page.height, region);
  const items = page.items.filter((it) => inBox(it, box)).sort((a, b) => a.y - b.y || a.x - b.x);

  const fields = {};
  for (const f of requiredFields) {
    const value = findFieldValue(items, f, requiredFields);
    const valid = value !== null && (!f.pattern || new RegExp(f.pattern).test(value));
    fields[f.id] = { value, found: value !== null, valid };
  }
  return fields;
}

// Searches the WHOLE document (every page, every item, no region) for a
// field's label and the value beside it, returning the value, its on-page
// box, and the page it was found on. Used to point an error annotation at
// the offending value even though matching itself no longer depends on the
// title block's position.
export function findLabeledFieldOnPages(pages, field, requiredFields) {
  for (const p of pages) {
    const items = [...p.items].sort((a, b) => a.y - b.y || a.x - b.x);
    const found = findLabeledField(items, field, requiredFields);
    if (found) return { value: found.value, box: found.box, page: p.pageNumber };
  }
  return null;
}

// Groups items into visual lines (same y, within a small tolerance),
// left-to-right, so a value a PDF export has split into several text items
// can be reconstructed.
function groupLines(items, tolerance = 2) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last[last.length - 1].y) <= tolerance) last.push(it);
    else lines.push([it]);
  }
  return lines;
}

function lineBox(line) {
  const x = Math.min(...line.map((i) => i.x));
  const right = Math.max(...line.map((i) => i.x + (i.width || 0)));
  const y = Math.min(...line.map((i) => i.y));
  const h = Math.max(...line.map((i) => i.height || 0));
  return { x, y, w: right - x, h };
}

// Single-character escapes that stand for a CLASS of characters, not a
// literal - so they break a run of literal text when extracting a stem.
const CLASS_ESCAPES = new Set(['d', 'D', 'w', 'W', 's', 'S', 'b', 'B', 'n', 't', 'r', 'f', 'v', '0']);

// Pulls the longest run of fixed literal text out of a regex pattern, e.g.
// "^J2501\-JPD\-EBH\-DG\-\d{5}$" -> "J2501-JPD-EBH-DG-". Used to locate a
// "near miss" on the page (text that begins like the expected value but
// doesn't fully satisfy the rule) so a failing pattern rule can still point
// its annotation at the right place. Returns '' when the pattern has no
// usable literal run (e.g. "^[A-Z]{2}-\d{3}$").
export function longestLiteralStem(pattern) {
  let best = '';
  let cur = '';
  const flush = () => {
    if (cur.length > best.length) best = cur;
    cur = '';
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      i += 1;
      if (next === undefined) break;
      if (CLASS_ESCAPES.has(next)) flush();
      else cur += next;
      continue;
    }
    if (ch === '[') {
      flush();
      i += 1;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '{') {
      flush();
      while (i < pattern.length && pattern[i] !== '}') i += 1;
      continue;
    }
    if ('^$.*+?()|]}'.includes(ch)) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return best;
}

// Turns a whole-value-match pattern (e.g. "^J2501\-...\d{5}$") into a regex
// that finds the same value ANYWHERE inside a longer string - so a drawing
// number embedded next to its label in one text item (e.g.
// "DWG NO: J2501-...-20103") still matches. The ^ / $ anchors are replaced
// with non-alphanumeric boundary guards so that "exactly N digits/letters"
// is still enforced: e.g. "...DG-\d{5}" won't accept a 6-digit number, and
// the literal prefix won't match in the middle of a longer token.
function toContainsRegex(pattern, flags = 'g') {
  let body = pattern;
  let guardStart = false;
  let guardEnd = false;
  if (body.startsWith('^')) {
    body = body.slice(1);
    guardStart = true;
  }
  if (body.endsWith('$') && !body.endsWith('\\$')) {
    body = body.slice(0, -1);
    guardEnd = true;
  }
  const pre = guardStart ? '(?<![A-Za-z0-9])' : '';
  const post = guardEnd ? '(?![A-Za-z0-9])' : '';
  return new RegExp(pre + body + post, flags);
}

// Finds every place on a page where some text satisfies `pattern`, whether
// that text is its own item, embedded with other text in one item, or split
// across adjacent items on the same line. Each result carries the matched
// text and the on-page box to anchor an annotation to.
export function findPatternMatches(page, pattern) {
  const re = toContainsRegex(pattern);
  const items = page.items.filter((it) => it.text && it.text.trim().length > 0);
  const results = [];
  const seen = new Set();

  const collect = (text, box) => {
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue; // ignore zero-length matches (e.g. from ".*")
      const key = `${m[0]}@${box ? `${box.x},${box.y}` : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ text: m[0], box });
    }
  };

  for (const it of items) collect(it.text, itemBox(it));
  for (const line of groupLines(items)) {
    if (line.length < 2) continue;
    collect(line.map((i) => i.text).join(''), lineBox(line));
    collect(line.map((i) => i.text.trim()).join(' '), lineBox(line));
  }
  return results;
}

// Convenience wrapper: the matched text of the first place on the page that
// satisfies `pattern`, or null if nothing does.
export function scanPageForPattern(page, pattern) {
  const matches = findPatternMatches(page, pattern);
  return matches.length ? matches[0].text : null;
}

// Locates the first item on any page whose text contains `stem` (a plain
// substring, e.g. a drawing-number prefix), returning the item's text, box,
// and page - used to point a failing rule's annotation at a near miss.
export function findStemOnPages(pages, stem) {
  for (const p of pages) {
    for (const it of p.items) {
      if (it.text && it.text.includes(stem)) {
        return { text: it.text.trim(), box: itemBox(it), page: p.pageNumber };
      }
    }
  }
  return null;
}
