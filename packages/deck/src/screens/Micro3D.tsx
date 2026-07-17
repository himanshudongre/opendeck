import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Session } from '@opendeck/protocol';
import { controller } from '../lib/controller.js';
import { hapticTick } from '../lib/haptics.js';
import { playDetent, playKeyDown, playKeyUp } from '../lib/sound.js';
import {
  useJogFire,
  useKnobModel,
  useMicroModel,
  useVoiceBar,
  type KnobModel,
  type MicroModel,
} from '../state/micro-model.js';
import type { ActionKeyBinding, JogDirection } from '../state/layouts.js';
import { statusLabel } from '../lib/format.js';
import { useDeck } from '../state/store.js';

/**
 * The WebGL face of the micro: the same brain as the CSS device
 * (micro-model.ts), rendered as physically-based hardware — clearcoat caps
 * over glowing LEDs, a knurled aluminum knob, a sprung joystick — under
 * studio lighting. A visually-hidden DOM layer mirrors every control so
 * screen readers and tests see the same machine.
 */

const CAP = '#1e2128';
const PLATE = '#15171c';
const BODY = '#101216';
const KEY_TRAVEL = 0.16;
const LONG_PRESS_MS = 450;

/**
 * True while a finger is on a control (key, knob, stick). The page-swipe
 * gesture on the wrapper div checks this so a stick flick or knob drag is
 * never mistaken for a swipe.
 */
const controlTouch = { active: false };

/**
 * How far to spread the rows so the device fills the viewport instead of
 * floating in letterbox space. 1 on tablets/landscape; up to 1.5 on tall
 * phone screens. Keys stay square — only the pitch between rows grows,
 * which also makes touch targets easier to hit.
 */
function stretchFor(width: number, height: number): number {
  return THREE.MathUtils.clamp((height / Math.max(1, width)) * (8.6 / 11.2) * 0.92, 1, 1.5);
}

/** Reads the live theme's status colors off the document root. */
function themeColor(token: string, fallback: string): THREE.Color {
  const raw =
    typeof getComputedStyle === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return new THREE.Color(raw === '' ? fallback : raw);
}

function useStatusColors(): Record<Session['status'] | 'brass' | 'idle', THREE.Color> {
  return useMemo(
    () => ({
      working: themeColor('--st-working', '#5cadff'),
      thinking: themeColor('--st-thinking', '#b48cff'),
      waiting_permission: themeColor('--st-waiting', '#ffb454'),
      waiting_input: themeColor('--st-waiting', '#ffb454'),
      done: themeColor('--st-done', '#3ecf8e'),
      error: themeColor('--st-error', '#ff5d5d'),
      idle: new THREE.Color('#3a3f49'),
      disconnected: new THREE.Color('#3a3f49'),
      brass: themeColor('--brass', '#d8b36a'),
    }),
    [],
  );
}

function useSwitchFeel(): { down: () => void; up: () => void; detent: () => void } {
  const settings = useDeck((state) => state.settings);
  return {
    down: () => {
      hapticTick(settings.haptics);
      playKeyDown(settings.sound);
    },
    up: () => {
      hapticTick(settings.haptics, 6);
      playKeyUp(settings.sound);
    },
    detent: () => {
      hapticTick(settings.haptics);
      playDetent(settings.sound);
    },
  };
}

/** One glyph texture, drawn once per (glyph, color) pair. */
const GLYPHS: Record<string, string> = {
  check: '✓',
  x: '✕',
  zap: '⚡',
  play: '▶',
  stop: '▪',
  'arrow-up-right': '↗',
  'message-plus': '+',
  'git-branch': '⌥',
  refresh: '↻',
  search: '○',
  terminal: '>',
  'test-tube': '▽',
  wrench: '⚙',
  hammer: '⚒',
};

