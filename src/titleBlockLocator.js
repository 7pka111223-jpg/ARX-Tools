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

function findFieldValue(items, field, requiredFields) {
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
      return nextTrimmed.length > 0 ? nextTrimmed.split(/\s+/)[0] : null;
    }

    const sameMatch = text.match(sameRe);
    if (sameMatch) {
      return sameMatch[1];
    }
  }

  return null;
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
