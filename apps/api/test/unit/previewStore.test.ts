import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewStore } from '../../src/import/previewStore';

describe('PreviewStore', () => {
  afterEach(() => vi.useRealTimers());

  it('returns values only to their owner and only before expiry', () => {
    vi.useFakeTimers();
    const store = new PreviewStore<string>(() => 1000);
    const { id } = store.put('u1', 'hello');
    expect(store.get('u1', id)).toBe('hello');
    expect(store.get('u2', id)).toBeUndefined();
    vi.advanceTimersByTime(1001);
    expect(store.get('u1', id)).toBeUndefined();
  });

  it('evicts the oldest entry when full', () => {
    const store = new PreviewStore<number>(() => 60_000, 2);
    const a = store.put('u', 1);
    store.put('u', 2);
    store.put('u', 3);
    expect(store.get('u', a.id)).toBeUndefined();
  });
});
