#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

async function findParserForSample(samplePath) {
  const base = path.basename(samplePath);
  const [format] = base.split('_');
  const fmt = (format || '').toUpperCase();
  const candidate = path.resolve(process.cwd(), 'artifacts', fmt, 'parser.js');
  return { fmt, parserPath: candidate };
}

async function main() {
  const sampleArg = process.argv[2];
  if (!sampleArg) {
    console.error('Usage: npm run explain-one -- <path-to-sample-md>');
    process.exit(1);
  }
  const absSample = path.resolve(process.cwd(), sampleArg);
  const { fmt, parserPath } = await findParserForSample(absSample);
  try {
    await fs.access(parserPath);
  } catch {
    console.error(`No parser found for ${fmt} at ${parserPath}. Generate parsers first.`);
    process.exit(2);
  }
  const text = await fs.readFile(absSample, 'utf8');
  const mod = await import(url.pathToFileURL(parserPath).href);
  if (typeof mod.parseEdifactToJson !== 'function' || typeof mod.explain !== 'function') {
    console.error('Parser does not export parseEdifactToJson and explain');
    process.exit(3);
  }
  const parsed = await mod.parseEdifactToJson(text);
  const explained = await mod.explain(parsed);
  const outDir = path.resolve(process.cwd(), 'artifacts', fmt);
  const outFile = path.join(outDir, 'explained.json');
  await fs.writeFile(outFile, JSON.stringify(explained, null, 2), 'utf8');
  console.log(`Explained output written to ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
