import { randomUUID } from 'node:crypto';

interface Entry<T> {
  userId: string;
  expiresAt: number;
  value: T;
}

/**
 * In-memory, TTL-bounded store for import previews so commit doesn't need a re-upload.
 * Single-process only: previews are lost on API restart (the UI asks to re-upload).
 */
export class PreviewStore<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(
    private ttlMs: () => number,
    private maxEntries = 50,
  ) {}

  put(userId: string, value: T): { id: string; expiresAt: Date } {
    this.sweep();
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const id = randomUUID();
    const expiresAt = Date.now() + this.ttlMs();
    this.entries.set(id, { userId, expiresAt, value });
    return { id, expiresAt: new Date(expiresAt) };
  }

  /** Returns the value only for the user who created it and only before it expires. */
  get(userId: string, id: string): T | undefined {
    this.sweep();
    const entry = this.entries.get(id);
    return entry && entry.userId === userId ? entry.value : undefined;
  }

  delete(id: string) {
    this.entries.delete(id);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(id);
  }
}
