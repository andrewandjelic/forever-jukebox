import type { AppContext } from "./context";

// A song the listener has just picked should start by itself once it is
// ready, however long the download and analysis take: they may have looked
// away by then, and a silent ring gives no cue that it finished.
//
// Only a click on a song asks for this. A page opened straight on a song's
// link never does, because browsers refuse to start audio before the first
// click.

// A request older than this was for a load that never finished.
const MAX_WAIT_MS = 15 * 60 * 1000;

let requestedAt: number | null = null;

export function requestAutoplay(context?: AppContext | null) {
  requestedAt = Date.now();
  // The pick is a user gesture. Waking the audio output inside it means the
  // browser will let playback begin later without another click.
  try {
    void context?.player
      .getContext()
      .resume()
      .catch(() => undefined);
  } catch {
    // No audio output yet; pressing Play still works.
  }
}

export function cancelAutoplay() {
  requestedAt = null;
}

// True once per request, and only while the request is still fresh.
export function consumeAutoplay(now = Date.now()): boolean {
  const fresh = requestedAt !== null && now - requestedAt < MAX_WAIT_MS;
  requestedAt = null;
  return fresh;
}
