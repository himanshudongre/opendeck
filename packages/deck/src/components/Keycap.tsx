import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { hapticTick } from '../lib/haptics.js';
import { playTick } from '../lib/sound.js';
import { useDeck } from '../state/store.js';

interface KeycapProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
  /** Glow color painted behind the cap while pressed. */
  glow?: string;
}

const LONG_PRESS_MS = 450;

/**
 * The atom of the whole deck: a frosted keycap with 120 ms spring press
 * physics, a haptic tick, and the synthesized key sound (SPEC §7.3).
 */
export function Keycap({
  children,
  onPress,
  onLongPress,
  label,
  disabled = false,
  className = '',
  glow,
}: KeycapProps) {
  const settings = useDeck((state) => state.settings);
  const reduced = useReducedMotion() ?? false;
  let longPressTimer: number | undefined;
  let longPressed = false;

  const startLongPress = (): void => {
    if (!onLongPress) return;
    longPressed = false;
    longPressTimer = window.setTimeout(() => {
      longPressed = true;
      hapticTick(settings.haptics, 16);
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const clearLongPress = (): void => {
    if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
  };

  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={`keycap relative touch-none select-none ${disabled ? 'opacity-40' : ''} ${className}`}
      {...(reduced || disabled ? {} : { whileTap: { y: 1, scale: 0.97 } })}
      transition={{ type: 'spring', duration: 0.12, bounce: 0.3 }}
      onPointerDown={() => {
        if (disabled) return;
        hapticTick(settings.haptics);
        playTick(settings.sound);
        startLongPress();
      }}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onClick={() => {
        if (disabled || longPressed) return;
        onPress?.();
      }}
    >
      {glow !== undefined && (
        <span
          aria-hidden
          className="tile-glow"
          style={{ '--glow-color': glow } as React.CSSProperties}
        />
      )}
      <span className="relative z-10 block h-full w-full">{children}</span>
    </motion.button>
  );
}
