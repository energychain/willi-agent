#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = process.cwd();
const artifactsDir = path.resolve(root, 'artifacts');

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function findParsers() {
  const found = [];
  try {
    for await (const p of walk(artifactsDir)) {
      if (p.endsWith('/parser.js') || p.endsWith('/parser.mjs') || p.endsWith('/parser.js.txt')) {
        found.push(p);
      }
    }
  } catch {}
  return found.sort();
}

async function loadSampleText(formatDir) {
  // Try to load an exampleSample from spec.json if available, else skip sample
  try {
    const specPath = path.join(formatDir, 'spec.json');
    const specRaw = await fs.readFile(specPath, 'utf8');
    const spec = JSON.parse(specRaw);
    // We didn't persist example samples per format; return null.
    return null;
  } catch {
    return null;
  }
}

async function explainWithParser(parserPath) {
  const formatDir = path.dirname(parserPath);
  let importPath = parserPath;
  let tmpPath = null;
  // Handle legacy .js.txt by copying to a temp .mjs file for import
  if (parserPath.endsWith('.js.txt')) {
    try {
      const code = await fs.readFile(parserPath, 'utf8');
      tmpPath = path.join(formatDir, '.parser_tmp.mjs');
      await fs.writeFile(tmpPath, code, 'utf8');
      importPath = tmpPath;
    } catch (e) {
      return { parserPath, ok: false, error: `failed to prep legacy parser: ${e.message}` };
    }
  }
  const mod = await import(url.pathToFileURL(importPath).href);
  if (typeof mod.parseEdifactToJson !== 'function' || typeof mod.explain !== 'function') {
    return { parserPath, ok: false, error: 'Parser missing required exports' };
  }
  let sample = await loadSampleText(formatDir);
  let parsed;
  try {
    // If no sample, parse an empty exchange to exercise code paths
    parsed = await mod.parseEdifactToJson(sample || "UNB+UNOC:3+S:R+R:S+250101:0101+REF'UNH+1+APERAK:D:07B:UN:2.1i'BGM+312+X'DTM+137:202501010101:303'NAD+MS+1::293'NAD+MR+2::293'RFF+ACE:1'UNT+8+1'UNZ+1+REF'");
  } catch (e) {
    return { parserPath, ok: false, error: `parse failed: ${e.message}` };
  }
  try {
    const explained = await mod.explain(parsed.json ?? parsed);
    const outPath = path.join(formatDir, 'explained.json');
    await fs.writeFile(outPath, JSON.stringify(explained, null, 2));
    // Cleanup temp file if created
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch {}
    }
    return { parserPath, ok: true, explainedPath: outPath };
  } catch (e) {
    return { parserPath, ok: false, error: `explain failed: ${e.message}` };
  }
}

async function main() {
  const parsers = await findParsers();
  if (!parsers.length) {
    console.log('No generated parsers found under artifacts/.');
    process.exit(0);
  }
  const results = [];
  for (const p of parsers) {
    const res = await explainWithParser(p);
    results.push(res);
    if (res.ok) console.log(`Explained via ${p} -> ${res.explainedPath}`);
    else console.warn(`Failed for ${p}: ${res.error}`);
  }
  const summaryPath = path.join(artifactsDir, 'explain-summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(results, null, 2));
  console.log(`Summary written to ${summaryPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
