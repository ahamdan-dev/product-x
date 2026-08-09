import { describe, expect, it } from 'vitest';
import { shouldStartCompanionDrag } from './companionDrag';

function target(insideControl: boolean) {
  return {
    closest: (selector: string) => (
      selector === '[data-companion-control]' && insideControl ? {} : null
    ),
  };
}

describe('companion drag target', () => {
  it('keeps the companion body draggable', () => {
    expect(shouldStartCompanionDrag(target(false))).toBe(true);
  });

  it('never captures pointer input from companion controls', () => {
    expect(shouldStartCompanionDrag(target(true))).toBe(false);
  });
});
