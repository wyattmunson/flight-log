import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  parseCookies,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from '../../src/auth/cookies';

describe('parseCookies', () => {
  it('parses pairs, trims, and decodes', () => {
    expect(parseCookies('a=1; b=hello%20world;  c = 3 ')).toEqual({
      a: '1',
      b: 'hello world',
      c: '3',
    });
  });

  it('handles missing, empty and malformed headers', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('junk; =nameless; ok=1')).toEqual({ ok: '1' });
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });

  it('keeps the first value of a repeated name and strips quotes', () => {
    expect(parseCookies('a=1; a=2; q="x y"')).toEqual({ a: '1', q: 'x y' });
  });

  it('keeps "=" inside values', () => {
    expect(parseCookies('t=abc==')).toEqual({ t: 'abc==' });
  });
});

describe('serializeSessionCookie', () => {
  it('sets HttpOnly, SameSite=Lax, Path=/ and Max-Age', () => {
    const c = serializeSessionCookie('tok_en-1', { secure: false, maxAgeSeconds: 2_592_000 });
    expect(c).toBe(`${SESSION_COOKIE}=tok_en-1; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
  });

  it('adds Secure when asked', () => {
    expect(serializeSessionCookie('t', { secure: true, maxAgeSeconds: 60 })).toMatch(/; Secure$/);
  });

  it('clears with an expired cookie carrying the same attributes', () => {
    const c = serializeClearedSessionCookie(true);
    expect(c).toContain(`${SESSION_COOKIE}=;`);
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('Expires=Thu, 01 Jan 1970');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
  });
});
