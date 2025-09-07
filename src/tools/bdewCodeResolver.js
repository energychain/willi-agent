import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'https://stromhaltig.de/data/marktpartnersuche-export-20250905/table-001.json';

function pickName(obj) {
  const codeLike = /^\d{8,}$/;
  const preferredKeys = [
    'name', 'unternehmen', 'company', 'marketpartner', 'marktpartner',
    'firma', 'firm', 'bezeichnung', 'shortname', 'kurzname', 'display', 'title'
  ];
  for (const k of preferredKeys) {
    const v = obj[k];
    if (typeof v === 'string') {
      const s = v.trim();
      if (s && !codeLike.test(s)) return s;
    }
  }
  // Generic scan for keys containing 'name'
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /name/i.test(k) && !/id|code|ik|bdew|gln|edifact/i.test(k)) {
      const s = v.trim();
      if (s && !codeLike.test(s)) return s;
    }
  }
  // Fallback: compose from likely human fields
  const parts = [obj.kurzname, obj.bezeichnung, obj.company, obj.firma, obj.unternehmen, obj.city, obj.ort]
    .filter(v => typeof v === 'string' && v.trim() && !codeLike.test(v));
  if (parts.length) return parts.join(', ');
  // No suitable name
  return undefined;
}

function indexRows(rows) {
  const idx = new Map();
  const codeRegex = /^\d{10,14}$/; // BDEW Codes are typically 13 digits, accept 10-14 defensively
  for (const row of rows) {
    const name = pickName(row);
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && codeRegex.test(v)) {
        if (!idx.has(v)) idx.set(v, name || 'Unbekannt');
      }
    }
  }
  return idx;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

async function readLocalJson(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const content = await fs.readFile(abs, 'utf8');
  return JSON.parse(content);
}

function parseTableShape(obj) {
  // Accept { headers: [...], rows: [[...], ...] }
  if (!obj || !Array.isArray(obj.headers) || !Array.isArray(obj.rows)) return null;
  const headers = obj.headers.map(h => String(h || '').trim());
  // Locate columns by name
  const findIdx = (names) => headers.findIndex(h => names.some(n => h.toLowerCase() === n.toLowerCase()));
  const codeIdx = findIdx(['BdewCode', 'BDEWCode', 'BDEW_Code', 'Code']);
  const nameIdxPref = [
    ['CompanyName'],
    ['EIC_Display_Name', 'EIC_DisplayName'],
    ['Name']
  ];
  let nameIdx = -1;
  for (const names of nameIdxPref) {
    const idx = findIdx(names);
    if (idx >= 0) { nameIdx = idx; break; }
  }
  const codeRegex = /^\d{10,14}$/;
  const map = new Map();
  for (const row of obj.rows) {
    if (!Array.isArray(row)) continue;
    const code = row[codeIdx];
    let name = (nameIdx >= 0 ? row[nameIdx] : undefined);
    const codeStr = typeof code === 'string' ? code.trim() : '';
    if (!codeRegex.test(codeStr)) continue;
    if (typeof name !== 'string' || !name.trim() || /^\d{8,}$/.test(name.trim())) {
      // try to find any non-numeric textual cell in the row as name
      name = row.find(v => typeof v === 'string' && v.trim() && !/^\d{8,}$/.test(v.trim()));
    }
    if (typeof name === 'string' && name.trim()) {
      map.set(codeStr, name.trim());
    }
  }
  return map;
}

export function createBdewCodeResolverTool() {
  return tool(
    async ({ codes, url }) => {
      // Prefer local file if provided or present
      const localPath = (process.env.BDEW_CODES_PATH || '').trim() || 'bdewcodes.json';
      let data, source;
      try {
        // Try explicit or default local file if it exists
        await fs.access(path.isAbsolute(localPath) ? localPath : path.resolve(process.cwd(), localPath));
        data = await readLocalJson(localPath);
        source = path.isAbsolute(localPath) ? localPath : path.resolve(process.cwd(), localPath);
      } catch {
        // Fallback to URL
        const targetUrl = (url || process.env.BDEW_CODES_URL || DEFAULT_URL).trim();
        data = await fetchJson(targetUrl);
        source = targetUrl;
      }
      // Parse shapes: table with headers/rows, array of objects, or generic rows
      let idx;
      const tableIdx = parseTableShape(data);
      if (tableIdx && tableIdx.size) {
        idx = tableIdx;
      } else if (Array.isArray(data)) {
        idx = indexRows(data);
      } else if (Array.isArray(data?.data)) {
        idx = indexRows(data.data);
      } else if (Array.isArray(data?.rows)) {
        idx = indexRows(data.rows);
      } else {
        idx = new Map();
      }
      const namesByCode = {};
      for (const c of codes) {
        namesByCode[c] = idx.get(c) || 'Unbekannt';
      }
      return { source, namesByCode };
    },
    {
      name: 'resolve_bdew_codes',
      description: 'Resolve BDEW codes (sender/recipient IDs) to speaking company/partner names from a published JSON.',
      schema: z.object({
        codes: z.array(z.string()).min(1),
        url: z.string().optional(),
      }),
    }
  );
}
