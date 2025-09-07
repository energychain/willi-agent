import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Tool to run basic tests for a generated parser module with provided samples and adversarial cases.
export function createEdifactTester() {
  return tool(
    async ({ moduleCode, samples }) => {
      const results = [];
      let mod;
      try {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edifact-parser-'));
        const file = path.join(tmpDir, 'parser.mjs');
        await fs.writeFile(file, moduleCode, 'utf8');
        mod = await import(`file://${file}`);
      } catch (e) {
        return { success: false, error: `Module import failed: ${e.message}` };
      }
      if (typeof mod.parseEdifactToJson !== 'function' || typeof mod.explain !== 'function') {
        return { success: false, error: 'Module does not export parseEdifactToJson and explain' };
      }
      // Run each sample
      for (const s of samples) {
        try {
          const parsed = await mod.parseEdifactToJson(s.text);
          const explained = await mod.explain(parsed);
          results.push({ name: s.name, ok: true, parsedSummary: Object.keys(parsed || {}).slice(0, 10) });
        } catch (e) {
          results.push({ name: s.name, ok: false, error: e.message });
        }
      }
      // Inject a few synthetic errors
      const glitch = (s) => s.replace(/\+\+/g, '+?+').replace(/^UNH/gm, 'UXH');
      for (const s of samples.slice(0, 2)) {
        try {
          const res = await mod.parseEdifactToJson(glitch(s.text));
          // Treat explicit error reporting as a successful detection, not only thrown exceptions
          const errs = Array.isArray(res?.errors) ? res.errors : [];
          const detected = errs.some(e =>
            typeof e?.code === 'string' && /UNKNOWN_SEGMENT|MALFORMED_SEGMENT_TAG|INVALID_SEGMENT_TAG|UNH_OUT_OF_SEQUENCE|SEGMENT_OUT_OF_MESSAGE_SCOPE/.test(e.code)
          );
          if (detected) {
            results.push({ name: s.name + ' (mutated)', ok: true });
          } else {
            results.push({ name: s.name + ' (mutated)', ok: false, error: 'Parser did not detect malformed segment tag' });
          }
        } catch (e) {
          // Thrown exceptions also count as successful detection
          results.push({ name: s.name + ' (mutated)', ok: true });
        }
      }
      const success = results.every(r => r.ok);
      return { success, results };
    },
    {
      name: 'test_edifact_parser_module',
      description: 'Run smoke tests for a generated EDIFACT parser module using provided samples and simple mutated cases.',
      schema: z.object({
        moduleCode: z.string(),
        samples: z.array(z.object({ name: z.string(), text: z.string() }))
      })
    }
  );
}
