/**
 * Companion picker UI.
 * Two stock GLB cards + one custom upload card.
 * Keyboard accessible (radio semantics, arrow keys).
 */

import { Canvas } from '@react-three/fiber';
import { Suspense, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useGLTF } from '@react-three/drei';
import { useApp } from '../state/store';
import { resolveStock, validateCustom } from './glbSource';
import './picker.css';

interface StockCardProps {
  id: 'male' | 'female';
  label: string;
  selected: boolean;
  onSelect: () => void;
  index: number;
  onArrowKey: (dir: 'left' | 'right') => void;
}

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} scale={1.6} position={[0, -0.9, 0]} />;
}

function StockCard({ id, label, selected, onSelect, index, onArrowKey }: StockCardProps) {
  const source = resolveStock(id);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onArrowKey('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onArrowKey('right');
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={`picker-card ${selected ? 'is-selected' : ''}`}
      role="radio"
      aria-checked={selected}
      tabIndex={index === 0 ? 0 : -1}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="picker-preview">
        <Canvas
          className="picker-canvas"
          camera={{ position: [0, 0, 3.2], fov: 35 }}
          dpr={[1, 1.5]}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={0.8} />
            <directionalLight position={[-5, 2, -5]} intensity={0.3} />
            <Model url={source.url} />
          </Suspense>
        </Canvas>
      </div>
      <div className="picker-label">{label}</div>
    </div>
  );
}

interface CustomCardProps {
  onArrowKey: (dir: 'left' | 'right') => void;
}

function CustomCard({ onArrowKey }: CustomCardProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = validateCustom(file);
    if (result.kind === 'invalid') {
      setError(result.message);
    } else {
      setError(null);
      // TODO: store custom source in state (out of scope for now).
      console.log('Custom source validated:', result);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onArrowKey('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onArrowKey('right');
    }
  };

  return (
    <div
      className="picker-card is-custom"
      role="radio"
      aria-checked={false}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="picker-upload-zone">
        <label htmlFor="custom-upload" className="picker-upload-label">
          Choose file
        </label>
        <input
          ref={inputRef}
          id="custom-upload"
          type="file"
          accept=".glb,.gltf,.zip"
          className="picker-upload-input"
          onChange={handleChange}
        />
        <p className="picker-upload-hint">
          GLB, GLTF, or ZIP of sprite sheets
          <br />
          Max 15MB
        </p>
        {error && <p className="picker-error">{error}</p>}
      </div>
    </div>
  );
}

export function Picker() {
  const character = useApp((s) => s.character);
  const setCharacter = useApp((s) => s.setCharacter);
  const rootRef = useRef<HTMLDivElement>(null);

  const cards: Array<{ id: 'male' | 'female'; label: string }> = [
    { id: 'male', label: 'Male' },
    { id: 'female', label: 'Female' },
  ];

  const handleArrowKey = (currentIndex: number, dir: 'left' | 'right') => {
    const totalCards = cards.length + 1; // stock cards + custom card
    let nextIndex = currentIndex + (dir === 'right' ? 1 : -1);
    if (nextIndex < 0) nextIndex = totalCards - 1;
    if (nextIndex >= totalCards) nextIndex = 0;

    // Focus the next card
    const cardElements = rootRef.current?.querySelectorAll('[role="radio"]');
    if (cardElements?.[nextIndex]) {
      (cardElements[nextIndex] as HTMLElement).focus();
    }
  };

  return (
    <div ref={rootRef} className="picker-root" role="radiogroup" aria-label="Companion picker">
      {cards.map((card, i) => (
        <StockCard
          key={card.id}
          id={card.id}
          label={card.label}
          selected={character === card.id}
          onSelect={() => setCharacter(card.id)}
          index={i}
          onArrowKey={(dir) => handleArrowKey(i, dir)}
        />
      ))}
      <CustomCard onArrowKey={(dir) => handleArrowKey(cards.length, dir)} />
      <p className="picker-attribution">
        Models by Denys Almaral, CC BY 4.0
      </p>
    </div>
  );
}
