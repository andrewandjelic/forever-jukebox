import { useEffect, useRef, useState } from "react";
import { getAppContext } from "../runtime";
import { useAppStore } from "../store";

// Served same-origin by the API (routes/media.py) so its frames can be drawn
// on a canvas; Tenor itself sends no CORS headers.
const GIF_URL = "/api/media/jayz.gif";

// Two clean nods, measured from the GIF (head offset in px, tracked frame by
// frame), each listed from head up-left to head down-right. The GIF's own
// nods are uneven (and the camera drifts), so these play forwards and back
// instead, alternating beat by beat. Tweak the lists to change the nods.
const NODS = [
  [
    { frame: 5, x: -3.5 },
    { frame: 6, x: -0.1 },
    { frame: 8, x: 10.1 },
    { frame: 9, x: 17.3 },
  ],
  [
    { frame: 14, x: -1.7 },
    { frame: 15, x: 16.1 },
    { frame: 17, x: 30.5 },
  ],
];
// Rough length of a natural nod, used to pick nods per beat and as the pace
// when there's no beat to follow.
const NATIVE_BOB_SECONDS = 0.49;

// Which GIF frame to show: the head is fully down (right) on each beat and
// fully up (left) halfway between, easing like a real nod. The two nods take
// turns, swapping at the top where both have the head in about the same
// place. Nods once per beat, or every other beat / twice per beat when the
// tempo is far from a natural nod, so it never looks frantic or sluggish.
export function bobFrame(
  beatIndex: number,
  beatPhase: number,
  beatSeconds: number,
): number {
  const ratio = Math.round(Math.log2(beatSeconds / NATIVE_BOB_SECONDS));
  const bobsPerBeat = 2 ** Math.max(-1, Math.min(1, ratio));
  const position = (beatIndex + beatPhase) * bobsPerBeat;
  const nod = NODS[Math.floor(position + 0.5) % NODS.length];
  const down = (1 + Math.cos(2 * Math.PI * position)) / 2;
  const left = nod[0].x;
  const x = left + down * (nod[nod.length - 1].x - left);
  let best = nod[0];
  for (const step of nod) {
    if (Math.abs(step.x - x) < Math.abs(best.x - x)) {
      best = step;
    }
  }
  return best.frame;
}

// Frame to show right now: beat-synced in Jukebox mode, a natural pace in
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
  const nods = performance.now() / 1000 / NATIVE_BOB_SECONDS;
  return bobFrame(0, nods, NATIVE_BOB_SECONDS);
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
        const frame = currentFrame() ?? (shown >= 0 ? shown : NODS[0][0].frame);
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
