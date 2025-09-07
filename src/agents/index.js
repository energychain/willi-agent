import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Agent, Task, Team } from 'kaibanjs';
import { getGemini } from '../lib/llm.js';
import { createQdrantSpecRetriever } from '../tools/qdrantSpecRetriever.js';
import { createEdifactParserGenerator } from '../tools/edifactParserGenerator.js';
import { createEdifactTester } from '../tools/edifactTester.js';
import { createQdrantSemanticSearch } from '../tools/qdrantSemanticSearch.js';
import { createSearchStrategyPlanner } from '../tools/searchStrategyPlanner.js';
import { createSpecSegmentSynthesizer } from '../tools/specSegmentSynthesizer.js';

const llm = getGemini();
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

const specRetriever = createQdrantSpecRetriever();
const parserGenerator = createEdifactParserGenerator(llm);
const testerTool = createEdifactTester();
const semanticSearch = createQdrantSemanticSearch();
const strategyPlanner = createSearchStrategyPlanner(llm);
const segmentSynth = createSpecSegmentSynthesizer(llm);

// Knowledge Agent: fetches and explains spec from QDrant
export const knowledgeAgent = new Agent({
  name: 'Spec Sage',
  role: 'EDIFACT Spec Librarian',
  goal: 'Retrieve and clarify EDIFACT format specifications from QDrant for other agents.',
  tools: [specRetriever, semanticSearch, segmentSynth],
  // Explicitly set provider to Google to use Gemini models (prevents default OpenAI usage)
  llmConfig: { provider: 'google', model: 'gemini-2.5-flash', apiKey: API_KEY },
});

// Builder Agent: generates parser module per format
export const builderAgent = new Agent({
  name: 'Parser Smith',
  role: 'EDIFACT Parser Engineer',
  goal: 'Generate robust JS parsers that transform EDIFACT messages into JSON and explain fields.',
  tools: [parserGenerator],
  llmConfig: { provider: 'google', model: 'gemini-2.5-flash', apiKey: API_KEY },
});

// Tester Agent: validates parser modules with provided and mutated samples
export const testerAgent = new Agent({
  name: 'QA Hammer',
  role: 'EDIFACT Parser QA',
  goal: 'Validate parser modules using samples and adversarial cases; report issues.',
  tools: [testerTool],
  llmConfig: { provider: 'google', model: 'gemini-2.5-flash', apiKey: API_KEY },
});

// Strategist Agent: plans and runs multi-query Qdrant searches before retrieval
export const strategistAgent = new Agent({
  name: 'Query Strategist',
  role: 'Semantic Retrieval Planner',
  goal: 'Devise and execute multi-step Qdrant search strategies to isolate precise spec parts for segments/fields.',
  tools: [strategyPlanner, semanticSearch],
  llmConfig: { provider: 'google', model: 'gemini-2.5-flash', apiKey: API_KEY },
});

export async function loadSamples(dir = path.resolve(process.cwd(), 'MAKO_SAMPLES')) {
  const files = await fs.readdir(dir);
  const mdFiles = files.filter(f => f.toLowerCase().endsWith('.md'));
  const samples = [];
  for (const f of mdFiles) {
    const text = await fs.readFile(path.join(dir, f), 'utf8');
    samples.push({ name: f, text });
  }
  return samples;
}

export function extractFormatFromFilename(file) {
  // e.g., INVOIC_1.md -> INVOIC
  const base = path.basename(file);
  const [format] = base.split('_');
  return (format || '').toUpperCase();
}
