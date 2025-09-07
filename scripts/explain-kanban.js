#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Agent, Task, Team } from 'kaibanjs';
import { getGemini } from '../src/lib/llm.js';
import { createParseAndExplainMessageTool } from '../src/tools/parseAndExplainMessage.js';
import { createExplainedToMarkdownTool } from '../src/tools/explainedToMarkdown.js';
import { createQdrantSemanticSearch } from '../src/tools/qdrantSemanticSearch.js';

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: npm run explain-kanban -- <path-to-edifact-or-md>'); process.exit(1); }
  const text = await fs.readFile(path.resolve(process.cwd(), file), 'utf8');
  const llm = getGemini();
  const parseExplain = createParseAndExplainMessageTool();
  const toMarkdown = createExplainedToMarkdownTool();
  const search = createQdrantSemanticSearch();

  const parserAgent = new Agent({
    name: 'Message Parser',
    role: 'EDIFACT message parser',
    goal: 'Parse and explain the EDIFACT message.',
    tools: [parseExplain],
    llmConfig: { provider: 'google', model: 'gemini-2.5-flash' },
  });

  const writerAgent = new Agent({
    name: 'Explanation Writer',
    role: 'Narrative generator',
    goal: 'Generate a human-readable Markdown summary from explained JSON, enriching with Qdrant context when helpful.',
    tools: [toMarkdown, search],
    llmConfig: { provider: 'google', model: 'gemini-2.5-flash' },
  });

  const t1 = new Task({
    title: 'Parse and explain message',
    description: 'Use parse_and_explain_message with { text: "{messageText}" }. Return { explained, format }.',
    agent: parserAgent,
    expectedOutput: 'Explained JSON',
  });

  const t2 = new Task({
    title: 'Render Markdown',
    description: 'Use explained_to_markdown with { explained: {taskResult:task1}, title: "Erläuterung für {format}", language: "de" }. Optionally call qdrant_semantic_search to add short definitions for unknown fields.',
    agent: writerAgent,
    expectedOutput: 'Markdown string',
    isDeliverable: true,
  });

  const team = new Team({
    name: 'EDIFACT Explain Team',
    agents: [parserAgent, writerAgent],
    tasks: [t1, t2],
    inputs: { messageText: text },
    env: {
      GOOGLE_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
      GOOGLE_AI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
    },
    logLevel: 'info',
  });

  const store = team.useStore();
  const result = await team.start();
  const state = store.getState();
  const tasks = state.tasks || [];
  const parsed = tasks.find(t => t.title.startsWith('Parse and explain'))?.result;
  const md = tasks.find(t => t.title.startsWith('Render Markdown'))?.result;

  // Output to a single user-friendly folder: ./output
  const fmt = (parsed?.format || parsed?.explained?.format || 'UNKNOWN').toUpperCase();
  const inputBase = path.basename(file, path.extname(file));
  const prefix = fmt && fmt !== 'UNKNOWN' ? `${fmt}_${inputBase}` : inputBase;
  const outDir = path.resolve(process.cwd(), 'output');
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${prefix}.explained.json`);
  const mdPath = path.join(outDir, `${prefix}.explained.de.md`);
  await fs.writeFile(jsonPath, JSON.stringify(parsed?.explained || parsed, null, 2), 'utf8');
  await fs.writeFile(mdPath, md?.markdown || String(md || ''), 'utf8');
  console.log(`Wrote Explain Team outputs to ${outDir} (${path.basename(jsonPath)}, ${path.basename(mdPath)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
