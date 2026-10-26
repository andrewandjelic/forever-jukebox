import { useEffect, useRef, useState } from "react";
import { getAppContext } from "../runtime";
import { useAppStore } from "../store";

// Served same-origin by the API (routes/media.py) so its frames can be drawn
// on a canvas; Tenor itself sends no CORS headers.
const GIF_URL = "/api/media/jayz.gif";

// Measured from the GIF: 30 frames at 70 ms; the head dips on frames 1, 8 and
// 15, so frames 1-21 are three clean 7-frame bobs (0.49 s each).
const FIRST_BOB_FRAME = 1;
const BOB_FRAMES = 7;
const BOBS_IN_CYCLE = 3;
const NATIVE_BOB_SECONDS = BOB_FRAMES * 0.07;

// Which GIF frame to show so every bob lands on a beat. Bobs once per beat,
// or every other beat / twice per beat when the tempo is far from the GIF's
// own, so it never looks frantic or sluggish.
export function bobFrame(
  beatIndex: number,
  beatPhase: number,
  beatSeconds: number,
): number {
  const ratio = Math.round(Math.log2(beatSeconds / NATIVE_BOB_SECONDS));
  const bobsPerBeat = 2 ** Math.max(-1, Math.min(1, ratio));
  const position = (beatIndex + beatPhase) * bobsPerBeat;
  const bob = Math.floor(position);
  const within = Math.min(0.999, Math.max(0, position - bob));
  return (
    FIRST_BOB_FRAME +
    (bob % BOBS_IN_CYCLE) * BOB_FRAMES +
    Math.floor(within * BOB_FRAMES)
  );
}

// Frame to show right now: beat-synced in Jukebox mode, the GIF's own pace in
// the other modes, frozen while paused (null).
function currentFrame(): number | null {
  const { player, engine } = getAppContext();
  if (!player.isPlaying()) {
    return null;
  }
  if (useAppStore.getState().playMode === "jukebox") {
    const time = player.getCurrentTime();
    const beat = engine.getBeatAtTime(time);
    if (beat && beat.duration > 0) {
      return bobFrame(
        beat.which,
        (time - beat.start) / beat.duration,
        beat.duration / player.getPlaybackRate(),
      );
    }
  }
  const cycleFrames = BOB_FRAMES * BOBS_IN_CYCLE;
  return FIRST_BOB_FRAME + (Math.floor(performance.now() / 70) % cycleFrames);
}

async function decodeFrames(blob: Blob): Promise<ImageBitmap[]> {
  const decoder = new ImageDecoder({
    data: await blob.arrayBuffer(),
    type: "image/gif",
  });
  await decoder.tracks.ready;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
  const frames: ImageBitmap[] = [];
  for (let i = 0; i < count; i += 1) {
    const { image } = await decoder.decode({ frameIndex: i });
    frames.push(await createImageBitmap(image));
    image.close();
  }
  decoder.close();
  return frames;
}

// Bottom-right "Jay-Z" button: opens a small card where Jay-Z nods along to
// whatever is playing.
export function JayZBob() {
  const [open, setOpen] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    let rafId = 0;
    let frames: ImageBitmap[] = [];
    let objectUrl: string | null = null;
    (async () => {
      const response = await fetch(GIF_URL);
      if (!response.ok) {
        throw new Error(`GIF ${response.status}`);
      }
      const blob = await response.blob();
      // No ImageDecoder (older Safari/Firefox): show the plain GIF, unsynced.
      if (typeof ImageDecoder === "undefined") {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setFallbackUrl(objectUrl);
        }
        return;
      }
      frames = await decodeFrames(blob);
      const ctx = canvasRef.current?.getContext("2d");
      if (cancelled || !ctx || frames.length === 0) {
        return;
      }
      let shown = -1;
      const draw = () => {
        const frame = currentFrame() ?? Math.max(shown, FIRST_BOB_FRAME);
        if (frame !== shown && frames[frame]) {
          ctx.drawImage(frames[frame], 0, 0, ctx.canvas.width, ctx.canvas.height);
          shown = frame;
        }
        rafId = requestAnimationFrame(draw);
      };
      draw();
    })().catch(() => {
      if (!cancelled) {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      frames.forEach((frame) => frame.close());
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [open]);

  return (
    <div className="jayz">
      {open && (
        <div className="jayz-card">
          {failed ? (
            <p className="jayz-error">Couldn't load Jay-Z.</p>
          ) : fallbackUrl ? (
            <img src={fallbackUrl} alt="Jay-Z nodding along" />
          ) : (
            <canvas
              ref={canvasRef}
              width={498}
              height={280}
              role="img"
              aria-label="Jay-Z nodding along to the beat"
            />
          )}
        </div>
      )}
      <button
        type="button"
        className={open ? "jayz-button is-on" : "jayz-button"}
        aria-pressed={open}
        onClick={() => setOpen((value) => !value)}
      >
        Jay-Z
      </button>
    </div>
  );
}
