import fs from 'node:fs';
import path from 'node:path';

// Simple smoke check to ensure workspace structure exists
const samplesDir = path.resolve(process.cwd(), 'MAKO_SAMPLES');
if (!fs.existsSync(samplesDir)) {
  console.error('MAKO_SAMPLES directory missing');
  process.exit(1);
}
console.log('SMOKE: Samples dir present');
