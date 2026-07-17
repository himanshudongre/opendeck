import { serverMsg, type Session } from '@agentdeck/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionCard } from '../src/components/PermissionCard.js';
import { DeskglowEdges } from '../src/components/Deskglow.js';
import { controller } from '../src/lib/controller.js';
import { GridScreen } from '../src/screens/GridScreen.js';
import { FocusScreen } from '../src/screens/FocusScreen.js';
import { PairScreen } from '../src/screens/PairScreen.js';
import { SettingsScreen } from '../src/screens/SettingsScreen.js';
import { useDeck } from '../src/state/store.js';
import { ActionKey } from '../src/widgets/ActionKey.js';
import { AgentTile } from '../src/widgets/AgentTile.js';
import { axesFor } from '../src/widgets/Dial.js';
import { StatBar } from '../src/widgets/StatBar.js';
import { Ticker } from '../src/widgets/Ticker.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    hubId: 'hub-1',
    harness: 'claude',
    mode: 'managed',
    title: 'fix flaky auth test',
    cwd: '/home/dev/api',
    repo: 'acme/api',
    branch: 'fix/auth-retry',
    model: 'claude-sonnet-5',
    status: 'working',
    statusSince: Date.now(),
    lastActivity: Date.now(),
    currentTool: { name: 'Bash', detail: 'pnpm test' },
    stats: { inputTokens: 41_200, outputTokens: 900, costUsd: 0.31, turns: 3, elapsedMs: 761_000 },
    capabilities: ['prompt', 'interrupt', 'approve', 'set_effort', 'kill', 'transcript'],
    ...overrides,
  };
}

beforeEach(() => {
  useDeck.getState().reset();
  useDeck.setState({ connection: 'connected', latencyMs: 12 });
});

describe('AgentTile', () => {
  it('shows the hero fields: status, harness, branch, tool, cost', () => {
    render(<AgentTile session={makeSession()} size="M" />);
    expect(screen.getByText('fix flaky auth test')).toBeDefined();
    expect(screen.getByText(/claude/)).toBeDefined();
    expect(screen.getByText(/fix\/auth-retry/)).toBeDefined();
    expect(screen.getByText(/Bash · pnpm test/)).toBeDefined();
    expect(screen.getByText(/42k tok/)).toBeDefined();
    expect(screen.getByText('$0.31')).toBeDefined();
  });

  it('pulses the waiting label instead of the tool line', () => {
    render(<AgentTile session={makeSession({ status: 'waiting_permission' })} size="M" />);
    expect(screen.getByText('needs approval')).toBeDefined();
  });

  it('opens focus on tap', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    const subscribe = vi.spyOn(controller, 'subscribe').mockImplementation(() => undefined);
    render(<AgentTile session={makeSession()} size="M" />);
    fireEvent.click(screen.getByRole('button', { name: /fix flaky auth test/ }));
    expect(useDeck.getState().focusedSessionId).toBe('sess-1');
    expect(subscribe).toHaveBeenCalledWith('sess-1');
    subscribe.mockRestore();
  });

  it('marks observed sessions as terminal sessions', () => {
    render(<AgentTile session={makeSession({ mode: 'observed' })} size="M" />);
    expect(screen.getByText(/terminal/)).toBeDefined();
  });
});

describe('StatBar', () => {
  it('counts the fleet and shows honest latency', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    useDeck
      .getState()
      .applyServerMsg(
        serverMsg('session_upsert', makeSession({ id: 's2', status: 'waiting_input' }), 2),
      );
    render(<StatBar />);
    expect(screen.getByText('1 running · 1 waiting')).toBeDefined();
    expect(screen.getByText('12 ms')).toBeDefined();
  });

  it('says reconnecting when the socket drops', () => {
    useDeck.setState({ connection: 'reconnecting' });
    render(<StatBar />);
    expect(screen.getByText('reconnecting…')).toBeDefined();
  });
});

describe('Ticker', () => {
  it('renders the empty hint and then entries', () => {
    const { rerender } = render(<Ticker />);
    expect(screen.getByText('Fleet events appear here.')).toBeDefined();
    useDeck.getState().pushTickerNote('warn', 'sim-auth needs approval');
    rerender(<Ticker />);
    expect(screen.getByText(/needs approval/)).toBeDefined();
  });
});

