import { z } from 'zod';
import { tool } from '@langchain/core/tools';

function isTabular(segmentTag) {
  // Heuristic: segments often repeated like LIN, QTY, PRI, etc.; but keep generic and accept RFF/DTM groups as lists
  return ['LIN', 'QTY', 'PRI', 'MOA', 'NAD', 'RFF', 'DTM'].includes(segmentTag);
}

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

export function createExplainedToMarkdownTool() {
  return tool(
  async ({ explained, title, language }) => {
      const lang = (language || 'en').toLowerCase();
      const i18n = {
        en: {
          overview: 'Overview',
          format: 'Format',
          segments: 'Segments',
          position: 'Position',
        },
        de: {
          overview: 'Überblick',
          format: 'Format',
          segments: 'Segmente',
          position: 'Position',
        }
      };
      const t = i18n[lang] || i18n.en;
      // Coerce string inputs
      let root = explained;
      if (typeof root === 'string') {
        try { root = JSON.parse(root); } catch {}
      }
      const ex = root?.explanations || root?.explained?.explanations || {};
      const base = root?.json || root?.explained?.json || {};
      const ctx = root?._context || root?.explained?._context || {};
      const bdewNames = ctx.bdewNamesByCode || {};
      const segments = ex.segments || [];
      const lines = [];
      if (title) lines.push(`# ${title}`);
      lines.push('');
      // Overview / Überblick
      lines.push(`## ${t.overview}`);
  const fmt = root?.format || root?.explained?.format || 'UNKNOWN';
      lines.push(`- ${t.format}: ${fmt}`);
  if (base?.segments?.length) lines.push(`- ${t.segments}: ${base.segments.length}`);
      lines.push('');

      // Group by segment tag
      const groups = new Map();
      for (const s of segments) {
        if (!groups.has(s.segment)) groups.set(s.segment, []);
        groups.get(s.segment).push(s);
      }

      for (const [tag, segs] of groups.entries()) {
        lines.push(`## ${tag}`);
        const desc = segs[0]?.description || '';
        if (desc) lines.push(desc);
        lines.push('');
  if (isTabular(tag) && segs.length > 1) {
          // Build a table across repeated instances using common fields
          const allFields = new Map();
          for (const s of segs) {
            for (const f of (s.fields || [])) {
              allFields.set(f.name || f.path, true);
            }
          }
          const headers = Array.from(allFields.keys());
          lines.push('|' + headers.map(h => mdEscape(h)).join('|') + '|');
          lines.push('|' + headers.map(() => '---').join('|') + '|');
          for (const s of segs) {
            const row = headers.map(h => {
              const field = (s.fields || []).find(f => (f.name || f.path) === h);
              let v = field?.value;
              // Enrich NAD Party id (3039) with BDEW speaking name
              if (tag === 'NAD' && field) {
                const isPartyId = (field.name || '').startsWith('Party id') || (typeof field.path === 'string' && /NAD\/02\/01$/.test(field.path));
                if (isPartyId) {
                  const code = String(v ?? '');
                  const name = bdewNames[code];
                  if (name && typeof name === 'string' && name.trim() && name.trim() !== code && name.trim() !== 'Unbekannt') {
                    v = `${code} (${name.trim()})`;
                  }
                }
              }
              return mdEscape(v ?? '');
            });
            lines.push('|' + row.join('|') + '|');
          }
          lines.push('');
        } else {
          // Bullet list per occurrence
          for (const s of segs) {
            lines.push(`### ${t.position} ${s.position}`);
            for (const f of (s.fields || [])) {
              const label = f.name || f.path;
              const detail = f.description ? ` — ${f.description}` : '';
              let value = String(f.value ?? '');
              // Special case: UNB sender/recipient IDs -> append speaking name if known
              if (tag === 'UNB') {
                const isSender = label.startsWith('Sender id') || (typeof f.path === 'string' && /UNB\/02\/01$/.test(f.path));
                const isRecipient = label.startsWith('Recipient id') || (typeof f.path === 'string' && /UNB\/03\/01$/.test(f.path));
                if (isSender || isRecipient) {
                  const name = bdewNames[value];
                  if (name && typeof name === 'string' && name.trim() && name.trim() !== value && name.trim() !== 'Unbekannt') {
                    value = `${value} (${name.trim()})`;
                  }
                }
              } else if (tag === 'NAD') {
                const isPartyId = label.startsWith('Party id') || (typeof f.path === 'string' && /NAD\/02\/01$/.test(f.path));
                if (isPartyId) {
                  const name = bdewNames[value];
                  if (name && typeof name === 'string' && name.trim() && name.trim() !== value && name.trim() !== 'Unbekannt') {
                    value = `${value} (${name.trim()})`;
                  }
                }
              }
              lines.push(`- ${mdEscape(label)}: ${mdEscape(value)}${detail}`);
            }
            lines.push('');
          }
        }
      }
      return { markdown: lines.join('\n') };
    },
    {
      name: 'explained_to_markdown',
      description: 'Render explained JSON into a human-readable Markdown summary, using tables for repeated segments when possible.',
      schema: z.object({
        explained: z.any(),
        title: z.string().optional(),
        language: z.string().optional(),
      })
    }
  );
}
