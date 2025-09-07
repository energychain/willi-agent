import 'dotenv/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export function getGemini(model = process.env.GEMINI_MODEL || 'gemini-2.5-flash') {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY/GOOGLE_AI_API_KEY missing in env');
  return new ChatGoogleGenerativeAI({ model, apiKey, temperature: 0.2 });
}