function makeGlyphTexture(glyph: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.font = '64px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

const capGeometry = new RoundedBoxGeometry(1.52, 0.5, 1.52, 4, 0.16);
const wideCapGeometry = new RoundedBoxGeometry(1.52, 0.42, 1.02, 4, 0.14);
const micGeometry = new RoundedBoxGeometry(4.2, 0.42, 1.02, 4, 0.14);

interface PressableProps {
  position: [number, number, number];
  geometry: THREE.BufferGeometry;
  disabled?: boolean;
  emissive?: THREE.Color;
  emissivePulse?: boolean;
  glyphTexture?: THREE.CanvasTexture;
  outline?: THREE.Color;
  /** Selected caps sit proud of their neighbors so the choice is visible. */
  raised?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onDown?: () => void;
  onUp?: () => void;
}

/** A keycap that travels on press with LED glow bleeding through the cap. */
function PressableKey({
  position,
  geometry,
  disabled = false,
  emissive,
  emissivePulse = false,
  glyphTexture,
  outline,
  raised = false,
  onPress,
  onLongPress,
  onDown,
  onUp,
}: PressableProps) {
  const group = useRef<THREE.Group>(null);
  const led = useRef<THREE.Mesh>(null);
  const [pressed, setPressed] = useState(false);
  const longTimer = useRef<number | undefined>(undefined);
  const longFired = useRef(false);
  const spring = useRef({ y: 0, v: 0 });

  useFrame((state, delta) => {
    if (!group.current) return;
    const rest = raised ? 0.08 : 0;
    const target = pressed && !disabled ? -KEY_TRAVEL : rest;
    // A real spring, not a lerp: critically damped going down (instant
    // bottom-out), underdamped on release so the cap overshoots a hair and
    // settles — the wobble that makes fidgeting satisfying.
    const s = spring.current;
    const stiffness = pressed ? 900 : 380;
    const damping = pressed ? 60 : 15;
    const dt = Math.min(delta, 0.05);
    s.v += (-stiffness * (s.y - target) - damping * s.v) * dt;
    s.y += s.v * dt;
    group.current.position.y = s.y;
    if (led.current && emissive) {
      const material = led.current.material as THREE.MeshStandardMaterial;
      const pulse = emissivePulse ? 1.7 + Math.sin(state.clock.elapsedTime * 3.2) * 0.8 : 2.1;
      material.emissiveIntensity = pulse;
    }
  });

  const start = (event: ThreeEvent<PointerEvent>): void => {
    if (disabled) return;
    event.stopPropagation();
    controlTouch.active = true;
    setPressed(true);
    onDown?.();
    longFired.current = false;
    if (onLongPress) {
      longTimer.current = window.setTimeout(() => {
        longFired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    }
  };
  const end = (event: ThreeEvent<PointerEvent>): void => {
    if (disabled) return;
    event.stopPropagation();
    controlTouch.active = false;
    setPressed(false);
    window.clearTimeout(longTimer.current);
    onUp?.();
    if (!longFired.current) onPress?.();
  };

  // Handlers live on the group, so the whole socket — cap, skirt, and the
  // recess around it — is the touch target, not just the cap's top face.
  return (
    <group
      position={position}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={() => {
        controlTouch.active = false;
        setPressed(false);
        window.clearTimeout(longTimer.current);
      }}
    >
      {/* Socket recess */}
      <mesh position={[0, -0.18, 0]} receiveShadow>
        <boxGeometry args={[1.78, 0.14, 1.78]} />
        <meshStandardMaterial color={BODY} roughness={0.9} metalness={0.2} />
      </mesh>
      <group ref={group}>
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={disabled ? '#191b20' : CAP}
            roughness={0.38}
            metalness={0.12}
            clearcoat={0.75}
            clearcoatRoughness={0.22}
            transparent={disabled}
            opacity={disabled ? 0.75 : 1}
            {...(outline ? { sheen: 0.4, sheenColor: outline } : {})}
          />
        </mesh>
        {emissive && (
          <mesh ref={led} position={[0, 0.24, 0]}>
            <sphereGeometry args={[0.13, 24, 24]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={0.9}
              roughness={0.3}
            />
          </mesh>
        )}
        {glyphTexture && (
          <mesh position={[0, 0.26, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.62, 0.62]} />
            <meshBasicMaterial map={glyphTexture} transparent depthWrite={false} />
          </mesh>
        )}
        {outline && (
          <mesh position={[0, 0.27, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 0.71, 40]} />
            <meshBasicMaterial color={outline} transparent opacity={0.95} toneMapped={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

/** The knurled reasoning knob; circular drag with detent snap. */
function Knob({
  knob,
  position,
  feel,
}: {
  knob: KnobModel;
  position: [number, number, number];
  feel: { detent: () => void };
}) {
  const { axis, valueIndex, knobDeg, setIndex } = knob;
  const spin = useRef<THREE.Group>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, index: 0 });
  const colors = useStatusColors();

  useFrame((_, delta) => {
    if (!spin.current) return;
    const target3 = THREE.MathUtils.degToRad(-knobDeg);
    spin.current.rotation.y = THREE.MathUtils.damp(spin.current.rotation.y, target3, 16, delta);
  });

  const knurl = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#666';
      ctx.fillRect(0, 0, 256, 32);
      ctx.fillStyle = '#aaa';
      for (let x = 0; x < 256; x += 8) ctx.fillRect(x, 0, 3, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = 4;
    return texture;
  }, []);

  // Touch-first drag model: slide up/down anywhere on the knob to step
  // through detents (26 px per detent), the way plugin knobs work. Precise,
  // no occlusion by your own finger, works one-handed.
  const indexFromPointer = (clientY: number): number =>
    dragStart.current.index + Math.round((dragStart.current.y - clientY) / 26);

  return (
    <group
      position={position}
      onPointerDown={(event) => {
        if (!axis) return;
        event.stopPropagation();
        controlTouch.active = true;
        dragStart.current = { y: event.nativeEvent.clientY, index: valueIndex };
        setDragging(true);
      }}
    >
      <mesh position={[0, -0.14, 0]} receiveShadow>
        <cylinderGeometry args={[0.95, 0.98, 0.12, 48]} />
        <meshStandardMaterial color={BODY} roughness={0.85} />
      </mesh>
      <group ref={spin}>
        <mesh castShadow>
          <cylinderGeometry args={[0.82, 0.86, 0.55, 64]} />
          <meshStandardMaterial
            color="#262a32"
            metalness={0.85}
            roughness={0.4}
            bumpMap={knurl}
            bumpScale={0.6}
          />
        </mesh>
        <mesh position={[0, 0.28, 0]}>
          <cylinderGeometry args={[0.62, 0.62, 0.06, 48]} />
          <meshStandardMaterial color="#1b1e24" metalness={0.6} roughness={0.5} />
        </mesh>
        {/* Brass indicator */}
        <mesh position={[0, 0.3, -0.62]}>
          <boxGeometry args={[0.07, 0.04, 0.3]} />
          <meshStandardMaterial
            color={colors.brass}
            emissive={colors.brass}
            emissiveIntensity={1.5}
          />
        </mesh>
      </group>
      {dragging && (
        <mesh
          position={[0, 0.4, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(event) => {
            setIndex(indexFromPointer(event.nativeEvent.clientY), false, feel.detent);
          }}
          onPointerUp={() => {
            controlTouch.active = false;
            setDragging(false);
            setIndex(valueIndex, true);
          }}
          onPointerLeave={() => {
            controlTouch.active = false;
            setDragging(false);
            setIndex(valueIndex, true);
          }}
        >
          <planeGeometry args={[60, 60]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
    </group>
  );
}

/** The joystick: drag to tilt, release to fire the flicked workflow. */
function Stick({
  targetId,
  position,
  feel,
}: {
  targetId: string | undefined;
  position: [number, number, number];
  feel: { detent: () => void };
}) {
  const { fire } = useJogFire(targetId);
  const tiltGroup = useRef<THREE.Group>(null);
  const tilt = useRef({ x: 0, z: 0 });
  const [dragging, setDragging] = useState(false);

  const stickSpring = useRef({ x: 0, vx: 0, z: 0, vz: 0 });

  useFrame((_, delta) => {
    if (!tiltGroup.current) return;
    const targetX = dragging ? tilt.current.x : 0;
    const targetZ = dragging ? tilt.current.z : 0;
    // Underdamped return: a flicked stick snaps back and quivers like the
    // real spring-loaded part before coming to rest.
    const s = stickSpring.current;
    const stiffness = dragging ? 800 : 320;
    const damping = dragging ? 55 : 9;
    const dt = Math.min(delta, 0.05);
    s.vx += (-stiffness * (s.x - targetX) - damping * s.vx) * dt;
    s.x += s.vx * dt;
    s.vz += (-stiffness * (s.z - targetZ) - damping * s.vz) * dt;
    s.z += s.vz * dt;
    tiltGroup.current.rotation.x = s.x;
    tiltGroup.current.rotation.z = s.z;
  });

  // Raw pointer deltas in plate space: +x is screen-right, +z screen-down.
  const delta = useRef({ dx: 0, dz: 0 });

  const release = (): void => {
    controlTouch.active = false;
    setDragging(false);
    const { dx, dz } = delta.current;
    delta.current = { dx: 0, dz: 0 };
    tilt.current = { x: 0, z: 0 };
    if (targetId === undefined) return;
    if (Math.max(Math.abs(dx), Math.abs(dz)) < 0.18) return;
    const direction: JogDirection =
      Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : dz > 0 ? 'down' : 'up';
    feel.detent();
    fire(direction);
  };

  return (
    <group
      position={position}
      onPointerDown={(event) => {
        event.stopPropagation();
        controlTouch.active = true;
        setDragging(true);
      }}
    >
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <cylinderGeometry args={[0.92, 0.95, 0.14, 48]} />
        <meshStandardMaterial color={BODY} roughness={0.9} />
      </mesh>
      <group ref={tiltGroup}>
        <mesh position={[0, 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.22, 0.5, 24]} />
          <meshStandardMaterial color="#22252c" metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.56, 0]} castShadow>
          <sphereGeometry args={[0.42, 32, 32]} />
          <meshPhysicalMaterial
            color="#2b2f38"
            clearcoat={1}
            clearcoatRoughness={0.12}
            roughness={0.3}
          />
        </mesh>
      </group>
      {dragging && (
        <mesh
          position={[0, 0.7, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(event) => {
            const dx = THREE.MathUtils.clamp(event.point.x - position[0], -0.6, 0.6);
            const dz = THREE.MathUtils.clamp(event.point.z - position[2], -0.6, 0.6);
            delta.current = { dx, dz };
            tilt.current = { x: dz * 0.7, z: -dx * 0.7 };
          }}
          onPointerUp={release}
          onPointerLeave={release}
        >
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
    </group>
  );
}

/** The e-ink readout strip as a live canvas texture. */
function Lcd({
  line,
  stats,
  urgent,
  position,
}: {
  line: string;
  stats: string;
  urgent: boolean;
  position: [number, number, number];
}) {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.anisotropy = 4;
    return t;
  }, [canvas]);

  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, 1024, 160);
    ctx.font = '600 52px "IBM Plex Mono", monospace';
    ctx.fillStyle = urgent ? '#ffb454' : '#d7dbe2';
    ctx.fillText(line.length > 34 ? `${line.slice(0, 33)}…` : line, 28, 70);
    ctx.font = '36px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#8a909c';
    ctx.fillText(stats, 28, 126);
    texture.needsUpdate = true;
  }, [canvas, texture, line, stats, urgent]);

  return (
    <group position={position}>
      <mesh receiveShadow>
        <boxGeometry args={[7.5, 0.18, 1.55]} />
        <meshStandardMaterial color="#07080a" roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.2, 1.22]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Scene root: plate, controls, lighting, pointer parallax. */
function DeviceScene({
  model,
  knob,
  voice,
}: {
  model: MicroModel;
  knob: KnobModel;
  voice: ReturnType<typeof useVoiceBar>;
}) {
  const {
    attention,
    pending,
    keySlots,
    commandKeys,
    bindingArmed,
    fireBinding,
    openFocus,
    setSelectedId,
    lcdLine,
    lcdStats,
  } = model;
  const colors = useStatusColors();
  const feel = useSwitchFeel();
  const rig = useRef<THREE.Group>(null);
  const { scene, gl } = useThree();
  const size = useThree((state) => state.size);
  // Spread the rows to fill the viewport; keys stay square. Rows spread a
  // touch more than the plate so the bezels stay slim.
  const zs = stretchFor(size.width, size.height);
  const plateZ = zs * 0.88;
  const rz = zs * 1.08;

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    // Studio reflections, not studio floodlight: keep the room dim so the
    // anodized blacks stay black and the LEDs carry the scene.
    scene.environmentIntensity = 0.45;
    return () => {
      env.texture.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);

  useFrame((state, delta) => {
    if (!rig.current) return;
    // Parallax fidget: a whisper of lean toward the finger. Kept subtle so
    // it reads as depth, never as the UI moving away from a touch.
    rig.current.rotation.x = THREE.MathUtils.damp(
      rig.current.rotation.x,
      state.pointer.y * -0.025,
      6,
      delta,
    );
    rig.current.rotation.z = THREE.MathUtils.damp(
      rig.current.rotation.z,
      state.pointer.x * 0.02,
      6,
      delta,
    );
  });

  const glyphTextures = useMemo(() => {
    const cache = new Map<string, THREE.CanvasTexture>();
    return (icon: string | undefined, accent: string): THREE.CanvasTexture => {
      const glyph = icon !== undefined && icon in GLYPHS ? GLYPHS[icon] : '●';
      const key = `${glyph ?? ''}-${accent}`;
      let texture = cache.get(key);
      if (!texture) {
        texture = makeGlyphTexture(glyph ?? '●', accent);
        cache.set(key, texture);
      }
      return texture;
    };
  }, []);

  const accentCss = (binding: ActionKeyBinding): string => {
    if (binding.accent === 'done') return `#${colors.done.getHexString()}`;
    if (binding.accent === 'error') return `#${colors.error.getHexString()}`;
    if (binding.accent === 'waiting') return `#${colors.waiting_permission.getHexString()}`;
    if (binding.accent === 'working') return `#${colors.working.getHexString()}`;
    return '#9aa1ad';
  };

  const agentKey = (slot: number, position: [number, number, number]): React.ReactElement => {
    const session = keySlots[slot];
    const status = session?.status;
    return (
      <PressableKey
        key={session?.id ?? `empty-${String(slot)}`}
        position={position}
        geometry={capGeometry}
        disabled={session === undefined}
        {...(status !== undefined ? { emissive: colors[status] } : {})}
        emissivePulse={status === 'waiting_permission' || status === 'waiting_input'}
        {...(session !== undefined && session.id === attention?.id
          ? { outline: colors.brass, raised: true }
          : {})}
        onDown={feel.down}
        onUp={feel.up}
        onPress={() => setSelectedId(session?.id)}
        onLongPress={() => {
          if (session) openFocus(session.id);
        }}
      />
    );
  };

  const attentionColor = attention ? colors[attention.status] : colors.idle;

  return (
    <group ref={rig}>
      {/* Deskglow: the attention status bleeding onto the desk */}
      <pointLight
        position={[0, 0.4, 4.6]}
        color={attentionColor}
        intensity={pending ? 6 : 2.5}
        distance={7}
        decay={2}
      />

      {/* Body slab, depth-scaled with the row stretch */}
      <mesh position={[0, -0.32, 0]} scale={[1, 1, plateZ]} castShadow receiveShadow>
        <boxGeometry args={[8.6, 0.5, 11.2]} />
        <meshStandardMaterial color={BODY} metalness={0.55} roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.05, 0]} scale={[1, 1, plateZ]} receiveShadow>
        <boxGeometry args={[8.2, 0.1, 10.8]} />
        <meshStandardMaterial color={PLATE} metalness={0.7} roughness={0.5} />
      </mesh>

      <Lcd
        line={lcdLine}
        stats={lcdStats}
        urgent={pending !== undefined}
        position={[0, 0.1, -3.78 * rz]}
      />

      {/* Row A: knob · two agent keys · stick */}
      <Knob knob={knob} position={[-2.9, 0.15, -2 * rz]} feel={feel} />
      {agentKey(0, [-0.95, 0.15, -2 * rz])}
      {agentKey(1, [0.95, 0.15, -2 * rz])}
      <Stick targetId={attention?.id} position={[2.9, 0.15, -2 * rz]} feel={feel} />

      {/* Row B: four agent keys */}
      {agentKey(2, [-2.9, 0.15, -0.1 * rz])}
      {agentKey(3, [-0.95, 0.15, -0.1 * rz])}
      {agentKey(4, [0.95, 0.15, -0.1 * rz])}
      {agentKey(5, [2.9, 0.15, -0.1 * rz])}

      {/* Row C: command caps */}
      {commandKeys.map((binding, index) => (
        <PressableKey
          key={binding.id}
          position={[-2.9 + index * 1.94, 0.12, 1.7 * rz]}
          geometry={wideCapGeometry}
          disabled={!bindingArmed(binding)}
          glyphTexture={glyphTextures(binding.icon, accentCss(binding))}
          onDown={feel.down}
          onUp={feel.up}
          onPress={() => fireBinding(binding)}
        />
      ))}
      <PressableKey
        position={[2.92, 0.12, 1.7 * rz]}
        geometry={wideCapGeometry}
        disabled={attention === undefined}
        glyphTexture={glyphTextures('arrow-up-right', '#9aa1ad')}
        onDown={feel.down}
        onUp={feel.up}
        onPress={() => {
          if (attention) openFocus(attention.id);
        }}
      />

      {/* Row D: push-to-talk bar · new session */}
      <PressableKey
        position={[-0.9, 0.12, 3.25 * rz]}
        geometry={micGeometry}
        disabled={!voice.available}
        {...(voice.listening ? { emissive: colors.waiting_permission, emissivePulse: true } : {})}
        onDown={() => {
          feel.down();
          voice.begin();
        }}
        onUp={() => {
          feel.up();
          voice.stop();
        }}
      />
      <PressableKey
        position={[2.92, 0.12, 3.25 * rz]}
        geometry={wideCapGeometry}
        glyphTexture={glyphTextures('message-plus', '#9aa1ad')}
        onDown={feel.down}
        onUp={feel.up}
        onPress={() => controller.action({ kind: 'new_session', args: { harness: 'claude' } })}
      />

      {/* Lighting rig */}
      <ambientLight intensity={0.25} />
      <SunLight />
      <directionalLight position={[-6, 5, -4]} intensity={0.35} color="#8fa3c8" />
    </group>
  );
}

/**
 * Frames the whole device for the current viewport: picks the camera
 * distance so the plate fits both axes, then tilts down at it like a
 * desk-height eye line. Runs on every resize.
 */
function FrameCamera() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  useEffect(() => {
    // Fit by measurement, not trigonometry: project the plate's corners and
    // walk the camera in or out until the worst corner sits at ~0.97 NDC.
    // Near top-down (74°) — the way you actually look at a pad under your
    // fingers — so controls render large and nothing is lost to perspective.
    const zs = stretchFor(size.width, size.height);
    const corners = [
      new THREE.Vector3(4.5, 0, 5.9 * zs * 0.88),
      new THREE.Vector3(-4.5, 0, 5.9 * zs * 0.88),
      new THREE.Vector3(4.5, 0.4, -5.9 * zs * 0.88),
      new THREE.Vector3(-4.5, 0.4, -5.9 * zs * 0.88),
    ];
    const elevation = THREE.MathUtils.degToRad(74);
    let distance = 14;
    for (let step = 0; step < 24; step += 1) {
      camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance + 0.4);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const worst = Math.max(
        ...corners.map((corner) => {
          const projected = corner.clone().project(camera);
          return Math.max(Math.abs(projected.x), Math.abs(projected.y));
        }),
      );
      if (worst >= 0.95 && worst <= 0.985) break;
      distance *= worst / 0.97;
    }
  }, [camera, size]);
  return null;
}

/** Key light with a hand-tuned shadow frustum (dashed props don't typecheck). */
function SunLight() {
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const sun = light.current;
    if (!sun) return;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera;
    cam.near = 1;
    cam.far = 25;
    cam.left = -8;
    cam.right = 8;
    cam.top = 8;
    cam.bottom = -8;
    cam.updateProjectionMatrix();
  }, []);
  return <directionalLight ref={light} position={[4, 9, 3]} intensity={2.1} castShadow />;
}

/** Visually-hidden mirror of every control for screen readers and tests. */
function A11yLayer({ model, knob }: { model: MicroModel; knob: KnobModel }) {
  const {
    attention,
    pending,
    keySlots,
    commandKeys,
    bindingArmed,
    bindingLabel,
    fireBinding,
    openFocus,
    setSelectedId,
    connection,
  } = model;
  return (
    <div className="sr-only">
      {keySlots.map((session, index) =>
        session ? (
          <button
            key={session.id}
            type="button"
            onClick={() => setSelectedId(session.id)}
            onDoubleClick={() => openFocus(session.id)}
          >
            {`${session.title} — ${statusLabel(session.status)}`}
          </button>
        ) : (
          <span key={`empty-${String(index)}`} />
        ),
      )}
      {commandKeys.map((binding) => (
        <button
          key={binding.id}
          type="button"
          disabled={!bindingArmed(binding)}
          onClick={() => fireBinding(binding)}
        >
          {bindingLabel(binding)}
        </button>
      ))}
      <button
        type="button"
        disabled={attention === undefined}
        onClick={() => {
          if (attention) openFocus(attention.id);
        }}
      >
        Open the selected agent
      </button>
      <div
        role="slider"
        aria-label={
          knob.axis && attention ? `${knob.axis.label} dial for ${attention.title}` : 'Dial'
        }
        aria-valuemin={0}
        aria-valuemax={knob.steps - 1}
        aria-valuenow={knob.valueIndex}
        {...(knob.axis?.values[knob.valueIndex] === undefined
          ? {}
          : { 'aria-valuetext': knob.axis.values[knob.valueIndex] })}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
            knob.setIndex(knob.valueIndex + 1, true);
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
            knob.setIndex(knob.valueIndex - 1, true);
        }}
      />
      <p role="status">{`Connection: ${connection}${pending ? ` · ${pending.tool.name} needs approval` : ''}`}</p>
    </div>
  );
}

