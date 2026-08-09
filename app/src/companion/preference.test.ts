import { describe, expect, it } from 'vitest';
import { readCharacterPreference, writeCharacterPreference } from './preference';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  };
}

describe('companion preference', () => {
  it('defaults to the female companion when no choice was saved', () => {
    expect(readCharacterPreference(memoryStorage())).toBe('female');
  });

  it('shares a valid selection through storage', () => {
    const storage = memoryStorage();
    writeCharacterPreference('male', storage);
    expect(readCharacterPreference(storage)).toBe('male');
  });

  it('rejects stale or malformed values', () => {
    expect(readCharacterPreference(memoryStorage('procedural-token'))).toBe('female');
  });
});
