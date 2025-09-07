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
      const ex = explained?.explanations || explained?.explained?.explanations || {};
      const segments = ex.segments || [];
      const lines = [];
      if (title) lines.push(`# ${title}`);
      lines.push('');
      // Overview / Überblick
      lines.push(`## ${t.overview}`);
      const fmt = explained?.format || explained?.explained?.format || 'UNKNOWN';
      lines.push(`- ${t.format}: ${fmt}`);
      if (explained?.json?.segments?.length) lines.push(`- ${t.segments}: ${explained.json.segments.length}`);
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
              return mdEscape(field?.value ?? '');
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
              lines.push(`- ${mdEscape(label)}: ${mdEscape(f.value)}${detail}`);
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
