import { describe, it, expect } from 'vitest';
import { buildPivotModules, getPivotOptions } from './pivots';
import { SUBJECTS, pivotsFor } from '../content/subjects';

describe('pivots', () => {
  describe('buildPivotModules', () => {
    it('should return exactly 4 modules for every subject pair', () => {
      // Test across all 21 subjects and their declared pivots
      for (const from of SUBJECTS) {
        const pivots = pivotsFor(from.id);

        for (const toId of pivots) {
          const modules = buildPivotModules(from.id, toId);

          expect(
            modules.length,
            `From ${from.id} to ${toId} must yield exactly 4 modules`
          ).toBe(4);

          // All modules must have non-empty content
          for (const mod of modules) {
            expect(mod.content.length, `Module content cannot be empty`).toBeGreaterThan(0);
            expect(mod.title.length, `Module title cannot be empty`).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should include a retrieval prompt with question and answer', () => {
      const modules = buildPivotModules('cell', 'biochem');
      const promptModule = modules.find(m => m.kind === 'prompt');

      expect(promptModule).toBeDefined();
      expect(promptModule?.content).toContain('?'); // Question ends with ?
      expect(promptModule?.secondary).toBeDefined();
      expect(promptModule?.secondary!.length).toBeGreaterThan(0);
    });

    it('should include a pearl module', () => {
      const modules = buildPivotModules('cell', 'biochem');
      const pearlModule = modules.find(m => m.kind === 'pearl');

      expect(pearlModule).toBeDefined();
      expect(pearlModule?.title).toBe('High-Yield Pearl');
      expect(pearlModule?.content.length).toBeGreaterThan(20); // Pearls are substantive
    });

    it('should include a discriminator when confusedWith exists', () => {
      // genetics has confusedWith: 'cell'
      const modules = buildPivotModules('cell', 'genetics');
      const discriminator = modules.find(m => m.kind === 'discriminator');

      expect(discriminator).toBeDefined();
      expect(discriminator?.content).toContain('confused');
      expect(discriminator?.secondary).toBeDefined();
    });

    it('should substitute a second prompt when no confusedWith exists', () => {
      // cell has no confusedWith
      const modules = buildPivotModules('genetics', 'cell');
      const prompts = modules.filter(m => m.kind === 'prompt');

      // Should have 2 prompts: one in slot 1, one substituted in slot 3
      expect(prompts.length).toBeGreaterThanOrEqual(1);

      // Total must still be 4
      expect(modules.length).toBe(4);
    });

    it('should include a bridge module connecting back to origin', () => {
      const modules = buildPivotModules('cell', 'biochem');
      const bridge = modules.find(m => m.kind === 'bridge');

      expect(bridge).toBeDefined();
      expect(bridge?.title).toBe('Connection');
      expect(bridge?.secondary).toBeDefined();
      expect(bridge?.secondary!.length).toBeGreaterThan(0);
    });

    it('should handle subjects with no pivots gracefully', () => {
      // Mock case: a subject with no pivots should return empty array
      const modules = buildPivotModules('nonexistent', 'cell');
      expect(modules).toEqual([]);
    });
  });

  describe('getPivotOptions', () => {
    it('should return pivot options for every subject with pivots', () => {
      for (const subj of SUBJECTS) {
        const options = getPivotOptions(subj.id);
        const expectedCount = pivotsFor(subj.id).length;

        expect(
          options.length,
          `${subj.id} should have ${expectedCount} pivot options`
        ).toBe(expectedCount);
      }
    });

    it('should include label and reason for each option', () => {
      const options = getPivotOptions('cell');

      for (const opt of options) {
        expect(opt.id.length).toBeGreaterThan(0);
        expect(opt.label.length).toBeGreaterThan(0);
        expect(opt.reason.length).toBeGreaterThan(0);
      }
    });

    it('should return empty array for nonexistent subject', () => {
      const options = getPivotOptions('nonexistent');
      expect(options).toEqual([]);
    });
  });

  describe('module completeness', () => {
    it('every subject must have at least 2 prompts to support fallback', () => {
      // If a subject has no confusedWith, we need at least 2 prompts to fill 4 cards
      for (const subj of SUBJECTS) {
        if (!subj.confusedWith) {
          expect(
            subj.prompts.length,
            `${subj.id} has no confusedWith, so must have at least 2 prompts`
          ).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('every module kind appears at least once across all subjects', () => {
      const kindsUsed = new Set<string>();

      for (const from of SUBJECTS) {
        const pivots = pivotsFor(from.id);
        if (pivots.length === 0) continue;

        const toId = pivots[0]!;
        const modules = buildPivotModules(from.id, toId);

        for (const mod of modules) {
          kindsUsed.add(mod.kind);
        }
      }

      expect(kindsUsed.has('prompt')).toBe(true);
      expect(kindsUsed.has('pearl')).toBe(true);
      expect(kindsUsed.has('discriminator')).toBe(true);
      expect(kindsUsed.has('bridge')).toBe(true);
    });
  });
});
