/**
 * A peripheral must never sleep. Secure contexts get the real Wake Lock API;
 * the HTTP lane falls back to a looping, muted, invisible video (SPEC §6).
 */

// The smallest valid looping video: a 2x2 black VP8 webm, base64-embedded so
// the offline shell needs no extra asset.
const TINY_WEBM =
  'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uvdeBAXPFh9CBRoiIQVzhAxlwo4EBI2WjmKqBAXPFh0BF7EPGVzhAxlwo';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

export interface WakeLockHandle {
  kind: 'native' | 'video' | 'unavailable';
  release: () => void;
}

export async function acquireWakeLock(doc: Document = document): Promise<WakeLockHandle> {
  const nav = doc.defaultView?.navigator as
    | (Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } })
    | undefined;

  if (nav?.wakeLock && doc.defaultView?.isSecureContext === true) {
    try {
      const sentinel = await nav.wakeLock.request('screen');
      return {
        kind: 'native',
        release: () => {
          void sentinel.release();
        },
      };
    } catch {
      // Fall through to the video trick (low battery, platform refusal).
    }
  }

  const video = doc.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.loop = true;
  video.src = TINY_WEBM;
  video.style.position = 'fixed';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  doc.body.appendChild(video);
  try {
    await video.play();
    return {
      kind: 'video',
      release: () => {
        video.pause();
        video.remove();
      },
    };
  } catch {
    video.remove();
    return { kind: 'unavailable', release: () => undefined };
  }
}
