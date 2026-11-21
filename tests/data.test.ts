import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const json = (p: string) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

describe('committed block index', () => {
  for (const chain of ['bsc', 'eth']) {
    it(`${chain}: one strictly increasing boundary block per consecutive UTC day`, () => {
      const idx = json(`data/blocks/${chain}.json`);
      const days = Object.entries<number>(idx.days);
      expect(days.length).toBeGreaterThan(100);
      for (let i = 1; i < days.length; i++) {
        const [d0, b0] = days[i - 1];
        const [d1, b1] = days[i];
        expect(Date.parse(d1) - Date.parse(d0)).toBe(86_400_000);
        expect(b1).toBeGreaterThan(b0);
      }
    });
  }
});

describe('committed chain-supply baseline', () => {
  const files = ['bsc', 'eth'].flatMap((c) =>
    readdirSync(path.join(root, 'data/chain-supply', c)).map((f) => `data/chain-supply/${c}/${f}`),
  );
  it('has files for the NVDAB hero leg', () => {
    expect(files).toContain('data/chain-supply/bsc/0x02fca66c1d1afb4e2a7884261eb00f63598a7436.json');
  });
  it.each(files)('%s uses the block index days and non-negative supply', (f) => {
    const d = json(f);
    const idx = json(`data/blocks/${d.chain}.json`).days;
    for (const [day, v] of Object.entries<number | null>(d.days)) {
      expect(idx[day]).toBeTypeOf('number');
      if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
