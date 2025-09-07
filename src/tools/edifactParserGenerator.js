import { z } from 'zod';
import { tool } from '@langchain/core/tools';

// This tool asks the LLM to synthesize a parsing plan or code fragments given a spec and goals.
// It returns a JS module string that exports parseEdifactToJson(text) and explain(fieldsJson).
export function createEdifactParserGenerator(llm) {
  return tool(
    async ({ format, spec, sample }) => {
      // Optional deterministic baseline parser (bypasses LLM) for reliability
      if (process.env.BASELINE_PARSER === 'true') {
  const moduleCode = `// Baseline EDIFACT parser for ${format} with correct UNA handling
// Minimal, robust, self-contained ESM module

function detectDelimiters(text) {
  // Defaults per EDIFACT
  let componentSep = ':';
  let dataSep = '+';
  let releaseChar = '?';
  let segTerm = '\'';
  if (text.startsWith('UNA')) {
    // UNA + 6 chars: component, data, decimal, release, reserved, terminator
    const six = text.slice(3, 9);
    if (six.length === 6) {
      componentSep = six[0];
      dataSep = six[1];
      // six[2] is decimal mark, ignored here
      releaseChar = six[3];
      segTerm = six[5];
    }
  }
  return { componentSep, dataSep, releaseChar, segTerm };
}

function splitSegments(text, segTerm, releaseChar) {
  const segments = [];
  let cur = '';
  let released = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (released) {
      cur += ch; // take literal after release
      released = false;
      continue;
    }
    if (ch === releaseChar) { released = true; continue; }
    if (ch === segTerm) {
      const trimmed = cur.trim();
      if (trimmed) segments.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments;
}

function splitElements(str, sep, releaseChar) {
  const out = [];
  let cur = '';
  let released = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (released) { cur += ch; released = false; continue; }
    if (ch === releaseChar) { released = true; continue; }
    if (ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export async function parseEdifactToJson(edifactText) {
  if (!edifactText || typeof edifactText !== 'string') throw new Error('EMPTY_INPUT');
  const { componentSep, dataSep, releaseChar, segTerm } = detectDelimiters(edifactText);
  const segmentsRaw = splitSegments(edifactText, segTerm, releaseChar)
    .map(s => s.replace(/\r?\n/g, '').trim())
    .filter(Boolean);
  const segments = [];
  let pos = 0;
  for (const raw of segmentsRaw) {
    const tag = raw.slice(0, 3).toUpperCase();
    const rest = raw.slice(3);
    const elems = rest.startsWith(dataSep) ? rest.slice(1) : rest;
    const data = splitElements(elems, dataSep, releaseChar).map(e => splitElements(e, componentSep, releaseChar));
    segments.push({ tag, position: ++pos, elements: data });
  }
  // Simple structure and minimal validations for ${format}
  const json = { delimiters: { componentSep, dataSep, releaseChar, segTerm }, segments };
  const errors = [];
  const firstUNH = segments.find(s => s.tag === 'UNH');
  const lastUNT = segments.findLast ? segments.findLast(s => s.tag === 'UNT') : [...segments].reverse().find(s => s.tag === 'UNT');
  const lastUNZ = segments.findLast ? segments.findLast(s => s.tag === 'UNZ') : [...segments].reverse().find(s => s.tag === 'UNZ');
  if (firstUNH) {
    const type = (firstUNH.elements[2] || [])[0];
    if (type && type.toUpperCase() !== '${format}') {
      errors.push({ code: 'FIELD_VALUE_MISMATCH', message: 'Message type must be ${format}', segmentTag: 'UNH', position: firstUNH.position, field: 'S009.01', value: type });
    }
  }
  if (lastUNT) {
    const cnt = parseInt((lastUNT.elements[1] || [])[0] || '', 10);
    if (!Number.isFinite(cnt)) {
      errors.push({ code: 'UNT_SEGMENT_COUNT_MISSING', message: 'UNT segment count missing or invalid', segmentTag: 'UNT', position: lastUNT.position });
    }
  }
  return { json, errors };
}

export async function explain(parsed) {
  // Build per-field, human-readable descriptions using synthesized spec mapping
  const specMapping = ${JSON.stringify(spec?.synthesized || {}, null, 2)};
  const defaultMapping = {
    UNH: {
      segmentDescription: 'Message header',
      fields: [
        { path: 'UNH/01/01', name: 'Message reference number (0062)', description: 'Unique message reference assigned by the sender' },
        { path: 'UNH/02/01', name: 'Message type (0065)', description: 'Identifies the message type, e.g., APERAK' },
        { path: 'UNH/02/02', name: 'Version (0052)', description: 'Message version number' },
        { path: 'UNH/02/03', name: 'Release (0054)', description: 'Message release number' },
        { path: 'UNH/02/04', name: 'Controlling agency (0051)', description: 'Agency controlling the message, e.g., UN' },
        { path: 'UNH/02/05', name: 'Association assigned code (0057)', description: 'Code assigned by associations' }
      ]
    },
    BGM: {
      segmentDescription: 'Beginning of message',
      fields: [
        { path: 'BGM/01/01', name: 'Document/message name, coded (1001)', description: 'Code identifying the document/message name' },
        { path: 'BGM/02/01', name: 'Document/message number (1004)', description: 'Identifier for the document/message' },
        { path: 'BGM/03/01', name: 'Message function, coded (1225)', description: 'Code indicating the function of the message' }
      ]
    },
    DTM: {
      segmentDescription: 'Date/time/period',
      fields: [
        { path: 'DTM/01/01', name: 'Date/time/period qualifier (2005)', description: 'Qualifier specifying the type of date/time (e.g., 137=Document date/time, 171=Reference date/time)' },
        { path: 'DTM/01/02', name: 'Date/time/period (2380)', description: 'Date/time value formatted per 2379' },
        { path: 'DTM/01/03', name: 'Date/time/period format qualifier (2379)', description: 'Format qualifier for 2380 (e.g., 203=CCYYMMDDHHMM, 303=YYMMDDHHMM)' }
      ]
    },
    RFF: {
      segmentDescription: 'Reference',
      fields: [
        { path: 'RFF/01/01', name: 'Reference qualifier (1153)', description: 'Specifies the type of reference (e.g., ON=Order, TN=Transaction, ACE=Account/Reference)' },
        { path: 'RFF/01/02', name: 'Reference number (1154)', description: 'Reference identifier value' },
        { path: 'RFF/01/03', name: 'Line number (1156)', description: 'Related line number, if applicable' },
        { path: 'RFF/01/04', name: 'Reference version identifier (4000)', description: 'Free-form reference description or version' }
      ]
    },
    NAD: {
      segmentDescription: 'Name and address',
      fields: [
        { path: 'NAD/01/01', name: 'Party function code qualifier (3035)', description: 'Identifies the role of the party (e.g., MS=Message sender, MR=Message recipient)' },
        { path: 'NAD/02/01', name: 'Party id (3039)', description: 'Identifier of party' },
        { path: 'NAD/02/02', name: 'Code list qualifier (1131)', description: 'Code list reference, if any' },
        { path: 'NAD/02/03', name: 'Code list agency (3055)', description: 'Agency controlling the code list (e.g., 293)' }
      ]
    },
    UNB: {
      segmentDescription: 'Interchange header',
      fields: [
        { path: 'UNB/01/01', name: 'Syntax identifier (0001)', description: 'EDIFACT syntax identifier, e.g., UNOC' },
        { path: 'UNB/01/02', name: 'Syntax version number (0002)', description: 'Version of the syntax, e.g., 3' },
        { path: 'UNB/02/01', name: 'Sender identification (0004)', description: 'Interchange sender ID' },
        { path: 'UNB/02/02', name: 'Partner identification code qualifier (0007)', description: 'Qualifier for sender ID' },
        { path: 'UNB/03/01', name: 'Recipient identification (0010)', description: 'Interchange recipient ID' },
        { path: 'UNB/03/02', name: 'Partner identification code qualifier (0007)', description: 'Qualifier for recipient ID' },
        { path: 'UNB/04/01', name: 'Date (0017)', description: 'Date of preparation (YYMMDD or CCYYMMDD depending on use)' },
        { path: 'UNB/04/02', name: 'Time (0019)', description: 'Time of preparation (HHMM)' },
        { path: 'UNB/05/01', name: 'Interchange control reference (0020)', description: 'Interchange control reference' }
      ]
    },
    UNT: {
      segmentDescription: 'Message trailer',
      fields: [
        { path: 'UNT/01/01', name: 'Number of segments in a message (0074)', description: 'Segment count including UNH and UNT' },
        { path: 'UNT/02/01', name: 'Message reference number (0062)', description: 'Must match UNH reference number' }
      ]
    },
    UNZ: {
      segmentDescription: 'Interchange trailer',
      fields: [
        { path: 'UNZ/01/01', name: 'Interchange control count (0036)', description: 'Number of messages or functional groups' },
        { path: 'UNZ/02/01', name: 'Interchange control reference (0020)', description: 'Must match UNB control reference' }
      ]
    }
  };
  const mapping = (specMapping && Object.keys(specMapping).length) ? specMapping : defaultMapping;
  const out = { ...parsed };
  const segs = parsed?.json?.segments || [];
  const pad2 = (n) => String(n+1).padStart(2, '0');
  const getFieldMeta = (tag, i, j) => {
    const m = mapping?.[tag];
    if (!m || !Array.isArray(m.fields)) return null;
    const candidates = [];
    const p1 = tag + '/' + pad2(i);
    const p2 = tag + '/' + pad2(i) + '/' + pad2(j);
    for (const f of m.fields) {
      if (!f.path) continue;
      if (f.path === p2 || f.path === (tag + '/' + (i+1) + '/' + (j+1))) candidates.push(f);
      else if (j == null && (f.path === p1 || f.path === (tag + '/' + (i+1)))) candidates.push(f);
    }
    return candidates[0] || null;
  };
  const qualifiers = {
    DTM: {
      '137': 'Document/message date/time',
      '171': 'Reference date/time',
      '163': 'Delivery date/time, latest',
    },
    RFF: {
      // Common reference qualifiers (examples; override via spec codes if available)
      'ON': 'Order number',
      'DQ': 'Delivery note number',
      'ACE': 'Reference (ACE)',
      'TN': 'Transaction/reference number',
      'AGO': 'Agreement/order reference',
    }
  };
  const explainSegment = (s) => {
  const m = mapping?.[s.tag];
  const segDesc = m?.segmentDescription || m?.notes || ('Segment ' + s.tag);
    const fields = [];
    for (let i = 0; i < (s.elements?.length || 0); i++) {
      const comps = s.elements[i] || [];
      if (!Array.isArray(comps)) continue;
      if (!comps.length) continue;
      // If composite has subcomponents
      if (Array.isArray(comps)) {
        for (let j = 0; j < comps.length; j++) {
          const val = comps[j];
          const meta = getFieldMeta(s.tag, i, j);
          let name = meta?.name || ('Component ' + (i+1) + '.' + (j+1));
          let description = meta?.description || '';
          // Qualifier hints
          if (s.tag === 'DTM' && j === 0) {
            const q = String(val || '').trim();
            const qDesc = qualifiers.DTM[q] || meta?.codes?.find?.(c => c.code === q)?.meaning;
            if (qDesc) description = description ? (description + ' (qualifier ' + q + ': ' + qDesc + ')') : ('Qualifier ' + q + ': ' + qDesc);
          }
          if (s.tag === 'RFF' && j === 0) {
            const q = String(val || '').trim();
            const qDesc = qualifiers.RFF[q] || meta?.codes?.find?.(c => c.code === q)?.meaning;
            if (qDesc) description = description ? (description + ' (qualifier ' + q + ': ' + qDesc + ')') : ('Qualifier ' + q + ': ' + qDesc);
          }
          fields.push({ path: (s.tag + '/' + pad2(i) + '/' + pad2(j)), name, description: description || null, value: val });
        }
      }
    }
    return { segment: s.tag, position: s.position, description: segDesc, fields };
  };
  out.explanations = { segments: segs.map(explainSegment) };
  return out;
}
`;
        return { moduleCode };
      }
      const mock = process.env.MOCK_LLM === 'true' || (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_AI_API_KEY);
      if (mock) {
        const moduleCode = `// Auto-generated mock parser for ${format}
export async function parseEdifactToJson(edifactText) {
  if (!edifactText || typeof edifactText !== 'string') throw new Error('EMPTY_INPUT');
  // Extract likely EDIFACT lines (skip markdown, keep lines starting with TAG+)
  const lines = edifactText.split(/\r?\n/).map(l => l.trim()).filter(l => /^[A-Z]{3}[+']/i.test(l));
  if (!lines.length) throw new Error('NO_SEGMENTS_FOUND');
  const segments = [];
  for (const line of lines) {
    const cleaned = line.replace(/[']+$/,'');
    const tag = cleaned.slice(0,3).toUpperCase();
    const rest = cleaned.slice(3);
    const comps = rest.startsWith('+') ? rest.slice(1).split('+') : rest.split('+');
    const components = comps.map(c => c.split(':'));
    segments.push({ tag, components });
  }
  // Basic validation: first segment should be UNH for most EDIFACT docs
  if (segments[0]?.tag !== 'UNH') {
    const err = new Error('FIRST_SEGMENT_NOT_UNH');
    err.code = 'INVALID_START';
    err.segmentTag = segments[0]?.tag || null;
    err.position = 0;
    throw err;
  }
  return { format: '${format}', segments };
}

export async function explain(parsed) {
  const out = { ...parsed };
  const mapping = ((${JSON.stringify(spec?.synthesized || {})}) || {});
  out.explanations = [];
  for (const s of parsed.segments) {
    const segMap = mapping[s.tag];
    out.explanations.push({ segment: s.tag, description: segMap ? (segMap.notes || 'Synthesized mapping available') : 'No mapping available' });
  }
  return out;
}
`;
        return { moduleCode };
      }
  const prompt = `You are a senior EDI/EDIFACT engineer. Given an EDIFACT message format ${format} and a specification payload, generate a robust JavaScript module that can parse EDIFACT text into structured JSON and provide human-readable explanations for each field using the spec mapping and segment docs from Qdrant. Requirements:
- Export two named async functions: parseEdifactToJson(edifactText) and explain(parsedJson).
- No external EDIFACT libraries; implement a minimal, reliable parser for segments (lines separated by \n or \r), segment tag (e.g., UNH, BGM, NAD), and composites/components separated by + and : with escape ? rules (keep simple: treat ? as escape for next char, and handle ++ -> empty component).
- Use the provided spec to map segment positions and component meanings, and include per-field human-readable name and description. If a field mapping is missing, synthesize a reasonable label like "DTM C507.2005 (qualifier)".
- Validate presence of required segments per spec when possible. Return structured errors with { code, message, segmentTag, position }.
- The explain(parsedJson) must traverse each segment and each component, and emit an array like { segment, position, fields: [ { path: "SEG/01/02", name, description, value } ] }. For DTM and RFF, interpret common qualifiers (e.g., DTM 137, 171; RFF ON, TN, ACE) using any codes in the spec; if missing, add a generic explanatory note.
- Include a small set of format-specific validations (e.g., BGM doc type, DTM date format, RFF references).
- Avoid network calls and keep the module self-contained.
- The module must be valid ESM.

SPEC (JSON):\n${JSON.stringify(spec).slice(0, 30000)}\n--- END SPEC
OPTIONAL SAMPLE (first 2KB):\n${(sample || '').slice(0, 2000)}\n`;
  const res = await llm.invoke(prompt);
      let text = '';
      if (typeof res === 'string') text = res;
      else if (res?.content) {
        if (Array.isArray(res.content)) {
          const first = res.content.find(c => typeof c?.text === 'string');
          text = first?.text || '';
        } else if (typeof res.content === 'string') {
          text = res.content;
        }
      }
      return { moduleCode: typeof text === 'string' ? text : JSON.stringify(text) };
    },
    {
      name: 'generate_edifact_parser_module',
      description: 'Generate a JS parser module for a given EDIFACT format using the spec. Returns source code string.',
      schema: z.object({
        format: z.string(),
        spec: z.any(),
        sample: z.string().optional(),
      })
    }
  );
}
