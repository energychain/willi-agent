import 'dotenv/config';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

export function getEmbeddings() {
  const provider = (process.env.EMBEDDING_PROVIDER || 'gemini').toLowerCase();
  if (provider !== 'gemini') {
    throw new Error(`Only GEMINI embeddings are implemented. Set EMBEDDING_PROVIDER=gemini, got ${provider}`);
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const model = process.env.GEMINI_EMBED_MODEL || 'text-embedding-004';
  if (!apiKey) throw new Error('GEMINI_API_KEY/GOOGLE_AI_API_KEY missing in env');
  return new GoogleGenerativeAIEmbeddings({ apiKey, model });
}
