// Line-preserving parser/patcher for HY-8 .hy8 project files.
//
// Files are CRLF-delimited text with no trailing line ending. Keyword lines
// start at column 0 (`KEYWORD` + padding + value); continuation lines (e.g.
// TWRATINGCURVE rows 2..N) start with whitespace and carry no keyword. This
// module never rewrites a line's keyword/padding — it only substitutes the
// numeric/quoted tokens inside a line via regex, so untouched lines and the
// untouched portions of edited lines stay byte-identical to the source.

const FLOAT_RE = /-?\d+\.\d+/g;
const INT_RE = /-?\d+/g;
const QUOTED_RE = /"([^"]*)"/;

function firstToken(line) {
  const m = /^(\S+)/.exec(line);
  return m ? m[1] : null;
}

function extractQuoted(line) {
  const m = QUOTED_RE.exec(line);
  return m ? m[1] : null;
}

function extractFloats(line) {
  const m = line.match(FLOAT_RE);
  return m ? m.map(Number) : [];
}

function extractFirstInt(line) {
  // Value portion only: strip the leading keyword token first so digits
  // inside the keyword itself (there are none in this format, but be safe)
  // never get matched.
  const rest = line.slice((firstToken(line) || '').length);
  const m = rest.match(INT_RE);
  return m ? Number(m[0]) : null;
}

function parseCrossing(lines, startIdx) {
  const name = extractQuoted(lines[startIdx]);
  let endLine = -1;
  let dischargeRangeLine = -1;
  let dischargeXYDesignLine = -1;
  let dischargeXYDesignCount = 0;
  const dischargeXYDesignYLines = [];
  let tailwaterTypeLine = -1;
  let channelGeometryLine = -1;
  let numRatingCurveLine = -1;
  let numRatingCurveValue = 0;
  let twRatingCurveLines = [];
  let roadwayShapeLine = -1;
  let roadWidthLine = -1;
  let surfaceLine = -1;
  let roadwaySecDataLine = -1;
  const roadwayPointLines = [];
  let culvertStartLine = -1;
  let culvertEndLine = -1;
  let culvertName = null;
  let invertDataLine = -1;
  let barrelDataLine = -1;
  let numberOfBarrelsLine = -1;
  let culvertShape = null;
  // HY-8's computed results: FLOW/ELEVATION/VELOCITY triplets inside the
  // indented RATINGCURVE sub-block. Read-only — this tool never writes them.
  const ratingCurve = [];
  let pendingRating = null;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const tok = firstToken(lines[i]);
    if (tok === 'ENDCROSSING') {
      endLine = i;
      break;
    }
    if (tok === 'DISCHARGERANGE' && dischargeRangeLine === -1) dischargeRangeLine = i;
    if (tok === 'DISCHARGEXYDESIGN' && dischargeXYDesignLine === -1) {
      dischargeXYDesignLine = i;
      dischargeXYDesignCount = extractFirstInt(lines[i]) ?? 0;
    }
    if (tok === 'DISCHARGEXYDESIGN_Y') dischargeXYDesignYLines.push(i);
    if (tok === 'TAILWATERTYPE' && tailwaterTypeLine === -1) tailwaterTypeLine = i;
    if (tok === 'CHANNELGEOMETRY' && channelGeometryLine === -1) channelGeometryLine = i;
    if (tok === 'NUMRATINGCURVE' && numRatingCurveLine === -1) {
      numRatingCurveLine = i;
      numRatingCurveValue = extractFirstInt(lines[i]) ?? 0;
    }
    if (tok === 'TWRATINGCURVE' && twRatingCurveLines.length === 0) {
      for (let r = 0; r < numRatingCurveValue; r++) twRatingCurveLines.push(i + r);
    }
    // The RATINGCURVE sub-block lines are tab-indented, so `tok` is null for
    // them; match their keywords with the indentation stripped instead.
    const indentedTok = tok === null ? firstToken(lines[i].trimStart()) : null;
    if (indentedTok === 'FLOW') pendingRating = { flowLine: i, elevationLine: -1, velocityLine: -1 };
    if (indentedTok === 'ELEVATION' && pendingRating) pendingRating.elevationLine = i;
    if (indentedTok === 'VELOCITY' && pendingRating) {
      pendingRating.velocityLine = i;
      ratingCurve.push(pendingRating);
      pendingRating = null;
    }
    if (tok === 'ROADWAYSHAPE' && roadwayShapeLine === -1) roadwayShapeLine = i;
    if (tok === 'ROADWIDTH' && roadWidthLine === -1) roadWidthLine = i;
    if (tok === 'SURFACE' && surfaceLine === -1) surfaceLine = i;
    if (tok === 'ROADWAYSECDATA' && roadwaySecDataLine === -1) roadwaySecDataLine = i;
    if (tok === 'ROADWAYPOINT') roadwayPointLines.push(i);
    if (tok === 'STARTCULVERT' && culvertStartLine === -1) {
      culvertStartLine = i;
      culvertName = extractQuoted(lines[i]);
    }
    if (tok === 'ENDCULVERT' && culvertEndLine === -1) culvertEndLine = i;
    if (tok === 'CULVERTSHAPE' && culvertShape === null) culvertShape = extractFirstInt(lines[i]);
    if (tok === 'INVERTDATA' && invertDataLine === -1) invertDataLine = i;
    if (tok === 'BARRELDATA' && barrelDataLine === -1) barrelDataLine = i;
    if (tok === 'NUMBEROFBARRELS' && numberOfBarrelsLine === -1) numberOfBarrelsLine = i;
  }

  return {
    name,
    startLine: startIdx,
    endLine,
    dischargeRangeLine,
    dischargeXYDesignLine,
    dischargeXYDesignCount,
    dischargeXYDesignYLines,
    tailwaterTypeLine,
    channelGeometryLine,
    numRatingCurveLine,
    numRatingCurveValue,
    twRatingCurveLines,
    roadwayShapeLine,
    roadWidthLine,
    surfaceLine,
    roadwaySecDataLine,
    roadwayPointLines,
    ratingCurve,
    culverts: [
      {
        name: culvertName,
        startLine: culvertStartLine,
        endLine: culvertEndLine,
        invertDataLine,
        barrelDataLine,
        numberOfBarrelsLine,
        culvertShape,
      },
    ],
  };
}

