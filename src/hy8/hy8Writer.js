// Generates a complete HY-8 .hy8 project file from scratch, one crossing
// (with a single culvert) per culvert row. The output mirrors what HY-8
// itself writes — CRLF line endings, keyword padded to column 22, floats to
// six decimals, US customary storage units, no trailing newline after
// ENDPROJECTFILE — with the constant lines copied verbatim from a real
// HY-8-written project. Every crossing gets a box culvert (square-edge
// headwall inlet, concrete n = 0.015), a constant tailwater at the outlet
// invert, and the standard roadway from roadway.js.

import { mToFt, cmsToCfs } from './units.js';
import { regenerateDesignY } from './flowUpdater.js';
import {
  crestElevationM,
  ROADWAY_CREST_LENGTH_M,
  ROADWAY_TOP_WIDTH_M,
  ROADWAY_SHAPE_CONSTANT,
  ROADWAY_SURFACE_PAVED,
} from './roadway.js';

const DESIGN_FLOW_POINTS = 11;
const HEADROOM_CMS = 5; // max flow = design + 5 m3/s, as on import
const MANNING_N = 0.015;

// KEYWORD padded so the value starts at column 22 (one space separator when
// the keyword itself is 21+ characters, as HY-8 does).
function kw(keyword) {
  return keyword.length >= 21 ? `${keyword} ` : keyword.padEnd(21);
}

// HY-8 pads each float to 10 characters plus a separating space.
function fnum(x) {
  return `${x.toFixed(6).padEnd(10)} `;
}

function floatsLine(keyword, values) {
  return kw(keyword) + values.map(fnum).join('');
}

function defaultGuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// HY-8 stores the project date as an Excel serial day number.
function excelSerialNow(now) {
  return now / 86400000 + 25569;
}

const RECURRENCE_NAMES = ['1 year', '2 year', '5 year', '10 year', '25 year', '50 year', '100 year', '200 year', '500 year'];

