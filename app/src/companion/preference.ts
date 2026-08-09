export type CompanionCharacter = 'male' | 'female';

export const COMPANION_CHARACTER_KEY = 'product-x.companion-character';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCharacterPreference(
  storage: StorageLike | null = browserStorage(),
): CompanionCharacter {
  const saved = storage?.getItem(COMPANION_CHARACTER_KEY);
  return saved === 'male' || saved === 'female' ? saved : 'female';
}

export function writeCharacterPreference(
  character: CompanionCharacter,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(COMPANION_CHARACTER_KEY, character);
  } catch {
  }
}