/** The under-canvas footer: pages, knob readout, silkscreen. */
function Footer({ model, knobText }: { model: MicroModel; knobText: string }) {
  const { page, pageCount, setPage } = model;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1.5 z-10 flex flex-col items-center">
      {pageCount > 1 && (
        <div className="pointer-events-auto flex items-center">
          {Array.from({ length: pageCount }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Agent page ${String(index + 1)}`}
              className="flex h-9 w-9 items-center justify-center"
              onClick={() => setPage(index)}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: index === page ? 'var(--brass)' : 'var(--hairline)' }}
              />
            </button>
          ))}
        </div>
      )}
      <p
        aria-hidden
        className="font-data text-[12px] uppercase tracking-[0.18em]"
        style={{ color: 'var(--ink-2)' }}
      >
        {knobText}
      </p>
    </div>
  );
}

export default function Micro3D() {
  const setEditMode = useDeck((state) => state.setEditMode);
  const model = useMicroModel();
  const knob = useKnobModel(model.attention);
  const voice = useVoiceBar(model.attention?.id);
  const wrapper = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Swipe-to-page listens natively on the wrapper: R3F manages pointer
  // capture on its canvas, which keeps captured drags out of React's
  // delegated events — native listeners see everything.
  useEffect(() => {
    const node = wrapper.current;
    if (!node) return;
    let start: { x: number; y: number; control: boolean } | undefined;
    const down = (event: PointerEvent): void => {
      // R3F handles the canvas first, so controlTouch is already set here —
      // a knob drag or stick flick never becomes a swipe.
      start = { x: event.clientX, y: event.clientY, control: controlTouch.active };
      if (event.target === node) {
        holdTimer.current = window.setTimeout(() => setEditMode(true), 600);
      }
    };
    const up = (event: PointerEvent): void => {
      window.clearTimeout(holdTimer.current);
      const from = start;
      start = undefined;
      if (!from || from.control || controlTouch.active) return;
      const m = modelRef.current;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      // No time limit: a mostly-horizontal drag across empty plate has no
      // other meaning, however leisurely the finger.
      if (Math.abs(dx) > 64 && Math.abs(dy) < Math.abs(dx) * 0.6 && m.pageCount > 1) {
        // Swipe the plate to page through agents, like flipping the pad over.
        const next = m.page + (dx < 0 ? 1 : -1);
        m.setPage(Math.max(0, Math.min(m.pageCount - 1, next)));
      }
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
    };
  }, [setEditMode]);

  const knobText = knob.axis
    ? `${knob.axis.label} · ${knob.axis.values[knob.valueIndex] ?? ''}`
    : 'dial';

  return (
    <div
      ref={wrapper}
      className="relative h-full w-full touch-none"
      data-page={model.page}
      onContextMenu={(event) => {
        event.preventDefault();
        setEditMode(true);
      }}
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 10.5, 8.2], fov: 34 }}
        onCreated={(state) => {
          // Debug/E2E surface, like __OPENDECK_STORE__: lets a console or
          // Playwright inspect the live scene.
          (globalThis as Record<string, unknown>).__OPENDECK_SCENE__ = state;
        }}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
        aria-label="OpenDeck micro device"
      >
        <FrameCamera />
        <DeviceScene model={model} knob={knob} voice={voice} />
        {/* The glow is the product: LEDs, LCD, and deskglow all bloom for
            real instead of faking it with sprites. Multisampling off — the
            bloom pass smooths edges enough, and mobile GPUs feel the MSAA. */}
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.55} intensity={0.85} radius={0.72} />
          <Vignette eskil={false} offset={0.14} darkness={0.6} />
        </EffectComposer>
      </Canvas>
      <A11yLayer model={model} knob={knob} />
      {voice.listening && voice.transcript.length > 0 && (
        <div className="panel absolute bottom-16 left-1/2 z-20 w-64 -translate-x-1/2 px-3 py-2">
          <p className="text-xs text-ink-1">{voice.transcript}</p>
        </div>
      )}
      <Footer model={model} knobText={knobText} />
    </div>
  );
}
