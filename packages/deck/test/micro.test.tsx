import { serverMsg, type Session } from '@opendeck/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { controller } from '../src/lib/controller.js';
import { GridScreen } from '../src/screens/GridScreen.js';
import { MicroDeck } from '../src/screens/MicroDeck.js';
import { MicroScreen } from '../src/screens/MicroScreen.js';
import { LAYOUT_PRESETS } from '../src/state/layouts.js';
import { useDeck } from '../src/state/store.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    hubId: 'hub-1',
    harness: 'codex',
    mode: 'managed',
    title: 'migrate to app router',
    cwd: '/home/dev/storefront',
    status: 'working',
    statusSince: Date.now(),
    lastActivity: Date.now(),
    stats: { inputTokens: 19_000, outputTokens: 900, turns: 2, elapsedMs: 60_000 },
    capabilities: ['prompt', 'interrupt', 'approve', 'set_effort', 'kill', 'transcript'],
    ...overrides,
  };
}

beforeEach(() => {
  useDeck.getState().reset();
  useDeck.setState({ connection: 'connected' });
});

describe('MicroDeck', () => {
  it('renders the device with the attention agent on the readout strip', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<MicroDeck />);
    expect(screen.getByText(/migrate to app router · working/)).toBeDefined();
    expect(screen.getByText(/20k tok/)).toBeDefined();
    expect(screen.getByRole('button', { name: /migrate to app router — working/ })).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Empty agent key' })).toHaveLength(5);
    expect(screen.getByRole('group', { name: /Joystick/ })).toBeDefined();
    expect(screen.getByRole('slider', { name: /effort dial/ })).toBeDefined();
  });

  it('shows the empty-state line with no agents', () => {
    render(<MicroDeck />);
    expect(screen.getByText(/no agents · run opendeck --demo/)).toBeDefined();
  });

  it('arms approve and deny only while a permission is pending, and answers it', () => {
    useDeck
      .getState()
      .applyServerMsg(
        serverMsg('session_upsert', makeSession({ status: 'waiting_permission' }), 1),
      );
    const { rerender } = render(<MicroDeck />);
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true);

    useDeck.getState().applyServerMsg(
      serverMsg(
        'permission_request',
        {
          id: 'perm-1',
          sessionId: 'sess-1',
          tool: { name: 'Bash', input: 'psql -f migrate.sql' },
          options: ['approve', 'deny'],
          requestedAt: 1,
        },
        2,
      ),
    );
    rerender(<MicroDeck />);
    expect(screen.getByText(/approve Bash\?/)).toBeDefined();

    const respond = vi.spyOn(controller, 'respondPermission').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Approve Bash' }));
    expect(respond).toHaveBeenCalledWith('perm-1', 'approve');
    fireEvent.click(screen.getByRole('button', { name: 'Deny Bash' }));
    expect(respond).toHaveBeenCalledWith('perm-1', 'deny');
    respond.mockRestore();
  });

  it('steps the reasoning knob through codex efforts including xhigh', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    const setEffort = vi.spyOn(controller, 'setEffort').mockImplementation(() => undefined);
    render(<MicroDeck />);
    const knob = screen.getByRole('slider', { name: /effort dial/ });
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    expect(setEffort).toHaveBeenCalledWith({ sessionId: 'sess-1', axis: 'effort', value: 'high' });
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    expect(setEffort).toHaveBeenLastCalledWith({
      sessionId: 'sess-1',
      axis: 'effort',
      value: 'xhigh',
    });
    setEffort.mockRestore();
  });

  it('interrupts and opens the selected agent from the command keys', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    const action = vi.spyOn(controller, 'action').mockImplementation(() => undefined);
    const subscribe = vi.spyOn(controller, 'subscribe').mockImplementation(() => undefined);
    render(<MicroDeck />);

    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }));
    expect(action).toHaveBeenCalledWith({ sessionId: 'sess-1', kind: 'interrupt' });

    fireEvent.click(screen.getByRole('button', { name: 'Open the selected agent' }));
    expect(useDeck.getState().focusedSessionId).toBe('sess-1');
    expect(subscribe).toHaveBeenCalledWith('sess-1');
    action.mockRestore();
    subscribe.mockRestore();
  });

  it('pages the agent keys past six sessions', () => {
    for (let i = 0; i < 8; i += 1) {
      useDeck
        .getState()
        .applyServerMsg(
          serverMsg(
            'session_upsert',
            makeSession({ id: `s-${String(i)}`, title: `agent ${String(i)}` }),
            i + 1,
          ),
        );
    }
    render(<MicroDeck />);
    expect(screen.getByRole('button', { name: 'Agent page 2' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Agent page 2' }));
    expect(screen.getByRole('button', { name: /agent 7/ })).toBeDefined();
  });

  it('renders through GridScreen when the micro preset is active', () => {
    useDeck.getState().updateLayout(LAYOUT_PRESETS.micro);
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<GridScreen />);
    expect(screen.getByText(/migrate to app router · working/)).toBeDefined();
  });

  it('MicroScreen falls back to the classic face without WebGL2', () => {
    useDeck.getState().updateSettings({ rendering: '3d' });
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<MicroScreen />);
    // jsdom offers no WebGL2 context, so the CSS device must render.
    expect(screen.getByRole('slider')).toBeDefined();
  });

  it('pressing a disabled command explains itself on the readout strip', () => {
    useDeck
      .getState()
      .applyServerMsg(serverMsg('session_upsert', makeSession({ capabilities: ['prompt'] }), 1));
    render(<MicroDeck />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveProperty('disabled', true);
    const wrapper = approve.parentElement;
    if (!wrapper) throw new Error('command wrapper missing');
    fireEvent.pointerDown(wrapper);
    expect(screen.getByText('nothing is waiting for approval')).toBeDefined();
  });

  it('a horizontal plate swipe pages through agents, even across keys', () => {
    for (let i = 1; i <= 8; i += 1) {
      useDeck
        .getState()
        .applyServerMsg(
          serverMsg(
            'session_upsert',
            makeSession({ id: `s-${String(i)}`, title: `agent ${String(i)}` }),
            i,
          ),
        );
    }
    const { container } = render(<MicroDeck />);
    const plate = container.querySelector('.micro-plate');
    if (!plate) throw new Error('plate missing');
    // Start the swipe on a key — thumbs travel across keys, not bezels.
    fireEvent.pointerDown(screen.getByRole('button', { name: /agent 1/ }), {
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(plate, { clientX: 120, clientY: 205 });
    expect(screen.getByRole('button', { name: /agent 7/ })).toBeDefined();
    fireEvent.pointerDown(plate, { clientX: 120, clientY: 200 });
    fireEvent.pointerUp(plate, { clientX: 320, clientY: 205 });
    expect(screen.getByRole('button', { name: /agent 1/ })).toBeDefined();
  });

  it('tapping the unavailable mic opens settings instead of dying silently', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<MicroDeck />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Voice is unavailable/ }));
    expect(useDeck.getState().screen).toBe('settings');
  });

  it('MicroScreen honors the classic rendering choice', () => {
    useDeck.getState().updateSettings({ rendering: 'classic' });
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<MicroScreen />);
    expect(screen.getByRole('slider')).toBeDefined();
  });
});
