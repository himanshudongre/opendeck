import { Mic, MicOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { controller } from '../lib/controller.js';
import { hapticTick } from '../lib/haptics.js';
import { startVoice, voiceAvailability, type VoiceSession } from '../lib/voice.js';
import { useDeck } from '../state/store.js';

/**
 * Hold-to-talk (SPEC §6). On insecure contexts the key stays visible but
 * inert, with the tooltip explaining the HTTPS lane — the trade-off is
 * documented in-app, not discovered (SPEC §5.5).
 */
export function VoiceKey() {
  const focused = useDeck((state) => state.focusedSessionId);
  const sessions = useDeck((state) => state.sessions);
  const order = useDeck((state) => state.order);
  const settings = useDeck((state) => state.settings);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showHint, setShowHint] = useState(false);
  const session = useRef<VoiceSession | undefined>(undefined);

  const availability = voiceAvailability();
  const target =
    (focused !== null && sessions[focused]?.capabilities.includes('prompt') === true
      ? focused
      : undefined) ?? order.find((id) => sessions[id]?.capabilities.includes('prompt') === true);

  const begin = (): void => {
    if (availability !== 'available' || target === undefined) {
      setShowHint(true);
      window.setTimeout(() => setShowHint(false), 3500);
      return;
    }
    hapticTick(settings.haptics, 12);
    setListening(true);
    setTranscript('');
    session.current = startVoice(
      settings.voiceLang,
      (text) => setTranscript(text),
      (finalText) => {
        setListening(false);
        setTranscript('');
        if (finalText.length > 0) {
          controller.voicePrompt(target, finalText, settings.voiceLang);
        }
      },
    );
  };

  const end = (): void => {
    session.current?.stop();
    session.current = undefined;
  };

  const inert = availability !== 'available';

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={
          inert
            ? 'Voice is unavailable on this connection. Enable voice in Settings.'
            : listening
              ? 'Listening — release to send'
              : 'Hold to talk'
        }
        className={`keycap flex h-24 w-16 touch-none flex-col items-center justify-center gap-1.5 ${inert ? 'opacity-50' : ''}`}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerLeave={end}
      >
        {inert ? (
          <MicOff aria-hidden size={18} style={{ color: 'var(--ink-3)' }} />
        ) : (
          <Mic
            aria-hidden
            size={18}
            className={listening ? 'pulse-waiting' : ''}
            style={{ color: listening ? 'var(--st-waiting)' : 'var(--ink-2)' }}
          />
        )}
        <span className="font-data text-[8px] uppercase tracking-wide text-ink-3">
          {listening ? 'listening' : 'hold to talk'}
        </span>
      </button>

      {listening && transcript.length > 0 && (
        <div className="panel absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 px-3 py-2">
          <p className="text-xs text-ink-1">{transcript}</p>
        </div>
      )}

      {showHint && (
        <div
          role="tooltip"
          className="panel absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 px-3 py-2"
        >
          <p className="text-xs text-ink-2">
            {inert
              ? 'Browsers allow the microphone only on secure connections. Open Settings → Enable voice to switch this deck to the hub’s HTTPS address.'
              : 'No session can take a prompt right now.'}
          </p>
        </div>
      )}
    </div>
  );
}
