interface ClosestTarget {
  closest(selector: string): unknown;
}

export function shouldStartCompanionDrag(target: unknown): boolean {
  if (!target || typeof (target as Partial<ClosestTarget>).closest !== 'function') return false;
  return !(target as ClosestTarget).closest('[data-companion-control]');
}
