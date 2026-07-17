/**
 * Hold-to-talk via the Web Speech API. Browsers gate it behind secure
 * contexts; the voice key checks `voiceAvailability()` and explains itself
 * instead of failing silently (SPEC §5.5, §6).
 */

interface SpeechRecognitionResultLike {
  transcript: string;
}

interface SpeechRecognitionEventLike {
  results: { 0: SpeechRecognitionResultLike; isFinal: boolean; length: number }[];
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(win: Window = window): RecognitionCtor | undefined {
  const candidates = win as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return candidates.SpeechRecognition ?? candidates.webkitSpeechRecognition;
}

export type VoiceAvailability = 'available' | 'insecure_context' | 'unsupported';

export function voiceAvailability(win: Window = window): VoiceAvailability {
  if (!win.isSecureContext) return 'insecure_context';
  return recognitionCtor(win) === undefined ? 'unsupported' : 'available';
}

export interface VoiceSession {
  stop: () => void;
  abort: () => void;
}

/** Starts listening; streams interim text, resolves final text on stop. */
export function startVoice(
  lang: string,
  onInterim: (text: string) => void,
  onFinal: (text: string) => void,
  win: Window = window,
): VoiceSession | undefined {
  const Ctor = recognitionCtor(win);
  if (!Ctor || !win.isSecureContext) return undefined;

  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = '';
  recognition.onresult = (event) => {
    // event.results is the cumulative list; rebuild instead of appending.
    let final = '';
    let interim = '';
    for (const result of Array.from(event.results)) {
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    finalText = final;
    onInterim(`${final}${interim}`.trim());
  };
  recognition.onend = () => {
    onFinal(finalText.trim());
  };
  recognition.onerror = () => {
    onFinal(finalText.trim());
  };

  recognition.start();
  return {
    stop: () => {
      recognition.stop();
    },
    abort: () => {
      recognition.onend = null;
      recognition.abort();
    },
  };
}