export function parseHy8(text) {
  const lines = text.split('\r\n');
  const crossings = [];
  let i = 0;
  while (i < lines.length) {
    if (firstToken(lines[i]) === 'STARTCROSSING') {
      const crossing = parseCrossing(lines, i);
      crossings.push(crossing);
      i = crossing.endLine > i ? crossing.endLine + 1 : i + 1;
    } else {
      i++;
    }
  }
  return { lines, crossings };
}

// -- Read helpers: always read the *current* doc.lines, never a cached
// value, so callers stay correct across successive patchValues() calls.

export function readFloats(doc, lineIndex) {
  return extractFloats(doc.lines[lineIndex]);
}

export function readInt(doc, lineIndex) {
  return extractFirstInt(doc.lines[lineIndex]);
}

export function readQuoted(doc, lineIndex) {
  return extractQuoted(doc.lines[lineIndex]);
}

function formatFloat(x) {
  return x.toFixed(6);
}

function replaceFloatsInLine(line, values) {
  let n = -1;
  return line.replace(FLOAT_RE, (match) => {
    n++;
    return n < values.length ? formatFloat(values[n]) : match;
  });
}

function replaceIntsInLine(line, values) {
  const keyword = firstToken(line) || '';
  const rest = line.slice(keyword.length);
  let n = -1;
  const newRest = rest.replace(INT_RE, (match) => {
    n++;
    return n < values.length ? String(values[n]) : match;
  });
  return keyword + newRest;
}

function replaceQuotedInLine(line, value) {
  return line.replace(QUOTED_RE, `"${value}"`);
}

// edits: array of { lineIndex, floats? } | { lineIndex, ints? } | { lineIndex, quoted? }
export function patchValues(doc, edits) {
  const lines = doc.lines.slice();
  for (const edit of edits) {
    const line = lines[edit.lineIndex];
    if (edit.quoted !== undefined) {
      lines[edit.lineIndex] = replaceQuotedInLine(line, edit.quoted);
    } else if (edit.floats !== undefined) {
      lines[edit.lineIndex] = replaceFloatsInLine(line, edit.floats);
    } else if (edit.ints !== undefined) {
      lines[edit.lineIndex] = replaceIntsInLine(line, edit.ints);
    }
  }
  return { ...doc, lines };
}

export function serializeHy8(doc) {
  return doc.lines.join('\r\n');
}
