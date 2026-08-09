/**
 * Tests for glbSource validator.
 */

import { describe, it, expect } from 'vitest';
import { validateCustom, resolveStock, ACCEPTED_EXTENSIONS } from './glbSource';

describe('glbSource', () => {
  describe('resolveStock', () => {
    it('resolves male stock character', () => {
      const result = resolveStock('male');
      expect(result.kind).toBe('stock');
      expect(result.url).toBe('/assets/companion/companion_male.glb');
    });

    it('resolves female stock character', () => {
      const result = resolveStock('female');
      expect(result.kind).toBe('stock');
      expect(result.url).toBe('/assets/companion/companion_female.glb');
    });
  });

  describe('validateCustom', () => {
    it('accepts .glb extension', () => {
      const file = new File(['fake glb content'], 'model.glb', { type: 'model/gltf-binary' });
      const result = validateCustom(file);
      expect(result.kind).toBe('custom');
      if (result.kind === 'custom') {
        expect(result.url).toMatch(/^blob:/);
      }
    });

    it('accepts .gltf extension', () => {
      const file = new File(['fake gltf content'], 'model.gltf', { type: 'model/gltf+json' });
      const result = validateCustom(file);
      expect(result.kind).toBe('custom');
    });

    it('accepts .zip extension', () => {
      const file = new File(['fake zip content'], 'sprites.zip', { type: 'application/zip' });
      const result = validateCustom(file);
      expect(result.kind).toBe('custom');
    });

    it('accepts uppercase extensions (case-insensitive)', () => {
      const fileGLB = new File(['content'], 'MODEL.GLB', { type: 'model/gltf-binary' });
      const fileZIP = new File(['content'], 'SPRITES.ZIP', { type: 'application/zip' });
      expect(validateCustom(fileGLB).kind).toBe('custom');
      expect(validateCustom(fileZIP).kind).toBe('custom');
    });

    it('rejects unsupported extensions', () => {
      const file = new File(['content'], 'model.obj', { type: 'text/plain' });
      const result = validateCustom(file);
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') {
        expect(result.message).toContain('.glb, .gltf, .zip');
      }
    });

    it('rejects oversized files', () => {
      const bigBuffer = new ArrayBuffer(20 * 1024 * 1024); // 20MB
      const file = new File([bigBuffer], 'huge.glb', { type: 'model/gltf-binary' });
      const result = validateCustom(file);
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') {
        expect(result.message).toMatch(/cap is 15MB/i);
      }
    });

    it('accepts file at size cap', () => {
      const buffer = new ArrayBuffer(15 * 1024 * 1024); // exactly 15MB
      const file = new File([buffer], 'maxsize.glb', { type: 'model/gltf-binary' });
      const result = validateCustom(file);
      expect(result.kind).toBe('custom');
    });

    it('lists accepted extensions as a const', () => {
      expect(ACCEPTED_EXTENSIONS).toEqual(['.glb', '.gltf', '.zip']);
    });
  });
});
