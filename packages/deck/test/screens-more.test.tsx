import { serverMsg, type Session } from '@agentdeck/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { controller } from '../src/lib/controller.js';
import { EditOverlay } from '../src/screens/EditOverlay.js';
import { ThemeEditorScreen } from '../src/screens/ThemeEditorScreen.js';
import { useDeck } from '../src/state/store.js';
import { WORKSHOP } from '../src/state/themes.js';
import { Dial } from '../src/widgets/Dial.js';
import { JogPad } from '../src/widgets/JogPad.js';
import { VoiceKey } from '../src/widgets/VoiceKey.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    hubId: 'hub-1',
    harness: 'claude',
    mode: 'managed',
    title: 'profile page redesign',
    cwd: '/home/dev/app',
    status: 'working',
    statusSince: Date.now(),
    lastActivity: Date.now(),
    stats: { inputTokens: 10, outputTokens: 5, turns: 1, elapsedMs: 1000 },
    capabilities: ['prompt', 'set_effort'],
    ...overrides,
  };
}

beforeEach(() => {
  useDeck.getState().reset();
  useDeck.setState({ connection: 'connected' });
});

describe('EditOverlay', () => {
  it('switches presets, tile sizes, and widget visibility', () => {
    useDeck.getState().setEditMode(true);
    render(<EditOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Tablet' }));
    expect(useDeck.getState().layout.preset).toBe('tablet');

    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(useDeck.getState().layout.tileSize).toBe('L');

    const dialToggle = screen.getByLabelText('Dial') as HTMLInputElement | null;
    const checkbox = dialToggle ?? screen.getByText('Dial').querySelector('input');
    if (!checkbox) throw new Error('dial toggle missing');
    fireEvent.click(checkbox);
    expect(useDeck.getState().layout.widgets.dial).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Leave edit mode' }));
    expect(useDeck.getState().editMode).toBe(false);
  });
});

describe('ThemeEditorScreen', () => {
  it('applies token edits live and saves them as the custom theme', () => {
    render(<ThemeEditorScreen />);
    const brassInput = screen.getByLabelText('Brass color');
    fireEvent.change(brassInput, { target: { value: '#ffcc00' } });
    expect(document.documentElement.style.getPropertyValue('--brass')).toBe('#ffcc00');

    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }));
    expect(useDeck.getState().settings.customTheme?.brass).toBe('#ffcc00');
  });

  it('imports valid theme JSON and rejects garbage', () => {
    render(<ThemeEditorScreen />);
    const textarea = screen.getByLabelText('Paste theme JSON');
    fireEvent.change(textarea, { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText(/isn’t a valid theme/)).toBeDefined();

    fireEvent.change(textarea, { target: { value: JSON.stringify(WORKSHOP) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(document.documentElement.style.getPropertyValue('--surface-0')).toBe(WORKSHOP.surface0);
  });

  it('resets to a preset', () => {
    render(<ThemeEditorScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to void' }));
    expect(document.documentElement.style.getPropertyValue('--surface-0')).toBe('#000000');
  });
});

describe('Dial interactions', () => {
  it('steps detents from the keyboard and reports through set_effort', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    const setEffort = vi.spyOn(controller, 'setEffort').mockImplementation(() => undefined);
    render(<Dial />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(setEffort).toHaveBeenCalledWith({ sessionId: 'sess-1', axis: 'model', value: 'opus' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(setEffort).toHaveBeenLastCalledWith({
      sessionId: 'sess-1',
      axis: 'model',
      value: 'sonnet',
    });
    setEffort.mockRestore();
  });

  it('switches axes for claude sessions', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<Dial />);
    fireEvent.click(screen.getByRole('button', { name: /press to switch axis/ }));
    expect(screen.getByRole('slider', { name: /thinking dial/ })).toBeDefined();
  });

  it('renders an inert cap with no target', () => {
    render(<Dial />);
    expect(screen.getByText('no dial target')).toBeDefined();
  });
});

describe('JogPad flicks', () => {
  it('fires a prompt template on a decisive flick and ignores taps', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    const action = vi.spyOn(controller, 'action').mockImplementation(() => undefined);
    render(<JogPad />);
    const pad = screen.getByRole('group', { name: /Jog pad/ });

    fireEvent.pointerDown(pad, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(pad, { clientX: 52, clientY: 51 });
    expect(action).not.toHaveBeenCalled();

    fireEvent.pointerDown(pad, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(pad, { clientX: 50, clientY: 10 });
    expect(action).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      kind: 'prompt_template',
      args: { text: 'Run the failing tests and fix them.' },
    });

    fireEvent.pointerDown(pad, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(pad, { clientX: 110, clientY: 55 });
    expect(action).toHaveBeenLastCalledWith({
      sessionId: 'sess-1',
      kind: 'prompt_template',
      args: { text: 'Review the current diff and list problems before anything else.' },
    });
    action.mockRestore();
  });
});

describe('VoiceKey', () => {
  it('explains itself instead of failing on unsupported contexts', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<VoiceKey />);
    const key = screen.getByRole('button', { name: /Voice is unavailable|Hold to talk/ });
    fireEvent.pointerDown(key);
    expect(screen.getByRole('tooltip')).toBeDefined();
  });
});

describe('App shell', () => {
  it('routes unpaired connections to the pair screen', async () => {
    const init = vi.spyOn(controller, 'init').mockResolvedValue(undefined);
    useDeck.setState({ connection: 'unpaired' });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/isn’t paired yet/)).toBeDefined();
    });
    init.mockRestore();
  });

  it('shows the reconnect banner over the grid', async () => {
    const init = vi.spyOn(controller, 'init').mockResolvedValue(undefined);
    useDeck.setState({ connection: 'reconnecting' });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Reconnecting to the hub…')).toBeDefined();
    });
    expect(screen.getByText('No agents yet.')).toBeDefined();
    init.mockRestore();
  });

  it('routes to settings and the theme editor', async () => {
    const init = vi.spyOn(controller, 'init').mockResolvedValue(undefined);
    useDeck.setState({ connection: 'connected', screen: 'settings' });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeDefined();
    });
    useDeck.getState().setScreen('themes');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Theme editor' })).toBeDefined();
    });
    init.mockRestore();
  });
});
