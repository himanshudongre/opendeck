import { useDeck } from '../state/store.js';

/**
 * Shown until the deck holds a device credential. Pairing itself is driven
 * by the QR URL (`#pair=<token>`) at boot; this screen explains the state
 * and the next step (SPEC §5, copy per §7.4).
 */
export function PairScreen() {
  const connection = useDeck((state) => state.connection);
  const ticker = useDeck((state) => state.ticker);
  const lastError = [...ticker].reverse().find((entry) => entry.level === 'error');

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel w-full max-w-sm px-6 py-8 text-center">
        <p className="font-display text-lg tracking-wide" style={{ color: 'var(--brass)' }}>
          ▲ agentdeck
        </p>

        {connection === 'reconnecting' ? (
          <>
            <p className="mt-4 text-sm text-ink-1">Pairing…</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              Exchanging the code for this device’s credential.
            </p>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-ink-1">This device isn’t paired yet.</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              Run{' '}
              <code className="font-data" style={{ color: 'var(--brass)' }}>
                npx agent-deck
              </code>{' '}
              on your dev machine and scan the QR code it prints. The code opens this page with a
              one-time token and pairs automatically.
            </p>
            {lastError && (
              <p className="notice-error mt-4 rounded-md px-3 py-2 text-xs">{lastError.text}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
