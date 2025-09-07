import { z } from 'zod';
import { tool } from '@langchain/core/tools';

// Fuse multiple payloads into a normalized segment/field mapping
export function createSpecSegmentSynthesizer(llm) {
  return tool(
    async ({ format, segment, results }) => {
      const prompt = `Synthesize a concise, normalized mapping for EDIFACT ${format} segment ${segment} from multiple heterogeneous payloads. Return JSON with shape:
{
  "segment": "${segment}",
  "fields": [
    { "path": "<segment>/<position>/<component?>", "name": "...", "description": "...", "required": true|false, "datatype": "string|number|date|code", "codes?": ["..."], "notes?": "..." }
  ],
  "validations": [ { "rule": "...", "level": "error|warn" } ]
}
Input payloads (array, truncated if large):\n${JSON.stringify(results).slice(0, 30000)}\nOnly return JSON.`;
      const res = await llm.invoke(prompt);
      let txt = '';
      if (typeof res === 'string') txt = res; else if (res?.content) {
        if (Array.isArray(res.content)) txt = res.content.find(c => c.text)?.text || '';
        else if (typeof res.content === 'string') txt = res.content;
      }
      try { return JSON.parse(txt); } catch { return { segment, fields: [], validations: [], raw: results }; }
    },
    {
      name: 'synthesize_spec_segment',
      description: 'Merge multiple Qdrant payloads into a unified mapping for a specific EDIFACT segment/field.',
      schema: z.object({
        format: z.string(),
        segment: z.string(),
        results: z.array(z.any())
      })
    }
  );
}
