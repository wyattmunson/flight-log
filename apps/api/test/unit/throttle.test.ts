import { describe, expect, it } from 'vitest';
import { createThrottle } from '../../src/auth/throttle';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createThrottle', () => {
  it('allows up to the limit, then reports seconds to wait', () => {
    const c = clock();
    const th = createThrottle({ limit: 3, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(th.check('k')).toBe(0);
      th.hit('k');
      c.advance(1000);
    }
    // First hit was 3 s ago, so a slot frees in 57 s.
    expect(th.check('k')).toBe(57);
  });

  it('slides: old attempts age out of the window', () => {
    const c = clock();
    const th = createThrottle({ limit: 2, windowMs: 10_000, now: c.now });
    th.hit('k');
    c.advance(6000);
    th.hit('k');
    expect(th.check('k')).toBe(4);
    c.advance(4001);
    expect(th.check('k')).toBe(0);
  });

  it('keeps keys independent and reset clears one', () => {
    const c = clock();
    const th = createThrottle({ limit: 1, windowMs: 60_000, now: c.now });
    th.hit('a');
    expect(th.check('a')).toBeGreaterThan(0);
    expect(th.check('b')).toBe(0);
    th.reset('a');
    expect(th.check('a')).toBe(0);
  });

  it('bounds memory by evicting when too many keys are live', () => {
    const c = clock();
    const th = createThrottle({ limit: 1, windowMs: 60_000, now: c.now, maxKeys: 3 });
    for (const k of ['a', 'b', 'c', 'd']) th.hit(k);
    expect(th.check('a')).toBe(0); // evicted
    expect(th.check('d')).toBeGreaterThan(0);
  });
});
