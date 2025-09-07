import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Agent, Task, Team } from 'kaibanjs';
import { loadSamples, extractFormatFromFilename, knowledgeAgent, builderAgent, testerAgent, strategistAgent } from './agents/index.js';

async function main() {
  const samples = await loadSamples();

  // Group samples by format
  const byFormat = new Map();
  for (const s of samples) {
    const fmt = extractFormatFromFilename(s.name);
    if (!byFormat.has(fmt)) byFormat.set(fmt, []);
    byFormat.get(fmt).push(s);
  }

  // Optional filtering: ONLY_FORMATS (comma-separated list)
  const onlyFormats = (process.env.ONLY_FORMATS || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const stopAfterFormat = (process.env.STOP_AFTER_FORMAT || '').toUpperCase();

  const entries = Array.from(byFormat.entries())
    .filter(([fmt]) => (onlyFormats.length ? onlyFormats.includes(fmt) : true));

  for (const [format, group] of entries) {
    console.log(`\n=== Processing format: ${format} (samples: ${group.length}) ===`);
    const outDir = path.resolve(process.cwd(), 'artifacts', format);
    await fs.mkdir(outDir, { recursive: true });

    // Define tasks for KaibanJS engine
    const t0 = new Task({
      title: `Plan retrieval for ${format}`,
      description: `Plan a multi-query Qdrant search strategy for {format} using plan_qdrant_search_strategy, then execute qdrant_semantic_search with the planned queries and filters. Return a concise JSON summary with {queries, mustFilters, shouldFilters, results}.`,
      agent: strategistAgent,
      expectedOutput: 'Search plan and top results',
      isDeliverable: false,
    });

    const t1 = new Task({
      title: `Fetch spec for ${format}`,
      description: `Call retrieve_spec_by_format with { format: "{format}" }. If partial, use qdrant_semantic_search results from {taskResult:task1} to improve coverage and synthesize key segments (UNH, BGM, DTM, NAD) with synthesize_spec_segment. Return JSON spec.`,
      agent: knowledgeAgent,
      expectedOutput: 'JSON spec payload',
      isDeliverable: false,
    });

    const t2 = new Task({
      title: `Generate parser for ${format}`,
      description: `Use generate_edifact_parser_module with { format: "{format}", spec: {taskResult:task2} || {taskResult:task1}, sample: "{exampleSample}" }. Return { moduleCode }.`,
      agent: builderAgent,
      expectedOutput: 'JavaScript module code as string',
      isDeliverable: false,
    });

    const t3 = new Task({
      title: `Test parser for ${format}`,
      description: `Use test_edifact_parser_module with { moduleCode: {taskResult:task3}.moduleCode || {taskResult:task3}, samples: {samplesForFormat} }. Return { success, results }.`,
      agent: testerAgent,
      expectedOutput: 'Test results with pass/fail',
      isDeliverable: true,
    });

    const team = new Team({
      name: `EDIFACT-${format}-Team`,
      agents: [strategistAgent, knowledgeAgent, builderAgent, testerAgent],
      tasks: [t0, t1, t2, t3],
      inputs: { format, exampleSample: group[0]?.text || '', samplesForFormat: group },
      // Provide both env names to satisfy different integrations; agents explicitly use provider: 'google'
      env: {
        GOOGLE_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
        GOOGLE_AI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
      },
      memory: true,
      logLevel: 'debug',
    });

    // Live logging + persistence
    const store = team.useStore();
    const logsPath = path.join(outDir, 'workflowLogs.json');
    const statusPath = path.join(outDir, 'status.txt');
    await fs.writeFile(logsPath, '[]');

    const unsubscribe = store.subscribe(s => s.workflowLogs, async (newLogs) => {
      try {
        await fs.writeFile(logsPath, JSON.stringify(newLogs, null, 2));
        const last = newLogs[newLogs.length - 1];
        if (last) {
          const line = `[${last.timestamp || ''}] ${last.type || ''} :: ${last.message || ''}`;
          console.log(line);
        }
      } catch {}
    });

    team.onWorkflowStatusChange(async (status) => {
      console.log(`Workflow status: ${status}`);
      try { await fs.writeFile(statusPath, String(status)); } catch {}
    });

  let stopRequested = false;
  try {
      const result = await team.start();
      // Persist task artifacts once the team completes
      const state = store.getState();
      const tasks = state?.tasks || [];
      // Helper to write JSON safely
      const writeJson = async (file, data) => {
        try {
          const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
          await fs.writeFile(path.join(outDir, file), json, 'utf8');
        } catch (e) {
          console.warn(`Failed writing ${file}:`, e.message);
        }
      };
      // Extract by title heuristics
      const taskByTitle = (startsWith) => tasks.find(t => (t?.title || '').startsWith(startsWith));
      const tPlan = taskByTitle(`Plan retrieval for ${format}`);
      const tSpec = taskByTitle(`Fetch spec for ${format}`);
      const tGen  = taskByTitle(`Generate parser for ${format}`);
      const tTest = taskByTitle(`Test parser for ${format}`);

      if (tPlan?.result) {
        await writeJson('search-plan.json', tPlan.result);
      }
      if (tSpec?.result) {
        await writeJson('spec.json', tSpec.result);
      }
      if (tGen?.result) {
        // Result might be a string (moduleCode) or an object { moduleCode }
        let code = tGen.result;
        if (code && typeof code === 'object' && 'moduleCode' in code) code = code.moduleCode;
        if (typeof code === 'string' && code.trim().length > 0) {
          // Prefer .js extension for generated parsers
          const jsPath = path.join(outDir, 'parser.js');
          await fs.writeFile(jsPath, code, 'utf8');
          // Clean up legacy .txt if present
          const legacy = path.join(outDir, 'parser.js.txt');
          try { await fs.rm(legacy); } catch {}
        }
      }
      if (tTest?.result) {
        await writeJson('tests.json', tTest.result);
      }
      console.log(`Finished ${format}. Artifacts persisted to ${outDir}`);
      if (stopAfterFormat && stopAfterFormat === format) {
        stopRequested = true;
      }
    } catch (e) {
      console.error(`Team run failed for ${format}:`, e.message);
    } finally {
      unsubscribe?.();
    }
    if (stopRequested) {
      console.log(`Stop requested after ${format}. Halting further processing.`);
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
