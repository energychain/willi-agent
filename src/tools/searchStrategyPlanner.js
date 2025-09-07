import { z } from 'zod';
import { tool } from '@langchain/core/tools';

// LLM-planned strategy for multi-step Qdrant search for a specific segment/field.
export function createSearchStrategyPlanner(llm) {
  return tool(
    async ({ task, format, hints }) => {
      const prompt = `You are a research planner for an optimized Qdrant-based specification store. Task: ${task}
Format: ${format}
If goal is to find a specific segment or field mapping, design a short plan with:
- 3-6 semantic sub-queries (phrasings)
- payload filters (must/should) by field keys if useful
- expected signals in payload (e.g., segment tag, composite positions, data element IDs, requirements)
Return JSON: { queries: string[], mustFilters: any[], shouldFilters: any[] }`;
      const res = await llm.invoke(prompt);
      let txt = '';
      if (typeof res === 'string') txt = res; else if (res?.content) {
        if (Array.isArray(res.content)) txt = res.content.find(c => c.text)?.text || '';
        else if (typeof res.content === 'string') txt = res.content;
      }
      try {
        return JSON.parse(txt);
      } catch {
        return { queries: [task], mustFilters: [], shouldFilters: [] };
      }
    },
    {
      name: 'plan_qdrant_search_strategy',
      description: 'Designs a multi-query + filters strategy for Qdrant to retrieve detailed spec parts for a format/segment.',
      schema: z.object({
        task: z.string().describe('Goal, e.g., "Find UTILMD NAD segment and component meanings"'),
        format: z.string(),
        hints: z.array(z.string()).optional(),
      })
    }
  );
}
