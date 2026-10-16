import { readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const path = new URL('../worker/.dev.vars', import.meta.url);
let contents = '';
try { contents = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!/^\s*DANCEFLOOR_ENCRYPTION_KEY\s*=/m.test(contents)) {
  await appendFile(path, `\nDANCEFLOOR_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  console.log('Initialized local Dancefloor encryption key.');
}
