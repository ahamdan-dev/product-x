/**
 * IMAGINE — lateral pivot picker + flip cards
 *
 * The learner is looking at a subject, and instead of re-explaining what is already on screen,
 * IMAGINE offers HIGH-YIELD LATERAL PIVOTS.
 *
 * Flow:
 * 1. Pivot picker: show lateral pivots (from pivotsFor) as choosable chips with one-line reason
 * 2. Pick one → four flip cards appear, each a different MODULE of that pivot
 * 3. Each card can be pinned to the Library (fires onPin callback)
 */

import { useState } from 'react';
import { buildPivotModules, getPivotOptions, type PivotModule } from './pivots';
import './imagine.css';

interface ImagineProps {
  /** The subject id the learner is currently viewing */
  currentSubjectId: string;
  /** Callback fired when a card is pinned. Parent builds the Library. */
  onPin: (cardId: string) => void;
  /**
   * Resolve a district id to its display name, for the pivot chips.
   *
   * Optional, and the fallback is the previous behaviour. `pivots.ts` is pure and has no access to the
   * store, so its `label` is the subject *summary* — a full sentence, which is not a chip. A host that
   * can reach the store passes this so each chip reads "Biochemistry" with the sentence beneath it.
   */
  labelOf?: (districtId: string) => string | undefined;
}

export function Imagine({ currentSubjectId, onPin, labelOf }: ImagineProps) {
  const pivotOptions = getPivotOptions(currentSubjectId);

  /**
   * Open on the first pivot rather than on nothing.
   *
   * Starting at `null` meant the panel's whole card area was blank until the user guessed that the chips
   * were clickable — captured at 920x620, roughly two thirds of the panel was empty space below three
   * small chips, which reads as a broken panel rather than as an invitation. The cards ARE the feature,
   * so one is shown immediately and the chips then read as "or pivot somewhere else".
   *
   * `useState` initialiser, not an effect: an effect would render the empty state for one frame first,
   * which is the flash of blankness this is meant to remove.
   */
  const [selectedPivotId, setSelectedPivotId] = useState<string | null>(
    () => pivotOptions[0]?.id ?? null,
  );
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());
  const [pinnedCards, setPinnedCards] = useState<Set<string>>(new Set());
  const modules = selectedPivotId
    ? buildPivotModules(currentSubjectId, selectedPivotId)
    : [];

  const handlePivotSelect = (pivotId: string) => {
    setSelectedPivotId(pivotId);
    setFlippedCards(new Set()); // Reset flips when switching pivots
  };

  const handleCardClick = (index: number) => {
    setFlippedCards(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handlePin = (cardId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't flip the card
    setPinnedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
    onPin(cardId);
  };

  return (
    <div className="imagine-root">
      {/* Pivot Picker */}
      <div className="imagine-picker">
        <h2 className="imagine-picker__title">Explore Lateral Pivots</h2>
        <div className="imagine-picker__chips">
          {pivotOptions.map(opt => {
            const name = labelOf?.(opt.id);
            return (
              <button
                key={opt.id}
                className="imagine-chip"
                onClick={() => handlePivotSelect(opt.id)}
                aria-pressed={selectedPivotId === opt.id}
                /* The sentence is still reachable, as the tooltip, when the chip shows a name. */
                title={name ? opt.label : undefined}
              >
                <span className="imagine-chip__label">{name ?? opt.label}</span>
                <span className="imagine-chip__reason">{opt.reason}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Flip Cards */}
      {modules.length > 0 && (
        <div className="imagine-cards">
          {modules.map((module, i) => {
            const cardId = `${currentSubjectId}-${selectedPivotId}-${module.kind}-${i}`;
            const isFlipped = flippedCards.has(i);
            const isPinned = pinnedCards.has(cardId);

            return (
              <FlipCard
                key={cardId}
                module={module}
                isFlipped={isFlipped}
                isPinned={isPinned}
                onFlip={() => handleCardClick(i)}
                onPin={(e) => handlePin(cardId, e)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FlipCardProps {
  module: PivotModule;
  isFlipped: boolean;
  isPinned: boolean;
  onFlip: () => void;
  onPin: (e: React.MouseEvent) => void;
}

function FlipCard({ module, isFlipped, isPinned, onFlip, onPin }: FlipCardProps) {
  const isPinnable = true; // All cards can be pinned

  return (
    <div
      className={`imagine-card-container ${isFlipped ? 'is-flipped' : ''} ${isPinned ? 'is-pinned' : ''}`}
      onClick={onFlip}
    >
      <div className="imagine-card-inner">
        {/* Front Face */}
        <div className="imagine-card-face imagine-card-face--front">
          <div className="imagine-card-header">
            <span className="imagine-card-kind">{module.title}</span>
            {isPinnable && (
              <button
                className="imagine-card-pin"
                onClick={onPin}
                aria-label={isPinned ? 'Unpin card' : 'Pin to Library'}
                title={isPinned ? 'Unpin' : 'Pin to Library'}
              >
                {isPinned ? '📌' : '○'}
              </button>
            )}
          </div>

          <div className="imagine-card-content">
            {module.kind === 'prompt' && (
              <>
                <div className="imagine-card-title">Question</div>
                <div className="imagine-card-text imagine-card-text--primary">
                  {module.content}
                </div>
              </>
            )}

            {module.kind === 'pearl' && (
              <>
                <div className="imagine-card-title">{module.title}</div>
                <div className="imagine-card-text">{module.content}</div>
              </>
            )}

            {module.kind === 'discriminator' && (
              <>
                <div className="imagine-card-title">{module.title}</div>
                <div className="imagine-card-text">{module.content}</div>
              </>
            )}

            {module.kind === 'bridge' && (
              <>
                <div className="imagine-card-title">{module.title}</div>
                <div className="imagine-card-text">{module.content}</div>
              </>
            )}
          </div>

          {module.secondary && (
            <div className="imagine-card-hint">Tap to reveal</div>
          )}
        </div>

        {/* Back Face */}
        <div className="imagine-card-face imagine-card-face--back">
          <div className="imagine-card-header">
            <span className="imagine-card-kind">{module.title}</span>
            {isPinnable && (
              <button
                className="imagine-card-pin"
                onClick={onPin}
                aria-label={isPinned ? 'Unpin card' : 'Pin to Library'}
                title={isPinned ? 'Unpin' : 'Pin to Library'}
              >
                {isPinned ? '📌' : '○'}
              </button>
            )}
          </div>

          <div className="imagine-card-content">
            {module.kind === 'prompt' && module.secondary && (
              <>
                <div className="imagine-card-title">Answer</div>
                <div className="imagine-card-text imagine-card-text--primary">
                  {module.secondary}
                </div>
              </>
            )}

            {module.kind === 'pearl' && (
              <>
                <div className="imagine-card-title">Clinical Hook</div>
                <div className="imagine-card-text">{module.content}</div>
              </>
            )}

            {module.kind === 'discriminator' && module.secondary && (
              <>
                <div className="imagine-card-title">The Key Difference</div>
                <div className="imagine-card-text">{module.secondary}</div>
              </>
            )}

            {module.kind === 'bridge' && module.secondary && (
              <>
                <div className="imagine-card-title">How They Connect</div>
                <div className="imagine-card-text">{module.secondary}</div>
              </>
            )}
          </div>

          <div className="imagine-card-hint">Tap to flip back</div>
        </div>
      </div>
    </div>
  );
}