function crossingLines(culvert, makeGuid) {
  const name = culvert.name;
  const usilFt = mToFt(culvert.usilM);
  const dsilFt = mToFt(culvert.dsilM);
  const lengthFt = mToFt(culvert.lengthM);
  const spanFt = mToFt(culvert.widthM);
  const riseFt = mToFt(culvert.riseM);
  const crestFt = mToFt(crestElevationM(culvert.usilM, culvert.riseM));

  const designCfs = cmsToCfs(culvert.flowCms);
  const maxCfs = cmsToCfs(culvert.flowCms + HEADROOM_CMS);
  const flowPoints = regenerateDesignY(maxCfs, designCfs, DESIGN_FLOW_POINTS);

  const lines = [];
  const push = (line) => lines.push(line);

  push(`${kw('STARTCROSSING')}"${name}"`);
  push(`${kw('STARTCROSSNOTES')}""`);
  push(floatsLine('DISCHARGERANGE', [0, designCfs, maxCfs]));
  push(`${kw('DISCHARGEMETHOD')}0`);
  push(`${kw('DISCHARGEXYDESIGN')}${DESIGN_FLOW_POINTS}`);
  for (const y of flowPoints) {
    push(floatsLine('DISCHARGEXYDESIGN_Y', [y]));
    push(`${kw('DISCHARGEXYDESIGN_NAME')}""`);
  }
  push(`${kw('DISCHARGEXYUSER')}2`);
  for (let i = 0; i < 2; i++) {
    push(floatsLine('DISCHARGEXYUSER_Y', [0]));
    push(`${kw('DISCHARGEXYUSER_NAME')}""`);
  }
  push(`${kw('DISCHARGEXYRECURRENCE')}${RECURRENCE_NAMES.length}`);
  for (const recurrence of RECURRENCE_NAMES) {
    push(floatsLine('DISCHARGEXYRECURRENCE_Y', [0]));
    push(`${kw('DISCHARGEXYRECURRENCE_NAME')}"${recurrence}"`);
  }

  // Constant tailwater at the outlet invert (zero tailwater depth).
  push(`${kw('TAILWATERTYPE')}6`);
  push(floatsLine('CHANNELGEOMETRY', [0, 0, 0, 0, dsilFt]));
  push(`${kw('NUMRATINGCURVE')}12`);
  push(floatsLine('TWRATINGCURVE', [dsilFt, 0, 0, 0]));
  for (let i = 1; i < 12; i++) push(' '.repeat(21) + [dsilFt, 0, 0, 0].map(fnum).join(''));

  // Placeholder rating-curve results — HY-8 fills these in when it analyzes.
  push('\t\tRATINGCURVE');
  push(`\t\tNUMPOINTS ${DESIGN_FLOW_POINTS}`);
  for (const y of flowPoints) {
    push(`\t\tFLOW ${y.toFixed(6)}`);
    push('\t\tELEVATION 0.000000');
    push('\t\tVELOCITY 0.000000');
  }
  push('\t\tEND RATINGCURVE');

  // Standard roadway (roadway.js): constant elevation profile, paved,
  // crest at USIL + rise + 2 m of cover, crest length 20 m, top width 8 m.
  push(`${kw('ROADWAYSHAPE')}${ROADWAY_SHAPE_CONSTANT}`);
  push(floatsLine('ROADWIDTH', [mToFt(ROADWAY_TOP_WIDTH_M)]));
  push(floatsLine('WEIRCOEFF', [0]));
  push(`${kw('SURFACE')}${ROADWAY_SURFACE_PAVED}`);
  push(`${kw('NUMSTATIONS')}2`);
  push(floatsLine('ROADWAYSECDATA', [0, crestFt]));
  push(floatsLine('ROADWAYPOINT', [mToFt(ROADWAY_CREST_LENGTH_M), crestFt]));

  push(`${kw('NUMCULVERTS')}1`);
  push(`${kw('STARTCULVERT')}"${name}"`);
  push(`${kw('CULVERTSHAPE')}2`); // box
  push(`${kw('CULVERTMATERIAL')}1`); // concrete
  push(`${kw('LOWERCULVERTMATERIAL')}1`);
  push(`${kw('LOWERCULVMATSTR')}""`);
  push(`${kw('BROKENCULVERT')}0`);
  push(`${kw('INLETTYPE')}1`);
  push(`${kw('INLETEDGETYPE')}1`); // square edge with headwall
  push(`${kw('INLETEDGETYPE71')}0`);
  push(`${kw('IMPINLETEDGETYPE')}1`);
  push(floatsLine('IMPROVEDINDATA', [0, 0, 0, 0, 0, 0]));
  push(floatsLine('BARRELDATA', [spanFt, riseFt, MANNING_N, MANNING_N]));
  push(floatsLine('LOWERCULVERTMANNING', [0]));
  push(floatsLine('LOWERCULVERTMANNINGB', [0]));
  push(`${kw('IRREGSIZE')}0 0 0`);
  push(floatsLine('EMBEDDEPTH', [0]));
  push(floatsLine('BARRELGEOMETRY', [0, 0, 0, 0, 0]));
  push(floatsLine('DEPRESSIONDATA', [0, 0, 0]));
  push(floatsLine('TAPEREDDATA', [0, 0, 0, 0, 0]));
  push(`${kw('DEPRESSION')}0`);
  push(`${kw('MITERED')}0`);
  push(`${kw('EMBANKMENTTYPE')}2`);
  push(`${kw('NUMBEROFBARRELS')}${culvert.cells}`);
  push(floatsLine('EMBANKDATA', [0, 0, 0, 0, 0, 0]));
  push(floatsLine('INVERTDATA', [0, usilFt, lengthFt, dsilFt]));
  push(floatsLine('BREAK', [0, 0]));
  push(floatsLine('UPPERBREAK', [0, 0]));
  push(floatsLine('LOWERBREAK', [0, 0]));
  push(`${kw('NUMSHAPECOORDS')}0`);
  push(`${kw('EMBEDEDGEOMETRY')}0`);
  push('ENDEMBEDGEOMETRY    ');
  push(`${kw('STARTCULVNOTES')}""`);
  push('ENDCULVNOTES');
  push(floatsLine('ROADCULVSTATION', [0]));
  push(floatsLine('BARRELSPACING', [0]));
  // Energy-dissipation block: HY-8's defaults, copied verbatim.
  push(`${kw('STARTENERGYDISSIPATION')}0 0 -1`);
  push(`${kw('STARTSCOUR')}"NONCOHESIVE"`);
  push(`${kw('COHESIVE')}30.000000  0.000000   0.000000   0`);
  push(`${kw('NONCOHESIVE')}30.000000  0.000000   0.000000   0`);
  push(`${kw('STARTINTERNAL')}"USBR9"`);
  push(`${kw('INCRESCIRC')}0 1.100000   0.060000  `);
  push(`${kw('INCRESBOX')}0 0.300000   0.000000  `);
  push(`${kw('TUMFLOWCIRC')}0 0.000000   `);
  push(`${kw('TUMFLOWBOX')}0 0.000000   `);
  push(`${kw('USBR9')}0 0.000000   0 0.000000   0 0.000000   0 0.000000  `);
  push(`${kw('STARTEXTERNAL')}"DSBOX"`);
  push(`${kw('DSBOX')}2.000000   0.000000   0.000000   4.000000   0.000000  `);
  push(`${kw('DSStraight')}0.000000   0.000000  `);
  push(`${kw('SBUSBR3')}0.000000  `);
  push(`${kw('SBUSBR4')}0.000000  `);
  push(`${kw('SBSAF')}1 0.000000  `);
  push(`${kw('SLCSU')}0`);
  push(`${kw('SLRIPRAP')}1 0.000000   0.000000  `);
  push(`${kw('SLCONTRA')}3.500000   0.100000   0.000000   0.000000   0.000000  `);
  push(`${kw('SLHOOK')}0 0 0 5.500000   0.000000   0.750000   0.660000  0.830000  `);
  push('SLUSBR6             ');
  push('ENDENERGYDISS        ');
  push(`${kw('ENDCULVERT')}"${name}"`);
  push(`${kw('CROSSGUID')}${makeGuid()}`);
  push(`${kw('DETENTIONGUID')}00000000-0000-0000-0000-000000000000`);
  push(`${kw('OUTLETGUID')}00000000-0000-0000-0000-000000000000`);
  push(`${kw('ENDCROSSING')}"${name}"`);
  return lines;
}

// culverts: [{ name, flowCms, cells, widthM, riseM, lengthM, usilM, dsilM }]
// Returns the full .hy8 file text (CRLF, no trailing newline).
export function buildHy8Project(culverts, { now = Date.now(), makeGuid = defaultGuid } = {}) {
  const lines = [
    'HY8PROJECTFILE80',
    '',
    `${kw('UNITS')}1`,
    `${kw('WSPOPTION')}2`,
    `${kw('EXITLOSSOPTION')}0`,
    kw('PROJTITLE'),
    kw('PROJDESIGNER'),
    kw('STARTPROJNOTES'),
    'ENDPROJNOTES',
    `${kw('PROJDATE')}${excelSerialNow(now).toFixed(6)}`,
    `${kw('NUMCROSSINGS')}${culverts.length}`,
  ];
  for (const culvert of culverts) lines.push(...crossingLines(culvert, makeGuid));
  lines.push('ENDPROJECTFILE');
  return lines.join('\r\n');
}
