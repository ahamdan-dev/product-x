/**
 * GLB source resolution and validation for companion picker.
 * Pure module — no React.
 */

export const ACCEPTED_EXTENSIONS = ['.glb', '.gltf', '.zip'] as const;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB cap

type StockCharacterId = 'male' | 'female';

/** Stock character resolved to its public URL. */
export interface StockSource {
  kind: 'stock';
  id: StockCharacterId;
  url: string;
}

/** User-supplied custom source validated and ready. */
export interface CustomSource {
  kind: 'custom';
  /** File or Blob holding the GLB/GLTF/ZIP. */
  file: File;
  /** Object URL for the file, suitable for useGLTF. */
  url: string;
}

/** Validation failed. Show this inline, don't throw. */
export interface InvalidSource {
  kind: 'invalid';
  /** Human-readable reason. */
  message: string;
}

export type SourceResult = StockSource | CustomSource | InvalidSource;

/**
 * Resolve a stock character ID to its public URL.
 */
export function resolveStock(id: StockCharacterId): StockSource {
  return {
    kind: 'stock',
    id,
    url: `/assets/companion/companion_${id}.glb`,
  };
}

/**
 * Validate a user-supplied file. Accepts .glb/.gltf/.zip (of sprite sheets).
 * Returns actionable errors, never throws.
 */
export function validateCustom(file: File): SourceResult {
  const ext = file.name.toLowerCase().match(/\.(glb|gltf|zip)$/)?.[0] as
    | (typeof ACCEPTED_EXTENSIONS)[number]
    | undefined;

  if (!ext) {
    return {
      kind: 'invalid',
      message: `Only ${ACCEPTED_EXTENSIONS.join(', ')} files are accepted.`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    const mbSize = (file.size / (1024 * 1024)).toFixed(1);
    const mbCap = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
    return {
      kind: 'invalid',
      message: `File is ${mbSize}MB — cap is ${mbCap}MB.`,
    };
  }

  // ZIP special case: must contain PNG frames (basic check via file name only, no unzipping here).
  // This is a lightweight heuristic — deeper validation (unzipping, checking contents) is out of scope.
  if (ext === '.zip') {
    // For now, accept any ZIP and rely on downstream loader to fail gracefully.
    // A real check would require reading the ZIP directory (JSZip), which adds complexity.
    // Since the task says "a .zip of sprite sheets" and we're capping size sanely,
    // we'll validate extension + size and let the consumer handle the rest.
    // If you want stricter validation, we'd need to add JSZip and scan for PNGs.
  }

  // Valid: create an object URL.
  const url = URL.createObjectURL(file);
  return {
    kind: 'custom',
    file,
    url,
  };
}
