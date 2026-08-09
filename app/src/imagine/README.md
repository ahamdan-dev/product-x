# IMAGINE Feature

High-yield lateral pivots for learners viewing a subject.

## Usage

```tsx
import { Imagine } from './imagine/Imagine';

function MyComponent() {
  const handlePin = (cardId: string) => {
    console.log('Pinned card:', cardId);
    // Add to Library here
  };

  return (
    <Imagine
      currentSubjectId="cell"
      onPin={handlePin}
    />
  );
}
```

## Architecture

- **pivots.ts**: Pure logic to build the 4 modules for any (from, to) subject pair
- **pivots.test.ts**: Tests every subject yields exactly 4 non-empty modules
- **Imagine.tsx**: React component with pivot picker + flip cards
- **imagine.css**: Brand-compliant styles (tokens only, hairlines, frosted glass, 3D flip)

## Testing

```bash
npx vitest run src/imagine
```

All 12 tests pass, covering all 21 subjects and their pivots.
