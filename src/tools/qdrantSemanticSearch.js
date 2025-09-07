import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { getQdrantClient, getMakoCollection } from '../lib/qdrantClient.js';
import { getEmbeddings } from '../lib/embeddings.js';

// Advanced semantic search over Qdrant, supports:
// - multi-query expansion
// - field-scoped payload filtering
// - reranking by cosine with local embedding
export function createQdrantSemanticSearch() {
  return tool(
    async ({ queries, mustFilters = [], shouldFilters = [], topK = 10 }) => {
      const client = getQdrantClient();
      const embeddings = getEmbeddings();
      const collection = getMakoCollection();

      // Embed queries and search; merge/rerank
      const vectors = await embeddings.embedDocuments(queries);
      const all = [];
      for (let i = 0; i < vectors.length; i++) {
        const vec = vectors[i];
        const filter = { must: mustFilters, should: shouldFilters };
        const res = await client.search(collection, {
          vector: vec,
          limit: Math.min(topK, 25),
          with_payload: true,
          score_threshold: 0.0,
          filter,
        });
        for (const p of res) {
          all.push({ payload: p.payload, score: p.score, id: p.id });
        }
      }
      // Simple rerank: dedupe by id, keep best score
      const best = new Map();
      for (const r of all) {
        const prev = best.get(r.id);
        if (!prev || r.score > prev.score) best.set(r.id, r);
      }
      return { results: Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, topK) };
    },
    {
      name: 'qdrant_semantic_search',
      description: 'Run multi-query semantic search in Qdrant using Gemini embeddings with optional payload filters.',
      schema: z.object({
        queries: z.array(z.string()).min(1).describe('Alternate phrasings or sub-questions to retrieve specific spec parts'),
        mustFilters: z.array(z.any()).optional(),
        shouldFilters: z.array(z.any()).optional(),
        topK: z.number().int().positive().max(50).default(10)
      })
    }
  );
}
