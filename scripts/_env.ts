/**
 * Local scripts only: take keys from the environment, else from the developer's
 * ~/.config files (outside this repo). Nothing here is ever printed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function loadKeys(): void {
  if (!process.env.CMC_API_KEY) {
    const p = path.join(homedir(), '.config/coinmarketcap/credentials.json');
    if (existsSync(p)) process.env.CMC_API_KEY = JSON.parse(readFileSync(p, 'utf8')).api_key;
  }
  if (!process.env.ALCHEMY_API_KEY) {
    const p = path.join(homedir(), '.config/alchemy/alchemy.env');
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^ALCHEMY_API_KEY=(.+)$/m);
      if (m) process.env.ALCHEMY_API_KEY = m[1].trim();
    }
  }
}

/** Fail loudly if a key value would end up in an artefact. */
export function assertNoSecrets(text: string): void {
  for (const k of [process.env.CMC_API_KEY, process.env.ALCHEMY_API_KEY]) {
    if (k && k.length > 8 && text.includes(k)) throw new Error('refusing to write a secret into an artefact');
  }
}

/** Parse a JSON file, or return `fallback` when it does not exist (one read, no exists-then-read race). */
export function readJsonOr<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
}