describe('PermissionCard', () => {
  const request = {
    id: 'perm-1',
    sessionId: 'sess-1',
    tool: {
      name: 'Edit',
      input: 'src/auth.ts',
      diff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;',
    },
    options: ['approve', 'deny', 'always_allow'] as ['approve', 'deny', 'always_allow'],
    requestedAt: 1,
  };

  it('renders the diff with add/del coloring and all three answers', () => {
    render(<PermissionCard request={request} />);
    expect(screen.getByText('-const a = 1;')).toBeDefined();
    expect(screen.getByText('+const a = 2;')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve Edit' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deny Edit' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Always allow Edit' })).toBeDefined();
  });

  it('answers through the controller', () => {
    const respond = vi.spyOn(controller, 'respondPermission').mockImplementation(() => undefined);
    render(<PermissionCard request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve Edit' }));
    expect(respond).toHaveBeenCalledWith('perm-1', 'approve');
    fireEvent.click(screen.getByRole('button', { name: 'Deny Edit' }));
    expect(respond).toHaveBeenCalledWith('perm-1', 'deny');
    respond.mockRestore();
  });

  it('hides always-allow when the adapter cannot honor it', () => {
    render(
      <PermissionCard
        request={{
          ...request,
          tool: { name: 'Bash', input: 'pnpm test' },
          options: ['approve', 'deny'],
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull();
    expect(screen.getByText('pnpm test')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve Bash' }).textContent).toContain('Approve');
  });
});

describe('ActionKey', () => {
  it('targets the session that needs attention', () => {
    useDeck
      .getState()
      .applyServerMsg(
        serverMsg('session_upsert', makeSession({ status: 'waiting_permission' }), 1),
      );
    useDeck.getState().applyServerMsg(
      serverMsg(
        'permission_request',
        {
          id: 'perm-1',
          sessionId: 'sess-1',
          tool: { name: 'Edit', input: 'a' },
          options: ['approve', 'deny'],
          requestedAt: 1,
        },
        2,
      ),
    );
    const action = vi.spyOn(controller, 'action').mockImplementation(() => undefined);
    render(<ActionKey binding={{ id: 'approve', label: 'Approve', kind: 'approve' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(action).toHaveBeenCalledWith({ kind: 'approve', sessionId: 'sess-1' });
    action.mockRestore();
  });

  it('is disabled with no target and arms shell actions before firing', () => {
    const action = vi.spyOn(controller, 'action').mockImplementation(() => undefined);
    render(<ActionKey binding={{ id: 'interrupt', label: 'Interrupt', kind: 'interrupt' }} />);
    const key = screen.getByRole('button', { name: 'Interrupt' });
    expect((key as HTMLButtonElement).disabled).toBe(true);

    render(
      <ActionKey
        binding={{ id: 'deploy', label: 'Deploy', kind: 'shell', args: { actionId: 'deploy' } }}
      />,
    );
    const shellKey = screen.getByRole('button', { name: 'Deploy' });
    fireEvent.click(shellKey);
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deploy' }));
    expect(action).toHaveBeenCalledWith({
      kind: 'shell',
      args: { actionId: 'deploy', confirmed: true },
    });
    action.mockRestore();
  });
});

describe('Dial bindings', () => {
  it('maps harnesses to their axes', () => {
    const claude = axesFor(makeSession());
    expect(claude.map((axis) => axis.axis)).toEqual(['model', 'thinking']);
    expect(claude[0]?.initial).toBe('sonnet');
    expect(axesFor(makeSession({ model: 'claude-opus-4-8' }))[0]?.initial).toBe('opus');

    const codex = axesFor(makeSession({ harness: 'codex' }));
    expect(codex).toHaveLength(1);
    expect(codex[0]?.values).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);

    const sim = axesFor(makeSession({ harness: 'simulator' }));
    expect(sim[0]?.axis).toBe('effort');
  });
});

describe('screens', () => {
  it('GridScreen shows the spec empty state', () => {
    render(<GridScreen />);
    expect(screen.getByText('No agents yet.')).toBeDefined();
    expect(screen.getByText(/agent-deck --demo/)).toBeDefined();
  });

  it('GridScreen renders tiles and the control rail', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    render(<GridScreen />);
    expect(screen.getByText('fix flaky auth test')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('slider', { name: /dial/i })).toBeDefined();
  });

  it('FocusScreen renders the session header, prompt bar, and permission card', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    useDeck.getState().focusSession('sess-1');
    useDeck.getState().applyServerMsg(
      serverMsg(
        'permission_request',
        {
          id: 'perm-9',
          sessionId: 'sess-1',
          tool: { name: 'Bash', input: 'psql -f migrate.sql' },
          options: ['approve', 'deny'],
          requestedAt: 1,
        },
        2,
      ),
    );
    const prompt = vi.spyOn(controller, 'prompt').mockImplementation(() => undefined);
    render(<FocusScreen />);
    expect(screen.getByRole('heading', { name: 'fix flaky auth test' })).toBeDefined();
    expect(screen.getByText('psql -f migrate.sql')).toBeDefined();

    const input = screen.getByRole('textbox', { name: /Prompt/ });
    fireEvent.change(input, { target: { value: 'run the suite' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(prompt).toHaveBeenCalledWith('sess-1', 'run the suite');
    prompt.mockRestore();
  });

  it('FocusScreen falls back gracefully when the session vanished', () => {
    useDeck.getState().focusSession('ghost');
    render(<FocusScreen />);
    expect(screen.getByText('That session is gone.')).toBeDefined();
  });

  it('PairScreen explains the pairing flow', () => {
    render(<PairScreen />);
    expect(screen.getByText(/isn’t paired yet/)).toBeDefined();
    expect(screen.getByText(/npx agent-deck/)).toBeDefined();
  });

  it('SettingsScreen toggles sound and haptics', () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'silent' }));
    expect(useDeck.getState().settings.sound).toBe('silent');
    const hapticsRow = screen.getByText('Haptics').parentElement;
    const toggle = hapticsRow?.querySelector('button');
    if (!toggle) throw new Error('haptics toggle missing');
    fireEvent.click(toggle);
    expect(useDeck.getState().settings.haptics).toBe(false);
  });
});

describe('DeskglowEdges', () => {
  it('tints toward the loudest fleet state', () => {
    useDeck.getState().applyServerMsg(serverMsg('session_upsert', makeSession(), 1));
    useDeck
      .getState()
      .applyServerMsg(
        serverMsg('session_upsert', makeSession({ id: 's2', status: 'waiting_permission' }), 2),
      );
    const { container } = render(<DeskglowEdges />);
    expect(container.querySelector('[data-aggregate="waiting"]')).not.toBeNull();
  });
});
