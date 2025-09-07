import { QdrantClient } from '@qdrant/js-client-rest';

export function getQdrantClient() {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  if (!url) throw new Error('QDRANT_URL missing in env');
  return new QdrantClient({ url, apiKey });
}

export function getMakoCollection() {
  const collection = process.env.QDRANT_COLLECTION || 'willi_mako';
  return collection;
}
