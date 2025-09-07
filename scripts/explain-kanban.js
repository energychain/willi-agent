#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Agent, Task, Team } from 'kaibanjs';
import { getGemini } from '../src/lib/llm.js';
import { createParseAndExplainMessageTool } from '../src/tools/parseAndExplainMessage.js';
import { createExplainedToMarkdownTool } from '../src/tools/explainedToMarkdown.js';
import { createQdrantSemanticSearch } from '../src/tools/qdrantSemanticSearch.js';
import { createBdewCodeResolverTool } from '../src/tools/bdewCodeResolver.js';

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: npm run explain-kanban -- <path-to-edifact-or-md>'); process.exit(1); }
  const text = await fs.readFile(path.resolve(process.cwd(), file), 'utf8');
  const llm = getGemini();
  const parseExplain = createParseAndExplainMessageTool();
  const toMarkdown = createExplainedToMarkdownTool();
  const search = createQdrantSemanticSearch();
  const resolveBdew = createBdewCodeResolverTool();

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
  tools: [toMarkdown, search, resolveBdew],
    llmConfig: { provider: 'google', model: 'gemini-2.5-flash' },
  });

  const t1 = new Task({
    title: 'Parse and explain message',
    description: 'Use parse_and_explain_message with { text: "{messageText}" }. Return { explained, format }.',
    agent: parserAgent,
    expectedOutput: 'Explained JSON',
  });

  const t1b = new Task({
    title: 'Resolve BDEW codes',
    description: 'If available from {taskResult:task1}.explained._context, call resolve_bdew_codes with { codes: [senderId, recipientId] } and return { namesByCode }.',
    agent: writerAgent,
    expectedOutput: 'Names by code',
  });

  const t2 = new Task({
    title: 'Render Markdown',
    description: 'Use explained_to_markdown with { explained: {taskResult:task1} augmented by { _context: { bdewNamesByCode: {taskResult:task2}.namesByCode } }, title: "Erläuterung für {format}", language: "de" }. Optionally call qdrant_semantic_search to add short definitions for unknown fields.',
    agent: writerAgent,
    expectedOutput: 'Markdown string',
    isDeliverable: true,
  });

  const team = new Team({
    name: 'EDIFACT Explain Team',
    agents: [parserAgent, writerAgent],
    tasks: [t1, t1b, t2],
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
  // Helper to coerce JSON-ish strings to objects
  const coerce = (v) => {
    if (v && typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {}
    }
    return v;
  };
  let parsed = tasks.find(t => t.title.startsWith('Parse and explain'))?.result;
  parsed = coerce(parsed);
  const resolved = tasks.find(t => t.title.startsWith('Resolve BDEW'))?.result;
  let bdewNamesByCode = resolved?.namesByCode || resolved?.result?.namesByCode;
  // Fallback: resolve locally if the agent didn’t run the tool
  if (!bdewNamesByCode) {
    try {
      const ctx = (parsed?.explained && coerce(parsed.explained)?._context) || parsed?.explained?._context || parsed?._context || {};
      const codes = [ctx?.senderId, ctx?.recipientId].filter(Boolean);
      if (codes.length) {
        const out = await resolveBdew.invoke({ codes });
        bdewNamesByCode = out?.namesByCode;
      }
    } catch {}
  }
  // Normalize explained object for Markdown renderer
  const explainedObj = parsed?.explained ? coerce(parsed.explained) : parsed;
  let explainedForMd = explainedObj ? { ...explainedObj, _context: { ...(explainedObj._context||{}), bdewNamesByCode } } : parsed;
  if (explainedForMd && !explainedForMd.format && (parsed?.format || parsed?.explained?.format)) {
    explainedForMd = { ...explainedForMd, format: parsed?.format || parsed?.explained?.format };
  }
  // Always regenerate Markdown locally to ensure correct title/format and BDEW names
  let md = null;

  // Output to a single user-friendly folder: ./output
  const fmt = (parsed?.format || parsed?.explained?.format || explainedForMd?.format || 'UNKNOWN').toUpperCase();
  const inputBase = path.basename(file, path.extname(file));
  const prefix = fmt && fmt !== 'UNKNOWN' ? `${fmt}_${inputBase}` : inputBase;
  const outDir = path.resolve(process.cwd(), 'output');
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${prefix}.explained.json`);
  const mdPath = path.join(outDir, `${prefix}.explained.de.md`);
  // Backward-compatible alias paths (legacy names without format prefix)
  const legacyJsonPath = path.join(outDir, `${inputBase}.explained.json`);
  const legacyMdPath = path.join(outDir, `${inputBase}.explained.de.md`);
  const explainedPayload = JSON.stringify(explainedForMd || parsed, null, 2);
  await fs.writeFile(jsonPath, explainedPayload, 'utf8');
  // Also write legacy alias for tools expecting the old name
  await fs.writeFile(legacyJsonPath, explainedPayload, 'utf8');
  // Ensure Markdown includes BDEW names by regenerating if needed
  try {
    const effFmt = fmt || (parsed?.format || parsed?.explained?.format || 'UNKNOWN');
    md = await toMarkdown.invoke({ explained: explainedForMd || parsed, title: `Erläuterung für ${effFmt}`, language: 'de' });
  } catch {}
  const mdPayload = md?.markdown || String(md || '');
  await fs.writeFile(mdPath, mdPayload, 'utf8');
  await fs.writeFile(legacyMdPath, mdPayload, 'utf8');
  console.log(`Wrote Explain Team outputs to ${outDir} (${path.basename(jsonPath)}, ${path.basename(mdPath)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
