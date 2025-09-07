import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

function detectDelimsFromText(text) {
  // Defaults
  let componentSep = ':';
  let dataSep = '+';
  let releaseChar = '?';
  let segTerm = "'";
  if (text.startsWith('UNA')) {
    const six = text.slice(3, 9);
    if (six.length === 6) {
      componentSep = six[0];
      dataSep = six[1];
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
    if (released) { cur += ch; released = false; continue; }
    if (ch === releaseChar) { released = true; continue; }
    if (ch === segTerm) { const t = cur.trim(); if (t) segments.push(t); cur = ''; continue; }
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

function baselineParseAndExplain(text, assumedFormat) {
  const { componentSep, dataSep, releaseChar, segTerm } = detectDelimsFromText(text);
  const segsRaw = splitSegments(text, segTerm, releaseChar).map(s => s.replace(/\r?\n/g, '').trim()).filter(Boolean);
  const segments = [];
  let pos = 0;
  for (const raw of segsRaw) {
    const tag = raw.slice(0, 3).toUpperCase();
    const rest = raw.slice(3);
    const elems = rest.startsWith(dataSep) ? rest.slice(1) : rest;
    const data = splitElements(elems, dataSep, releaseChar).map(e => splitElements(e, componentSep, releaseChar));
    segments.push({ tag, position: ++pos, elements: data });
  }
  const json = { delimiters: { componentSep, dataSep, releaseChar, segTerm }, segments };
  const errors = [];
  // Find format from UNH if possible
  const firstUNH = segments.find(s => s.tag === 'UNH');
  let fmt = assumedFormat;
  if (firstUNH) {
    const type = (firstUNH.elements[1] || [])[0]; // Note: in baseline artifacts we had UNH: [ref],[type,ver,rel,...]
    if (type && /^[A-Z]{3,6}$/.test(String(type))) fmt = type.toUpperCase();
  }
  // Minimal default mapping and qualifier hints
  const defaultMap = {
    UNH: { segmentDescription: 'Message header', fields: [
      { path: 'UNH/01/01', name: 'Message reference number (0062)', description: 'Sender-assigned message reference' },
      { path: 'UNH/02/01', name: 'Message type (0065)', description: 'Type, e.g., APERAK' },
      { path: 'UNH/02/02', name: 'Version (0052)', description: 'Message version' },
      { path: 'UNH/02/03', name: 'Release (0054)', description: 'Message release' },
      { path: 'UNH/02/04', name: 'Controlling agency (0051)', description: 'UN or others' },
      { path: 'UNH/02/05', name: 'Association assigned code (0057)', description: 'Association code' },
    ]},
    BGM: { segmentDescription: 'Beginning of message', fields: [
      { path: 'BGM/01/01', name: 'Document/message name, coded (1001)', description: 'Identifies document/message' },
      { path: 'BGM/02/01', name: 'Document/message number (1004)', description: 'Document identifier' },
      { path: 'BGM/03/01', name: 'Message function, coded (1225)', description: 'Function of the message' },
    ]},
    DTM: { segmentDescription: 'Date/time/period', fields: [
      { path: 'DTM/01/01', name: 'Date/time/period qualifier (2005)', description: '137=Doc date/time, 171=Reference date/time' },
      { path: 'DTM/01/02', name: 'Date/time/period (2380)', description: 'Value per 2379' },
      { path: 'DTM/01/03', name: 'Format qualifier (2379)', description: '203=CCYYMMDDHHMM, 303=YYMMDDHHMM' },
    ]},
    RFF: { segmentDescription: 'Reference', fields: [
      { path: 'RFF/01/01', name: 'Reference qualifier (1153)', description: 'ON=Order, TN=Transaction, ACE=Account' },
      { path: 'RFF/01/02', name: 'Reference number (1154)', description: 'Reference identifier' },
      { path: 'RFF/01/03', name: 'Line number (1156)', description: 'Related line number' },
    ]},
    NAD: { segmentDescription: 'Name and address', fields: [
      { path: 'NAD/01/01', name: 'Party function qualifier (3035)', description: 'MS=Sender, MR=Recipient' },
      { path: 'NAD/02/01', name: 'Party id (3039)', description: 'Party identifier' },
      { path: 'NAD/02/02', name: 'Code list qualifier (1131)', description: 'Qualifier for code list' },
      { path: 'NAD/02/03', name: 'Code list agency (3055)', description: 'e.g., 293' },
    ]},
    UNB: { segmentDescription: 'Interchange header', fields: [
      { path: 'UNB/01/01', name: 'Syntax id (0001)', description: 'UNOC etc.' },
      { path: 'UNB/01/02', name: 'Syntax version (0002)', description: 'Version of syntax' },
      { path: 'UNB/02/01', name: 'Sender id (0004)', description: 'Interchange sender' },
      { path: 'UNB/02/02', name: 'Sender qualifier (0007)', description: 'Qualifier' },
      { path: 'UNB/03/01', name: 'Recipient id (0010)', description: 'Interchange recipient' },
      { path: 'UNB/03/02', name: 'Recipient qualifier (0007)', description: 'Qualifier' },
      { path: 'UNB/04/01', name: 'Date (0017)', description: 'YYMMDD/CCYYMMDD' },
      { path: 'UNB/04/02', name: 'Time (0019)', description: 'HHMM' },
      { path: 'UNB/05/01', name: 'Interchange control ref (0020)', description: 'Control reference' },
    ]},
    UNT: { segmentDescription: 'Message trailer', fields: [
      { path: 'UNT/01/01', name: 'Segment count (0074)', description: 'Count incl. UNH and UNT' },
      { path: 'UNT/02/01', name: 'Message ref (0062)', description: 'Must match UNH ref' },
    ]},
    UNZ: { segmentDescription: 'Interchange trailer', fields: [
      { path: 'UNZ/01/01', name: 'Message/group count (0036)', description: 'Number of messages/groups' },
      { path: 'UNZ/02/01', name: 'Interchange control ref (0020)', description: 'Must match UNB control ref' },
    ]},
  };
  const qualifiers = {
    DTM: { '137': 'Document/message date/time', '171': 'Reference date/time' },
    RFF: { 'ON': 'Order number', 'TN': 'Transaction/reference number', 'ACE': 'Reference (ACE)', 'AGO': 'Agreement/order reference' },
  };
  const mapping = defaultMap; // spec-derived mapping could override here if passed in future
  const segs = json.segments || [];
  const pad2 = (n) => String(n+1).padStart(2, '0');
  const getFieldMeta = (tag, i, j) => {
    const m = mapping[tag];
    if (!m || !Array.isArray(m.fields)) return null;
    const p1 = tag + '/' + pad2(i);
    const p2 = tag + '/' + pad2(i) + '/' + pad2(j);
    return m.fields.find(f => f.path === p2) || null;
  };
  const explainSegment = (s) => {
    const m = mapping[s.tag];
    const segDesc = (m && (m.segmentDescription || m.notes)) || ('Segment ' + s.tag);
    const fields = [];
    for (let i = 0; i < (s.elements?.length || 0); i++) {
      const comps = s.elements[i] || [];
      for (let j = 0; j < comps.length; j++) {
        const val = comps[j];
        const meta = getFieldMeta(s.tag, i, j);
        let name = (meta && meta.name) || ('Component ' + (i+1) + '.' + (j+1));
        let description = (meta && meta.description) || '';
        if (s.tag === 'DTM' && j === 0) {
          const q = String(val || '').trim();
          const qDesc = qualifiers.DTM[q];
          if (qDesc) description = description ? (description + ' (qualifier ' + q + ': ' + qDesc + ')') : ('Qualifier ' + q + ': ' + qDesc);
        }
        if (s.tag === 'RFF' && j === 0) {
          const q = String(val || '').trim();
          const qDesc = qualifiers.RFF[q];
          if (qDesc) description = description ? (description + ' (qualifier ' + q + ': ' + qDesc + ')') : ('Qualifier ' + q + ': ' + qDesc);
        }
        fields.push({ path: (s.tag + '/' + pad2(i) + '/' + pad2(j)), name, description: description || null, value: val });
      }
    }
    return { segment: s.tag, position: s.position, description: segDesc, fields };
  };
  const explanations = { segments: segs.map(explainSegment) };
  return { json, errors, explanations, format: fmt || assumedFormat };
}

export function createParseAndExplainMessageTool() {
  return tool(
    async ({ text, format }) => {
      const KNOWN = ['APERAK','INVOIC','ORDERS','UTILMD','MSCONS','REMADV','QUOTES','PARTIN','UTILTS','UITLTS'];
      const detectFromParsed = (parsed) => {
        if (!parsed) return null;
        if (typeof parsed.format === 'string' && parsed.format) return parsed.format.toUpperCase();
        const scanSegments = (segments) => {
          if (!Array.isArray(segments)) return null;
          const unh = segments.find(s => (s?.tag || '').toUpperCase() === 'UNH');
          if (unh && Array.isArray(unh.elements)) {
            // Try typical UNH structure: [ [ref], [type, ver, rel, agency, assoc] ]
            const cand = (unh.elements[1] || [])[0] || (unh.elements[2] || [])[0];
            if (typeof cand === 'string' && /^[A-Z]{3,8}$/.test(cand)) return cand.toUpperCase();
            // Else search any component for known types
            for (const comp of unh.elements) {
              for (const val of comp) {
                if (typeof val === 'string') {
                  const up = val.toUpperCase();
                  if (KNOWN.includes(up)) return up;
                }
              }
            }
          }
          return null;
        };
        if (parsed.json?.segments) {
          const f = scanSegments(parsed.json.segments);
          if (f) return f;
        }
        // Some parsers: parsed.segments
        if (parsed.segments) {
          const f = scanSegments(parsed.segments);
          if (f) return f;
        }
        // Deep structure (interchanges/messages)
        const messages = parsed.json?.interchanges?.[0]?.messages;
        if (Array.isArray(messages)) {
          for (const m of messages) {
            const segs = [m.header, ...(m.segments || []), m.trailer].filter(Boolean);
            const f = scanSegments(segs);
            if (f) return f;
          }
        }
        return null;
      };
      // Try to load a prebuilt parser for the inferred/declared format
      let fmt = format;
      if (!fmt) {
        const m = /UNH[^']*/.exec(text);
        if (m) {
          const part = m[0];
          const pieces = part.split('+');
          if (pieces[2]) fmt = pieces[2].split(':')[0].toUpperCase();
        }
      }
      if (fmt) {
        const parserPath = path.resolve(process.cwd(), 'artifacts', fmt, 'parser.js');
        try {
          await fs.access(parserPath);
          const mod = await import(url.pathToFileURL(parserPath).href);
          if (typeof mod.parseEdifactToJson === 'function' && typeof mod.explain === 'function') {
            const parsed = await mod.parseEdifactToJson(text);
            const explained = await mod.explain(parsed);
            const fmt2 = detectFromParsed(parsed) || detectFromParsed(explained) || fmt;
            return { explained, format: fmt2 || 'UNKNOWN' };
          }
        } catch {
          // fall through to baseline
        }
      }
      // Try derive fmt from text if unknown
      if (!fmt) {
        const m = /UNH[^']*/.exec(text);
        if (m) {
          const part = m[0];
          const cand = (part.split('+')[2] || '').split(':')[0];
          if (cand) fmt = cand.toUpperCase();
        }
      }
      const explained = baselineParseAndExplain(text, fmt);
      return { explained, format: explained.format || fmt || 'UNKNOWN' };
    },
    {
      name: 'parse_and_explain_message',
      description: 'Parse an EDIFACT message and produce an explained JSON, using existing parser if available or a baseline fallback.',
      schema: z.object({
        text: z.string(),
        format: z.string().optional(),
      })
    }
  );
}
