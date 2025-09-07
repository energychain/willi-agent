import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { getQdrantClient, getMakoCollection } from '../lib/qdrantClient.js';

// Tool: retrieve_spec_by_format
// Input: { format: string }
// Output: { spec: object, pointsMeta: array }
export function createQdrantSpecRetriever() {
  return tool(
    async ({ format }) => {
      const client = getQdrantClient();
      const collection = getMakoCollection();
      // Search by exact match in metadata.format or payload.format_name
      const filter = {
        must: [
          { key: 'format', match: { value: format } },
        ],
        should: [
          { key: 'format_name', match: { value: format } },
          { key: 'message_type', match: { value: format } }
        ]
      };
      const res = await client.scroll(collection, {
        filter,
        with_payload: true,
        with_vector: false,
        limit: 50,
      });
      const points = res.points || [];
      if (!points.length) {
        return { spec: null, pointsMeta: [], message: `No spec found for ${format}` };
      }
      // Prefer first detailed spec-like payload
      const primary = points.find(p => p.payload && (p.payload.schema || p.payload.structure || p.payload.fields)) || points[0];
      return { spec: primary.payload, pointsMeta: points.map(p => p.payload) };
    },
    {
      name: 'retrieve_spec_by_format',
      description: 'Fetch the EDIFACT format specification from Qdrant by format name (e.g., INVOIC, ORDERS, UTILMD). Returns structured payload and related metadata.',
      schema: z.object({
        format: z.string().describe('EDIFACT message type, like INVOIC, ORDERS, UTILMD, MSCONS, APERAK, etc.')
      })
    }
  );
}
