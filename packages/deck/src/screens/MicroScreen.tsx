import { useReducedMotion } from 'motion/react';
import { lazy, Suspense, useState } from 'react';
import { useDeck } from '../state/store.js';
import { MicroDeck } from './MicroDeck.js';

// The WebGL face ships as its own chunk — phones that never open micro mode
// (or can't run it) never download three.js.
const Micro3D = lazy(() => import('./Micro3D.js'));

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * Picks the device face: the WebGL device when the platform can carry it,
 * the CSS device otherwise (no WebGL2, reduced motion, or by choice in
 * Settings). Both render the same micro-model brain.
 */
export function MicroScreen() {
  const rendering = useDeck((state) => state.settings.rendering);
  const reduced = useReducedMotion() ?? false;
  const [webgl] = useState(hasWebGL2);

  if (rendering !== '3d' || reduced || !webgl) return <MicroDeck />;
  return (
    <Suspense fallback={<MicroDeck />}>
      <Micro3D />
    </Suspense>
  );
}
