import { escapeRegex } from './util.js';

function computeRegionBox(pageWidth, pageHeight, region) {
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

export function locateFieldsOnPage(page, requiredFields, region) {
  const box = computeRegionBox(page.width, page.height, region);
  const regionText = page.items
    .filter((it) => inBox(it, box))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((it) => it.text)
    .join(' ');

  const fields = {};
  for (const f of requiredFields) {
    const labelRe = new RegExp(`${escapeRegex(f.label)}\\s*[:\\-]?\\s*(\\S+)`, 'i');
    const match = regionText.match(labelRe);
    const value = match ? match[1] : null;
    const valid = value !== null && (!f.pattern || new RegExp(f.pattern).test(value));
    fields[f.id] = { value, found: value !== null, valid };
  }
  return fields;
}
