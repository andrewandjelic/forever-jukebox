import type { JukeboxEngine } from "../engine";
import type { Edge, QuantumBase } from "../engine/types";
import {
  BEAT_AVOID_RADIUS_PX,
  BEAT_SELECT_RADIUS_PX,
  EDGE_SELECT_RADIUS_PX,
  MAX_EDGE_SAMPLES,
  MAX_EDGES_BASE,
  MAX_WAVE_EDGES,
} from "../constants/visualization";

export type WaveformSource = () => Float32Array | null;

const WAVE_EDGE_POINTS = 28;
const WAVE_RING_POINTS = 360;
// Raw samples averaged into each drawn point; smooths the waveform so it
// reads as a wave, not noise.
const WAVE_BLOCK = 8;
// Floor for auto-gain so near-silence is not blown up into full-scale noise.
const WAVE_MIN_PEAK = 0.12;
// Gentle by default so the waves add motion without hiding the jumps.
const WAVE_ARC_MAX_PX = 8;
const WAVE_ARC_RATIO = 0.04;
const WAVE_RING_RATIO = 0.08;
// The ring is spikier than the arcs: it spans the whole analyser buffer
// (many cycles around the loop), keeps each block's peak so transients
// survive, and a power curve sharpens peaks into points.
const RING_SPIKE = 1.8;
const RING_SMOOTHING = 0.55;
// Ripples: on each beat, a snapshot of the ring's waveform drifts outward,
// flattening and fading as it spreads.
const RIPPLE_LIFE_MS = 2000;
// Effects are timed in beats so they follow the song's tempo: ripples live
// RIPPLE_LIFE_BEATS, and dots and particles swell by BEAT_PULSE on each
// beat, easing back over the first BEAT_PULSE_SHARE of it.
const RIPPLE_LIFE_BEATS = 4;
const BEAT_PULSE = 0.35;
const BEAT_PULSE_SHARE = 0.35;
// Motion follows the song's tempo. While music plays, the whole ring (beats,
// arcs, waveform) turns one lap per RING_SPIN_BEATS beats. Ripples leave with
// the ring's spin and keep it like a vortex: angular speed falls with the
// square of how far they've spread, so outer ripples lag into a spiral.
const RING_SPIN_BEATS = 96;
// The Wave layout's sine travels one wavelength per WAVE_TRAVEL_BEATS beats,
// so the beats ride the wave; the Infinite layout's beats flow once around
// the figure-eight per INFINITE_TRAVEL_BEATS.
const WAVE_TRAVEL_BEATS = 16;
const INFINITE_TRAVEL_BEATS = 64;
// Every layout also wobbles in 3D: it turns once per TUMBLE_BEATS about an
// axis tipped TUMBLE_AXIS_DEG from the line of sight, so a flat shape leans
// up to twice that far but never goes fully edge-on. TUMBLE_FOCAL sets the
// perspective (camera distance in canvas half-widths; lower = stronger).
const TUMBLE_BEATS = 64;
const TUMBLE_AXIS_DEG = 35;
const TUMBLE_FOCAL = 3;
// The automatic motion (tumble, ring spin, wave/infinity travel) is a
// toggle, off by default so layouts start static. Its speed eases toward
// on/off, keeping MOTION_EASE of the gap per 60 fps frame (~5 s to full);
// switched off, the layout also drifts back to its static view (RETURN_EASE,
// ~3 s).
const MOTION_EASE = 0.99;
// Jump flash strength (brightness, width, glow) on the flat views.
const JUMP_FLASH_FIXED = 0.4;
// Arc brightness on the flat views (riding has its own, RIDE_ARC_DIM).
const FLAT_ARC_DIM = 0.7;
const RETURN_EASE = 0.985;
// Click-and-drag turns the layout on top of the tumble. Drags are slow
// (radians per pixel), the view eases toward where you dragged it
// (DRAG_EASE: share of the gap left after each 60 fps frame), and a flick
// keeps coasting, losing momentum by DRAG_FRICTION per frame. A press that
// moves less than DRAG_THRESHOLD_PX is still a click (selects arcs/beats).
const DRAG_SENSITIVITY = 0.004;
const DRAG_EASE = 0.88;
const DRAG_FRICTION = 0.94;
const DRAG_THRESHOLD_PX = 5;
// Follow cam ("ride"): a camera just behind and above the playhead, looking
// down the line. Distances are fractions of the smaller canvas side; the
// heading comes from RIDE_LOOK beats either side; the camera eases toward
// its spot (RIDE_EASE: share of the gap left per 60 fps frame), so jumps
// swing it across rather than cutting. Dragging orbits it around the
// playhead.
const RIDE_BACK = 0.08;
const RIDE_HEIGHT = 0.018;
const RIDE_AHEAD = 0.12;
const RIDE_LOOK = 4;
const RIDE_EASE = 0.9;
const RIDE_FOCAL = 0.9;
const RIDE_NEAR = 0.005;
// Riding, arcs leave the ground plane: each bows out RIDE_ARC_LIFT of its
// length in its own fixed random direction, and the ring's (and ripples')
// waveform rises up out of the ground RIDE_RING_LIFT times taller than flat,
// running RIDE_RING_OFFSET of the ring's radius outside the track so it
// lines the track instead of walling it off.
const RIDE_ARC_LIFT = 0.45;
const RIDE_RING_LIFT = 1.2;
const RIDE_RING_OFFSET = 0.06;
// Particle bursts when the music suddenly gets louder (a drop or pick-up):
// short-term loudness above BURST_RATIO x the last few seconds' level.
const BURST_RATIO = 1.8;
const BURST_MIN = 0.04;
// Bursts wait for the next beat and are at least BURST_GAP_BEATS apart;
// particles live PARTICLE_LIFE_BEATS.
const BURST_GAP_BEATS = 4;
const PARTICLE_LIFE_BEATS = 3;
const PARTICLE_DRAG = 0.97;
// Lightspeed warp on a jump while riding, lasting WARP_BEATS and centered
// on the playhead: star streaks rush out from it (jumping forward in the
// song) or in toward it (back), dots stretch the same way, and the view
// zooms out / in around it by WARP_FOV.
const WARP_BEATS = 2;
const WARP_FOV = 0.35;
const WARP_STRETCH = 0.25;
const WARP_STREAKS = 140;
// How much of each new frame blends into the displayed wave (lower = calmer).
const WAVE_SMOOTHING = 0.2;

type PathSink = Pick<CanvasRenderingContext2D, "moveTo" | "lineTo">;

function waveSample(wave: Float32Array | null, index: number) {
  return wave && wave.length > 0 ? wave[index % wave.length] : 0;
}

// Traces a quadratic curve displaced along its normal by the waveform. The
// sin envelope pins both ends so arcs stay attached to their beats.
export function traceWaveCurve(
  ctx: PathSink,
  from: Point,
  control: Point,
  to: Point,
  wave: Float32Array | null,
  offset: number,
  amplitude: number,
) {
  for (let k = 0; k < WAVE_EDGE_POINTS; k += 1) {
    const t = k / (WAVE_EDGE_POINTS - 1);
    const u = 1 - t;
    const x = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
    const y = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
    const dx = 2 * u * (control.x - from.x) + 2 * t * (to.x - control.x);
    const dy = 2 * u * (control.y - from.y) + 2 * t * (to.y - control.y);
    const len = Math.hypot(dx, dy) || 1;
    const d =
      waveSample(wave, offset + k) *
      amplitude *
      Math.sin(Math.PI * t);
    const px = x - (dy / len) * d;
    const py = y + (dx / len) * d;
    if (k === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
}

// Traces a closed circle whose radius follows the waveform. Samples are
// mirrored around the loop so the seam joins smoothly. `rotation` (radians,
// clockwise) turns the whole ring.
export function traceWaveRing(
  ctx: PathSink,
  center: Point,
  radius: number,
  wave: Float32Array | null,
  amplitude: number,
  rotation = 0,
) {
  const half = WAVE_RING_POINTS / 2;
  for (let k = 0; k <= WAVE_RING_POINTS; k += 1) {
    const mirrored = k <= half ? k : WAVE_RING_POINTS - k;
    const r = radius + waveSample(wave, mirrored) * amplitude;
    const angle = (k / WAVE_RING_POINTS) * Math.PI * 2 - Math.PI / 2 + rotation;
    const x = center.x + Math.cos(angle) * r;
    const y = center.y + Math.sin(angle) * r;
    if (k === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
}

// Ring version of the waveform: the whole buffer squeezed into the ring's
// mirrored half, max-magnitude per block (so transients survive), stretched
// between the quietest and loudest block, rectified to push outward, and raised to a power so peaks become sharp
// spikes over a calm baseline.
export function spikeWaveform(
  wave: Float32Array,
  block = Math.max(1, Math.floor(wave.length / (WAVE_RING_POINTS / 2 + 1))),
) {
  const spiked = new Float32Array(Math.floor(wave.length / block));
  let peak = 0;
  let floor = Infinity;
  for (let i = 0; i < spiked.length; i += 1) {
    let max = 0;
    for (let j = 0; j < block; j += 1) {
      max = Math.max(max, Math.abs(wave[i * block + j]));
    }
    spiked[i] = max;
    peak = Math.max(peak, max);
    floor = Math.min(floor, max);
  }
  // Measured from the quietest block up, so loud, compressed music (whose
  // block peaks are all near the top) still spikes instead of going flat.
  const range = Math.max(WAVE_MIN_PEAK, peak - floor);
  for (let i = 0; i < spiked.length; i += 1) {
    spiked[i] = ((spiked[i] - floor) / range) ** RING_SPIKE;
  }
  return spiked;
}

// Eases a displayed wave toward each new frame instead of snapping to it
// (k = share of the new frame; lower = calmer). Updates prev in place.
function ease(prev: Float32Array | null, next: Float32Array, k: number) {
  if (!prev || prev.length !== next.length) {
    return next;
  }
  for (let i = 0; i < prev.length; i += 1) {
    prev[i] += (next[i] - prev[i]) * k;
  }
  return prev;
}

// Turns a layout point by `angle` about the tumble axis around
// `center`, then by the drag's yaw and pitch, and projects it back to the
// canvas with perspective.
export function tumblePoint(
  // z: depth toward the viewer, for layouts that aren't flat (0 if absent).
  point: Point & { z?: number },
  center: Point,
  angle: number,
  focal: number,
  // Extra turn from dragging: yaw about the vertical axis, pitch about the
  // horizontal one (positive = front moves right / down).
  yaw = 0,
  pitch = 0,
): Point {
  const z = point.z ?? 0;
  if (angle === 0 && yaw === 0 && pitch === 0 && z === 0) {
    return { x: point.x, y: point.y };
  }
  const tilt = (TUMBLE_AXIS_DEG * Math.PI) / 180;
  // Unit axis in the y-z plane, tipped `tilt` from the viewer's z axis.
  const ay = Math.sin(tilt);
  const az = Math.cos(tilt);
  const x = point.x - center.x;
  const y = point.y - center.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = ay * y + az * z;
  // Rodrigues' rotation of (x, y, z) about (0, ay, az).
  const rx = x * cos + (ay * z - az * y) * sin;
  const ry = y * cos + az * x * sin + ay * dot * (1 - cos);
  const rz = z * cos - ay * x * sin + az * dot * (1 - cos);
  const x2 = rx * Math.cos(yaw) + rz * Math.sin(yaw);
  const z2 = -rx * Math.sin(yaw) + rz * Math.cos(yaw);
  const y3 = ry * Math.cos(pitch) + z2 * Math.sin(pitch);
  const z3 = -ry * Math.sin(pitch) + z2 * Math.cos(pitch);
  const scale = focal / (focal - z3);
  return { x: center.x + x2 * scale, y: center.y + y3 * scale };
}

// Typical beat length in ms (median, so odd beats at the edges of the track
// don't skew it). Falls back to 120 BPM when there are no beats.
export function medianBeatMs(beats: Array<{ duration: number }>) {
  const durations = beats
    .map((beat) => beat.duration)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  return durations.length
    ? durations[Math.floor(durations.length / 2)] * 1000
    : 500;
}

// Riding, lines get thinner with distance: each segment's width follows its
// perspective scale relative to RIDE_LINE_REF (a typical arc's distance, as
// a share of the playhead's), rounded to half-octave steps so segments batch
// into a handful of strokes, between a quarter (far hairlines) and double
// (right up close). Riding lines start from slim fixed widths (loudness only
// brightens them) so dense passages don't turn into noodles.
const RIDE_LINE_REF = 0.35;
const RIDE_ARC_WIDTH = 0.9;
const RIDE_ARC_DIM = 0.75;
const RIDE_RING_WIDTH = 1.6;
type ScaledPoint = { x: number; y: number; scale: number };
type StrokeBuckets = Map<
  string,
  { style: string | CanvasGradient; width: number; path: Path2D }
>;

export function widthStep(scale: number) {
  const clamped = Math.min(2, Math.max(0.25, scale));
  return 2 ** (Math.round(Math.log2(clamped) * 2) / 2);
}

// Adds a projected polyline to `buckets`, one segment at a time, keyed by
// style and scaled width. Segments touching a hidden (NaN) point are skipped.
function addScaledLine(
  buckets: StrokeBuckets,
  points: ScaledPoint[],
  baseWidth: number,
  styleAt: (k: number) => string | CanvasGradient,
) {
  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k];
    const b = points[k + 1];
    if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) {
      continue;
    }
    const style = styleAt(k);
    const width = Math.max(
      0.35,
      baseWidth * widthStep((a.scale + b.scale) / 2 / RIDE_LINE_REF),
    );
    const key = `${typeof style === "string" ? style : "gradient"}|${width}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { style, width, path: new Path2D() };
      buckets.set(key, bucket);
    }
    bucket.path.moveTo(a.x, a.y);
    bucket.path.lineTo(b.x, b.y);
  }
}

function strokeBuckets(ctx: CanvasRenderingContext2D, buckets: StrokeBuckets) {
  ctx.lineCap = "round";
  for (const { style, width, path } of buckets.values()) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
}

// Arcs fade with distance from the playhead, so nearby ones read as bright
// and close: each band covers arcs whose nearest point (either end or the
// middle) is within `reach` (fraction of the smaller canvas side) of it.
export const ARC_DEPTH_BANDS = [
  { reach: 0.2, alpha: 1, width: 1.5 },
  { reach: 0.45, alpha: 0.6, width: 1.1 },
  { reach: 0.8, alpha: 0.32, width: 0.85 },
  { reach: Infinity, alpha: 0.14, width: 0.65 },
];

// Which ARC_DEPTH_BANDS entry an arc from `a` to `b` falls in, seen from the
// playhead `p` (null: no playhead yet, so everything is near).
export function arcBand(
  a: { x: number; y: number; z?: number },
  b: { x: number; y: number; z?: number },
  p: { x: number; y: number; z?: number } | null | undefined,
  unit: number,
) {
  if (!p) {
    return 0;
  }
  const dist = (q: { x: number; y: number; z?: number }) =>
    Math.hypot(q.x - p.x, q.y - p.y, (q.z ?? 0) - (p.z ?? 0));
  const mid = {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
  const near = Math.min(dist(a), dist(b), dist(mid)) / unit;
  const band = ARC_DEPTH_BANDS.findIndex((entry) => near < entry.reach);
  return band < 0 ? ARC_DEPTH_BANDS.length - 1 : band;
}

// A ripple's state at a given age: how far it has spread (0-1 of the way to
// the canvas corner), its share of the ring's amplitude, and its opacity.
// Amplitude falls off faster than opacity, so ripples relax into calm circles.
export function rippleAt(ageMs: number, lifeMs = RIPPLE_LIFE_MS) {
  const t = Math.min(1, Math.max(0, ageMs / lifeMs));
  const ease = 1 - (1 - t) ** 2;
  return { spread: ease, amplitude: (1 - t) ** 3, alpha: (1 - t) ** 1.5 };
}

// Block-averages the raw analyser samples and normalizes them to the frame's
// peak, so quiet passages still swing visibly. Loudness is shown separately
// through line width and glow.
export function shapeWaveform(wave: Float32Array, block = WAVE_BLOCK) {
  const shaped = new Float32Array(Math.floor(wave.length / block));
  let peak = WAVE_MIN_PEAK;
  for (let i = 0; i < shaped.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < block; j += 1) {
      sum += wave[i * block + j];
    }
    shaped[i] = sum / block;
    peak = Math.max(peak, Math.abs(shaped[i]));
  }
  for (let i = 0; i < shaped.length; i += 1) {
    shaped[i] /= peak;
  }
  return shaped;
}

// Colors each beat by its timbre, like the original Infinite Jukebox, so
// beats that sound alike (and so link by arcs) share a color. Timbre is
// normalized across the track and hues are quantized so arcs can be stroked
// in a few batches. Beats without segment data get "".
export type BeatPalette = { hueStart: number; hueRange: number; saturation: string };

const DEFAULT_BEAT_PALETTE: BeatPalette = {
  hueStart: 0,
  hueRange: 300,
  saturation: "100%",
};

export function computeBeatColors(
  beats: QuantumBase[],
  palette: BeatPalette = DEFAULT_BEAT_PALETTE,
): string[] {
  const timbres = beats.map(
    (beat) => (beat.oseg ?? beat.overlappingSegments?.[0])?.timbre ?? null,
  );
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const timbre of timbres) {
    for (let i = 0; timbre && i < 2; i += 1) {
      min[i] = Math.min(min[i], timbre[i + 1]);
      max[i] = Math.max(max[i], timbre[i + 1]);
    }
  }
  const norm = (value: number, i: number) =>
    max[i] > min[i] ? (value - min[i]) / (max[i] - min[i]) : 0.5;
  return timbres.map((timbre) => {
    if (!timbre) {
      return "";
    }
    // The default 300-degree range keeps the two extremes from wrapping
    // into the same red; styles narrow it (rustic) or open it up (psych).
    const hue =
      palette.hueStart +
      Math.round((norm(timbre[1], 0) * palette.hueRange) / 12) * 12;
    const light = 55 + Math.round(norm(timbre[2], 1) * 3) * 5;
    return `hsl(${hue}, ${palette.saturation}, ${light}%)`;
  });
}

function rms(wave: Float32Array) {
  let sum = 0;
  for (let i = 0; i < wave.length; i += 1) {
    sum += wave[i] * wave[i];
  }
  return Math.sqrt(sum / Math.max(1, wave.length));
}

type VizData = NonNullable<ReturnType<JukeboxEngine["getVisualizationData"]>>;

type LastUpdate = {
  index: number;
  animate: boolean;
  previousIndex: number | null;
};

type Point = { x: number; y: number };
type Point3 = { x: number; y: number; z: number };

interface VisualizationData {
  beats: QuantumBase[];
  edges: Edge[];
  lastBranchPoint: number;
  anchorEdgeId: number | null;
  userAnchorEdgeId: number | null;
}

const ANCHOR_HIGHLIGHT_COLOR = "#ff2d2d";

interface JumpLine {
  from: number;
  to: number;
  at: number;
}

type Positioner = (
  data: VisualizationData,
  width: number,
  height: number,
  // Animation phase in laps (0-1), for layouts with `travel`.
  phase?: number
) => Array<{ x: number; y: number; z?: number }>;

type EdgeControlPointResolver = (args: {
  edge: Edge | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromIndex: number;
  toIndex: number;
  data: VisualizationData;
  center: { x: number; y: number };
}) => [number, number];

type CanvasVizOptions = {
  enableInteraction?: boolean;
  forceBendEdges?: boolean;
  edgeControlPointResolver?: EdgeControlPointResolver;
  // Draw the beat ring itself as a live waveform (circular layouts only).
  waveRing?: boolean;
  // Turn the whole layout around the center while music plays.
  spin?: boolean;
  // Re-run the positioner with a phase that moves one lap per this many
  // beats while music plays.
  travel?: number;
  // Offer the follow cam on this layout.
  ride?: boolean;
  // Starting view angle (radians) for 3D layouts, so their depth shows
  // before any rotation or drag.
  view?: { yaw: number; pitch: number };
};

type VisualizationDefinition = {
  positioner: Positioner;
  options?: Omit<CanvasVizOptions, "enableInteraction">;
};

class CanvasViz {
  private readonly container: HTMLElement;
  private readonly baseCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;

  private size = { width: 0, height: 0 };
  private data: VisualizationData | null = null;
  private positions: Array<{ x: number; y: number }> = [];
  private center = { x: 0, y: 0 };
  private readonly bendCache = new Map<string, boolean>();

  private currentIndex = -1;
  private jumpLine: JumpLine | null = null;
  private selectedEdge: Edge | null = null;
  private overlayRafId: number | null = null;

  private onSelect: ((index: number) => void) | null = null;
  private onEdgeSelect: ((edge: Edge | null) => void) | null = null;

  private readonly positioner: Positioner;
  private readonly forceBendEdges: boolean;
  private readonly edgeControlPointResolver: EdgeControlPointResolver | null;
  private visible = true;
  private anchorHighlightEnabled = false;
  private readonly waveRing: boolean;
  private readonly spin: boolean;
  private basePositions: Array<{ x: number; y: number; z?: number }> = [];
  private readonly travel: number;
  private readonly ride: boolean;
  private follow = false;
  private beatAt = 0;
  private camAt = 0;
  // Riding: unprojected world positions and each dot's closeness scale.
  private world: Point3[] = [];
  private dotScale: number[] | null = null;
  private particles: Array<{
    p: Point3;
    v: Point3;
    born: number;
    color: string;
  }> = [];
  private particlesAt = 0;
  private loudFast = 0;
  private loudSlow = 0;
  private burstAt = 0;
  private warp: { at: number; dir: number } | null = null;
  // A detected drop waits here for the next beat.
  private burstPending: number | null = null;
  // Where the playhead is on screen while riding (the warp's center).
  private warpCenter: Point = { x: 0, y: 0 };
  private readonly streaks = Array.from({ length: WARP_STREAKS }, () => ({
    angle: Math.random() * Math.PI * 2,
    offset: Math.random(),
    speed: 0.6 + Math.random() * 0.8,
  }));
  private cam: null | {
    pos: Point3;
    look: Point3;
    right: Point3;
    up: Point3;
    forward: Point3;
  } = null;
  private tumbleAngle = 0;
  private motionOn = false;
  // Current speed of the automatic motion, 0 (static) to 1.
  private motionLevel = 0;
  // Shrinks the tumbled layout so wide shapes turned sideways stay in frame.
  private fitScale = 1;
  // Drag rotation: the shown angles ease toward the targets; velocity
  // (radians per ms) keeps a released flick coasting.
  private drag = {
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    velYaw: 0,
    velPitch: 0,
    pointer: null as null | {
      id: number;
      x: number;
      y: number;
      at: number;
      moved: boolean;
    },
    suppressClick: false,
    moving: false,
  };
  private spinAngle = 0;
  private travelPhase = 0;
  private motionAt = 0;
  private beatMs = 500;
  private waveformSource: WaveformSource | null = null;
  private beatColors: string[] = [];
  private smoothedWave: Float32Array | null = null;
  private smoothedRing: Float32Array | null = null;
  private ripples: Array<{ wave: Float32Array; born: number; angle: number }> =
    [];
  private ripplesAt = 0;
  private rippleDue = false;
  // Live edges grouped by color so each frame needs one stroke per color.
  private edgesByColor = new Map<string, Edge[]>();

  private edgeGeometry = new WeakMap<
    Edge,
    { bend: boolean; control: [number, number] | null }
  >();
  private readonly theme = {
    edgeStroke: "rgba(74, 199, 255, 0.12)",
    beatFill: "rgba(255, 215, 130, 0.55)",
    edgeSelected: "#ff5b5b",
    beatHighlight: "#ffd46a",
    beatHighlightRgb: null as { r: number; g: number; b: number } | null,
    waveColors: ["#FF2BD6", "#00F0FF", "#F9F871"],
    beatPalette: DEFAULT_BEAT_PALETTE,
    // Fraction of the previous live frame kept each frame (motion trails).
    trails: 0,
    // Overall brightness of the live waveform layer (0-1).
    intensity: 1,
  };

  constructor(
    container: HTMLElement,
    positioner: Positioner,
    options: CanvasVizOptions = {}
  ) {
    this.container = container;
    this.positioner = positioner;
    this.forceBendEdges = options.forceBendEdges ?? false;
    this.edgeControlPointResolver = options.edgeControlPointResolver ?? null;
    this.waveRing = options.waveRing ?? false;
    this.spin = options.spin ?? false;
    this.travel = options.travel ?? 0;
    this.ride = options.ride ?? false;
    if (options.view) {
      this.drag.yaw = this.drag.targetYaw = options.view.yaw;
      this.drag.pitch = this.drag.targetPitch = options.view.pitch;
    }
    this.baseCanvas = document.createElement("canvas");
    this.overlayCanvas = document.createElement("canvas");
    const baseCtx = this.baseCanvas.getContext("2d");
    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!baseCtx || !overlayCtx) {
      throw new Error("Canvas not supported");
    }
    this.baseCtx = baseCtx;
    this.overlayCtx = overlayCtx;
    this.container.append(this.baseCanvas, this.overlayCanvas);
    this.applyCanvasStyles();
    this.updateTheme();
    this.resize();
    if (options.enableInteraction !== false) {
      this.overlayCanvas.addEventListener("click", this.handleCanvasClick);
      this.overlayCanvas.addEventListener(
        "pointerdown",
        this.handlePointerDown,
      );
      this.overlayCanvas.addEventListener(
        "pointermove",
        this.handlePointerMove,
      );
      this.overlayCanvas.addEventListener("pointerup", this.handlePointerUp);
      this.overlayCanvas.addEventListener(
        "pointercancel",
        this.handlePointerUp,
      );
      this.overlayCanvas.style.cursor = "grab";
      // Touch: sideways drags turn the view; vertical swipes still scroll.
      this.overlayCanvas.style.touchAction = "pan-y pinch-zoom";
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    const display = visible ? "block" : "none";
    this.baseCanvas.style.display = display;
    this.overlayCanvas.style.display = display;
    if (visible && this.data) {
      this.drawBase();
      this.drawOverlay();
    } else {
      this.cancelOverlayAnimation();
    }
  }

  setData(data: VisualizationData) {
    this.data = data;
    this.beatMs = medianBeatMs(data.beats);
    this.rebuildBeatColors();
    this.computePositions();
    this.computeEdgeGeometry();
    this.drawBase();
    this.drawOverlay();
  }

  refresh() {
    if (!this.data) {
      return;
    }
    this.updateTheme();
    this.rebuildBeatColors();
    this.drawBase();
    this.drawOverlay();
  }

  update(currentIndex: number, lastJumped: boolean, previousIndex: number | null) {
    this.rippleDue = currentIndex !== this.currentIndex;
    if (this.rippleDue) {
      this.beatAt = performance.now();
      if (this.burstPending !== null) {
        this.burst(this.burstPending);
        this.burstPending = null;
      }
    }
    if (lastJumped && previousIndex !== null && this.riding()) {
      this.warp = {
        at: performance.now(),
        dir: currentIndex >= previousIndex ? 1 : -1,
      };
    }
    this.currentIndex = currentIndex;
    if (lastJumped && previousIndex !== null) {
      this.jumpLine = {
        from: previousIndex,
        to: currentIndex,
        at: performance.now(),
      };
    }
    this.drawOverlay();
  }

  reset() {
    this.currentIndex = -1;
    this.jumpLine = null;
    this.selectedEdge = null;
    this.cancelOverlayAnimation();
    this.drawOverlay();
  }

  destroy() {
    this.overlayCanvas.removeEventListener("click", this.handleCanvasClick);
    this.overlayCanvas.removeEventListener(
      "pointerdown",
      this.handlePointerDown,
    );
    this.overlayCanvas.removeEventListener(
      "pointermove",
      this.handlePointerMove,
    );
    this.overlayCanvas.removeEventListener("pointerup", this.handlePointerUp);
    this.overlayCanvas.removeEventListener(
      "pointercancel",
      this.handlePointerUp,
    );
    this.baseCanvas.remove();
    this.overlayCanvas.remove();
    this.data = null;
    this.positions = [];
    this.edgeGeometry = new WeakMap();
    this.bendCache.clear();
    this.cancelOverlayAnimation();
  }

  setOnSelect(handler: (index: number) => void) {
    this.onSelect = handler;
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.onEdgeSelect = handler;
  }

  setSelectedEdge(edge: Edge | null) {
    this.selectedEdge = edge;
    this.drawOverlay();
  }

  // Starts (true) or stops the automatic motion, easing either way.
  setMotion(on: boolean) {
    this.motionOn = on;
    this.drawOverlay();
  }

  // Turns the follow cam on or off (only on layouts that offer it).
  setFollowCam(on: boolean) {
    this.follow = on;
    this.cam = null;
    if (!this.data) {
      return;
    }
    this.positions = this.placePositions();
    this.edgeGeometry = new WeakMap();
    this.drawBase();
    this.drawOverlay();
  }

  setAnchorHighlightEnabled(enabled: boolean) {
    this.anchorHighlightEnabled = enabled;
    this.drawBase();
  }

  // With a source set, arcs (and the ring, if enabled) are drawn live on the
  // overlay every frame while the source returns samples.
  setWaveformSource(source: WaveformSource | null) {
    this.waveformSource = source;
    this.drawBase();
    this.drawOverlay();
  }

  resizeNow() {
    this.resize();
  }

  private applyCanvasStyles() {
    this.baseCanvas.style.position = "absolute";
    this.baseCanvas.style.inset = "0";
    this.baseCanvas.style.width = "100%";
    this.baseCanvas.style.height = "100%";
    this.overlayCanvas.style.position = "absolute";
    this.overlayCanvas.style.inset = "0";
    this.overlayCanvas.style.width = "100%";
    this.overlayCanvas.style.height = "100%";
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.size = { width: rect.width, height: rect.height };
    this.baseCanvas.width = rect.width * dpr;
    this.baseCanvas.height = rect.height * dpr;
    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.data) {
      this.computePositions();
      this.computeEdgeGeometry();
      this.drawBase();
      this.drawOverlay();
    }
  }

  private computePositions() {
    if (!this.data) {
      return;
    }
    const { width, height } = this.size;
    this.center = { x: width / 2, y: height / 2 };
    this.basePositions = this.positioner(
      this.data,
      width,
      height,
      this.travelPhase,
    );
    this.positions = this.placePositions();
    this.bendCache.clear();
  }

  private computeEdgeGeometry() {
    if (!this.data) {
      return;
    }
    this.edgeGeometry = new WeakMap();
    for (const edge of this.data.edges) {
      if (edge.deleted) {
        continue;
      }
      const from = this.positions[edge.src.which];
      const to = this.positions[edge.dest.which];
      if (!from || !to) {
        continue;
      }
      this.edgeGeometry.set(
        edge,
        this.resolveEdgeGeometry(edge, from, to, edge.src.which, edge.dest.which)
      );
    }
  }

  private rebuildBeatColors() {
    if (!this.data) {
      return;
    }
    const { edges, beats } = this.data;
    this.beatColors = computeBeatColors(beats, this.theme.beatPalette);
    this.edgesByColor = new Map();
    const step = Math.max(1, Math.ceil(edges.length / MAX_WAVE_EDGES));
    for (let i = 0; i < edges.length; i += step) {
      const edge = edges[i];
      if (edge.deleted) {
        continue;
      }
      const color = this.beatColors[edge.src.which] ?? "";
      const bucket = this.edgesByColor.get(color);
      if (bucket) {
        bucket.push(edge);
      } else {
        this.edgesByColor.set(color, [edge]);
      }
    }
  }

  private updateTheme() {
    // Read from the container (not <html>) so per-style overrides set on
    // ancestors like <body> apply.
    const styles = getComputedStyle(this.container);
    const cssNumber = (name: string, fallback: number) => {
      const value = Number.parseFloat(styles.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    this.theme.edgeStroke =
      styles.getPropertyValue("--edge-stroke").trim() || this.theme.edgeStroke;
    this.theme.beatFill =
      styles.getPropertyValue("--beat-fill").trim() || this.theme.beatFill;
    this.theme.edgeSelected =
      styles.getPropertyValue("--edge-selected").trim() ||
      this.theme.edgeSelected;
    this.theme.beatHighlight =
      styles.getPropertyValue("--beat-highlight").trim() ||
      this.theme.beatHighlight;
    this.theme.beatHighlightRgb = this.parseThemeColor(this.theme.beatHighlight);
    this.theme.waveColors = this.theme.waveColors.map(
      (fallback, i) =>
        styles.getPropertyValue(`--wave-${i + 1}`).trim() || fallback,
    );
    this.theme.beatPalette = {
      hueStart: cssNumber("--beat-hue-start", DEFAULT_BEAT_PALETTE.hueStart),
      hueRange: cssNumber("--beat-hue-range", DEFAULT_BEAT_PALETTE.hueRange),
      saturation:
        styles.getPropertyValue("--beat-sat").trim() ||
        DEFAULT_BEAT_PALETTE.saturation,
    };
    this.theme.trails = Math.min(0.95, Math.max(0, cssNumber("--viz-trails", 0)));
    this.theme.intensity = Math.min(1, Math.max(0.1, cssNumber("--viz-intensity", 1)));
  }

  private parseThemeColor(color: string) {
    const value = color.trim();
    if (value.startsWith("#")) {
      const hex = value.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split("")
              .map((ch) => ch + ch)
              .join("")
          : hex.slice(0, 6);
      const r = Number.parseInt(normalized.slice(0, 2), 16);
      const g = Number.parseInt(normalized.slice(2, 4), 16);
      const b = Number.parseInt(normalized.slice(4, 6), 16);
      if (
        Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b)
      ) {
        return { r, g, b };
      }
    }
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(",").map((val) => Number.parseFloat(val));
      if (parts.length >= 3 && parts.every((val) => Number.isFinite(val))) {
        return { r: parts[0], g: parts[1], b: parts[2] };
      }
    }
    return null;
  }

  private drawBase() {
    if (!this.data || !this.visible) {
      return;
    }
    const { width, height } = this.size;
    this.baseCtx.clearRect(0, 0, width, height);
    this.baseCtx.save();
    this.baseCtx.lineWidth = 1;

    const edges = this.data.edges;
    const step =
      edges.length > MAX_EDGES_BASE
        ? Math.ceil(edges.length / MAX_EDGES_BASE)
        : 1;

    this.baseCtx.strokeStyle = this.theme.edgeStroke;
    // Live waveform mode draws the edges on the overlay instead.
    for (let i = 0; !this.waveformSource && i < edges.length; i += step) {
      const edge = edges[i];
      if (edge.deleted) {
        continue;
      }
      const from = this.positions[edge.src.which];
      const to = this.positions[edge.dest.which];
      if (!from || !to) {
        continue;
      }
      const geometry = this.getEdgeGeometry(edge);
      if (geometry?.bend && geometry.control) {
        this.baseCtx.beginPath();
        this.baseCtx.moveTo(from.x, from.y);
        this.baseCtx.quadraticCurveTo(
          geometry.control[0],
          geometry.control[1],
          to.x,
          to.y
        );
        this.baseCtx.stroke();
      } else {
        this.baseCtx.beginPath();
        this.baseCtx.moveTo(from.x, from.y);
        this.baseCtx.lineTo(to.x, to.y);
        this.baseCtx.stroke();
      }
    }

    const highlightedAnchorEdgeId =
      this.data.userAnchorEdgeId ??
      (this.anchorHighlightEnabled ? this.data.anchorEdgeId : null);
    if (highlightedAnchorEdgeId !== null) {
      for (const edge of edges) {
        if (edge.deleted || edge.id !== highlightedAnchorEdgeId) {
          continue;
        }
        this.drawEdge(this.baseCtx, edge, ANCHOR_HIGHLIGHT_COLOR, 1.8);
        break;
      }
    }

    // Riding: nearer dots are drawn bigger, and a warp stretches them into
    // streaks away from (forward) or toward (back) the middle of the view.
    const warp = this.warpAmount();
    const pulse = 1 + BEAT_PULSE * this.beatPulse();
    const { x: wx, y: wy } = this.warpCenter;
    for (let i = 0; i < this.positions.length; i += 1) {
      const p = this.positions[i];
      if (!Number.isFinite(p.x)) {
        continue;
      }
      const color = this.beatColors[i] || this.theme.beatFill;
      const r =
        (this.dotScale ? Math.min(14, Math.max(0.6, 3 * this.dotScale[i])) : 2) *
        pulse;
      if (warp !== 0) {
        this.baseCtx.strokeStyle = color;
        this.baseCtx.lineWidth = r * 1.4;
        this.baseCtx.lineCap = "round";
        this.baseCtx.beginPath();
        this.baseCtx.moveTo(p.x, p.y);
        this.baseCtx.lineTo(
          p.x + (p.x - wx) * WARP_STRETCH * warp,
          p.y + (p.y - wy) * WARP_STRETCH * warp,
        );
        this.baseCtx.stroke();
        continue;
      }
      this.baseCtx.fillStyle = color;
      this.baseCtx.beginPath();
      this.baseCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.baseCtx.fill();
    }
    this.baseCtx.restore();
  }

  private drawOverlay() {
    const { width, height } = this.size;
    const wave =
      this.data && this.visible ? (this.waveformSource?.() ?? null) : null;
    if (wave && this.theme.trails > 0) {
      // Fade the last frame instead of clearing it, leaving motion trails.
      this.overlayCtx.save();
      this.overlayCtx.globalCompositeOperation = "destination-out";
      this.overlayCtx.fillStyle = `rgba(0, 0, 0, ${1 - this.theme.trails})`;
      this.overlayCtx.fillRect(0, 0, width, height);
      this.overlayCtx.restore();
    } else {
      this.overlayCtx.clearRect(0, 0, width, height);
    }
    if (!this.data || !this.visible) {
      this.cancelOverlayAnimation();
      return;
    }
    this.advanceMotion(wave !== null);
    if (this.waveformSource) {
      this.drawWaveLayer(wave);
    }
    this.drawOverlayMarkers();
    // Keep animating while audio flows or the view is being turned; markers
    // may have cancelled the frame.
    if (wave || this.drag.moving || this.motionSettling()) {
      this.requestOverlayAnimation();
    }
  }

  private drawWaveLayer(wave: Float32Array | null) {
    if (!this.data) {
      return;
    }
    const ctx = this.overlayCtx;
    const { width, height } = this.size;
    const energy = wave ? Math.min(1, rms(wave) * 3) : 0;
    const shaped = wave
      ? (this.smoothedWave = ease(this.smoothedWave, shapeWaveform(wave), WAVE_SMOOTHING))
      : null;
    if (!wave) {
      this.smoothedWave = null;
      this.smoothedRing = null;
      this.ripples = [];
      this.ripplesAt = 0;
    } else {
      this.detectBurst(rms(wave));
    }
    // Gradient axis slowly rotates so colors sweep across the arcs.
    const angle = performance.now() / 2500;
    const reach = Math.hypot(width, height) / 2;
    const gx = Math.cos(angle) * reach;
    const gy = Math.sin(angle) * reach;
    const gradient = ctx.createLinearGradient(
      this.center.x - gx,
      this.center.y - gy,
      this.center.x + gx,
      this.center.y + gy,
    );
    const [c1, c2, c3] = this.theme.waveColors;
    gradient.addColorStop(0, c1);
    gradient.addColorStop(0.5, c2);
    gradient.addColorStop(1, c3);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";

    // Trails keep old frames around, so dim each frame to compensate or the
    // additive blending stacks up into solid white.
    const trailDim = (1 - this.theme.trails * 0.75) * this.theme.intensity;
    // Flat views: calmer arcs, so the bundle at the playhead doesn't blow
    // out to white and loud passages don't fatten every line.
    const flat = !this.riding();
    const arcAlpha = (0.55 + energy * 0.45) * trailDim * (flat ? FLAT_ARC_DIM : 1);
    const arcWidth = flat ? 1 + energy : 1.2 + energy * 2;
    const playhead = this.world[this.currentIndex];
    const unit = Math.min(width, height);
    for (const [color, colorEdges] of this.edgesByColor) {
      ctx.strokeStyle = color || gradient;
      // Group by distance band so each band strokes in one go.
      const bands: Edge[][] = ARC_DEPTH_BANDS.map(() => []);
      for (const edge of colorEdges) {
        const a = this.world[edge.src.which];
        const b = this.world[edge.dest.which];
        if (a && b) {
          bands[arcBand(a, b, playhead, unit)].push(edge);
        }
      }
      bands.forEach((edges, band) => {
        if (edges.length === 0) {
          return;
        }
        ctx.globalAlpha = arcAlpha * ARC_DEPTH_BANDS[band].alpha;
        ctx.lineWidth = arcWidth * ARC_DEPTH_BANDS[band].width;
        if (this.riding()) {
          const buckets: StrokeBuckets = new Map();
          const style = color || gradient;
          const width = RIDE_ARC_WIDTH * ARC_DEPTH_BANDS[band].width;
          ctx.globalAlpha *= RIDE_ARC_DIM;
          for (const edge of edges) {
            addScaledLine(buckets, this.arcPoints3D(edge, shaped), width, () => style);
          }
          strokeBuckets(ctx, buckets);
          return;
        }
        ctx.beginPath();
        for (const edge of edges) {
          const from = this.positions[edge.src.which];
          const to = this.positions[edge.dest.which];
          if (!from || !to) {
            continue;
          }
          const geometry = this.getEdgeGeometry(edge);
          const control =
            geometry?.bend && geometry.control
              ? { x: geometry.control[0], y: geometry.control[1] }
              : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          const amplitude = Math.min(
            WAVE_ARC_MAX_PX,
            Math.hypot(to.x - from.x, to.y - from.y) * WAVE_ARC_RATIO,
          );
          traceWaveCurve(
            ctx,
            from,
            control,
            to,
            shaped,
            edge.id * 37,
            amplitude,
          );
        }
        ctx.stroke();
      });
    }

    if (this.waveRing && this.positions.length > 0) {
      // Ring size from the flat layout; the tumble is applied while tracing.
      const p = this.basePositions[0];
      const radius = Math.hypot(p.x - this.center.x, p.y - this.center.y);
      const ringAmplitude = radius * WAVE_RING_RATIO;
      const ringWave = wave
        ? (this.smoothedRing = ease(this.smoothedRing, spikeWaveform(wave), RING_SMOOTHING))
        : null;
      if (ringWave) {
        this.drawRipples(ringWave, radius, ringAmplitude, reach, gradient, trailDim);
      }
      if (this.riding()) {
        const points = this.ringPoints3D(
          radius * (1 + RIDE_RING_OFFSET),
          ringWave,
          ringAmplitude * RIDE_RING_LIFT,
          this.spinAngle,
        );
        // Glow underlay, then each beat's color, both thinning with distance.
        const glow: StrokeBuckets = new Map();
        addScaledLine(glow, points, RIDE_RING_WIDTH * 1.5, () => gradient);
        ctx.globalAlpha = 0.6 * trailDim;
        strokeBuckets(ctx, glow);
        const beatCount = this.beatColors.length;
        const colored: StrokeBuckets = new Map();
        addScaledLine(
          colored,
          points,
          RIDE_RING_WIDTH,
          (k) =>
            this.beatColors[Math.floor((k / (points.length - 1)) * beatCount)] ||
            gradient,
        );
        ctx.globalAlpha = trailDim;
        strokeBuckets(ctx, colored);
      } else {
        const ring: Point[] = [];
        traceWaveRing(
          this.projectedSink({
                // A NaN entry marks a gap (part of the ring behind the follow cam).
                moveTo: (x, y) => {
                  if (ring.length > 0) {
                    ring.push({ x: NaN, y: NaN });
                  }
                  ring.push({ x, y });
                },
                lineTo: (x, y) => ring.push({ x, y }),
              }),
          this.center,
          radius,
          ringWave,
          ringAmplitude,
          this.spinAngle,
        );
        // Glow underlay, then the ring in each beat's color on top.
        ctx.globalAlpha = 0.6 * trailDim;
        ctx.lineWidth = 4;
        ctx.strokeStyle = gradient;
        ctx.shadowColor = c1;
        ctx.shadowBlur = 12 + energy * 24;
        ctx.beginPath();
        ring.forEach((pt, k) =>
          k === 0 || !Number.isFinite(ring[k - 1].x)
            ? ctx.moveTo(pt.x, pt.y)
            : ctx.lineTo(pt.x, pt.y),
        );
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = trailDim;
        ctx.lineWidth = 3;
        const beatCount = this.beatColors.length;
        let k = 0;
        while (k < ring.length - 1) {
          const color = this.beatColors[Math.floor((k / (ring.length - 1)) * beatCount)];
          ctx.strokeStyle = color || gradient;
          ctx.beginPath();
          ctx.moveTo(ring[k].x, ring[k].y);
          // Extend the run while the next ring point maps to the same color.
          do {
            k += 1;
            if (Number.isFinite(ring[k - 1].x)) {
              ctx.lineTo(ring[k].x, ring[k].y);
            } else {
              ctx.moveTo(ring[k].x, ring[k].y);
            }
          } while (
            k < ring.length - 1 &&
            this.beatColors[Math.floor((k / (ring.length - 1)) * beatCount)] === color
          );
          ctx.stroke();
        }
      }
    }
    this.drawParticles(ctx, trailDim);
    this.drawWarpStreaks(ctx, c2);
    ctx.restore();
  }

  // Watches loudness for a sudden rise (a drop or pick-up) and fires a
  // particle burst from the playhead.
  private detectBurst(level: number) {
    const now = performance.now();
    if (
      this.loudSlow > 0 &&
      this.loudFast > this.loudSlow * BURST_RATIO &&
      this.loudFast > BURST_MIN &&
      now - this.burstAt > BURST_GAP_BEATS * this.beatMs
    ) {
      this.burstAt = now;
      this.burstPending = Math.min(
        1,
        this.loudFast / this.loudSlow - BURST_RATIO + 0.3,
      );
    }
    // ~0.1 s and ~3 s averages at 60 fps.
    this.loudFast = this.loudFast * 0.8 + level * 0.2;
    this.loudSlow = this.loudSlow
      ? this.loudSlow * 0.995 + level * 0.005
      : level;
  }

  private burst(strength: number) {
    // Riding, burst a little ahead where the camera is looking, slower, so
    // it fills the view instead of flying straight past.
    const riding = this.riding() && this.cam;
    const origin = riding
      ? this.cam!.look
      : this.world[Math.max(0, this.currentIndex)];
    if (!origin) {
      return;
    }
    const now = performance.now();
    const unit =
      Math.min(this.size.width, this.size.height) * (riding ? 0.3 : 1);
    const color =
      this.beatColors[Math.max(0, this.currentIndex)] ||
      this.theme.waveColors[1];
    const count = Math.round(40 + 80 * strength);
    for (let i = 0; i < count; i += 1) {
      // Random direction on a sphere, random speed (px per ms).
      const z = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const speed = (unit * (0.1 + Math.random() * 0.35)) / 1000;
      this.particles.push({
        p: { ...origin },
        v: {
          x: Math.cos(a) * r * speed,
          y: Math.sin(a) * r * speed,
          z: z * speed,
        },
        born: now,
        color,
      });
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, trailDim: number) {
    const now = performance.now();
    const elapsed = this.particlesAt
      ? Math.min(100, now - this.particlesAt)
      : 0;
    this.particlesAt = now;
    const lifeMs = PARTICLE_LIFE_BEATS * this.beatMs;
    this.particles = this.particles.filter((pt) => now - pt.born < lifeMs);
    const pulse = 1 + BEAT_PULSE * this.beatPulse();
    const riding = this.riding();
    const drag = PARTICLE_DRAG ** (elapsed / (1000 / 60));
    const warp = this.warpAmount();
    for (const pt of this.particles) {
      pt.p.x += pt.v.x * elapsed;
      pt.p.y += pt.v.y * elapsed;
      pt.p.z += pt.v.z * elapsed;
      pt.v.x *= drag;
      pt.v.y *= drag;
      pt.v.z *= drag;
      const view = this.view3D(pt.p);
      if (!Number.isFinite(view.x)) {
        continue;
      }
      const life = 1 - (now - pt.born) / lifeMs;
      // Small sparks on the layouts; bigger and nearer-is-larger when riding.
      const r =
        (riding ? Math.min(10, Math.max(1, 4.5 * view.scale)) : 1.1) * pulse;
      ctx.globalAlpha = life * trailDim;
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = pt.color;
      ctx.beginPath();
      if (warp !== 0) {
        ctx.lineWidth = r;
        ctx.moveTo(view.x, view.y);
        ctx.lineTo(
          view.x + (view.x - this.warpCenter.x) * WARP_STRETCH * warp,
          view.y + (view.y - this.warpCenter.y) * WARP_STRETCH * warp,
        );
        ctx.stroke();
      } else {
        ctx.arc(view.x, view.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Star streaks for the lightspeed warp: rushing out from the middle when
  // jumping forward in the song, pulling in toward it when jumping back.
  private drawWarpStreaks(ctx: CanvasRenderingContext2D, color: string) {
    const amount = Math.abs(this.warpAmount());
    if (amount === 0 || !this.warp) {
      return;
    }
    const { width, height } = this.size;
    const { x: cx, y: cy } = this.warpCenter;
    // Far enough to reach the farthest corner from the playhead.
    const reach = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(width - cx, cy),
      Math.hypot(cx, height - cy),
      Math.hypot(width - cx, height - cy),
    );
    const age = (performance.now() - this.warp.at) / (WARP_BEATS * this.beatMs);
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (const streak of this.streaks) {
      let phase = (streak.offset + age * streak.speed) % 1;
      if (this.warp.dir < 0) {
        phase = 1 - phase;
      }
      const inner = phase * phase * reach;
      const length = amount * reach * 0.35 * (0.3 + phase);
      const outer =
        this.warp.dir > 0 ? inner + length : Math.max(0, inner - length);
      const cos = Math.cos(streak.angle);
      const sin = Math.sin(streak.angle);
      ctx.globalAlpha = amount * 0.8 * phase;
      ctx.lineWidth = 0.5 + 2 * phase;
      ctx.beginPath();
      ctx.moveTo(cx + cos * inner, cy + sin * inner);
      ctx.lineTo(cx + cos * outer, cy + sin * outer);
      ctx.stroke();
    }
  }

  // 1 right on a beat, easing to 0 over the first part of it.
  private beatPulse() {
    if (!this.beatAt) {
      return 0;
    }
    const t =
      (performance.now() - this.beatAt) / (this.beatMs * BEAT_PULSE_SHARE);
    return t >= 1 ? 0 : (1 - t) ** 2;
  }

  // Signed warp strength now: 0 when idle, rising to +-1 and back over
  // WARP_BEATS (+ forward, - back).
  private warpAmount() {
    if (!this.warp || !this.riding()) {
      return 0;
    }
    const age = (performance.now() - this.warp.at) / (WARP_BEATS * this.beatMs);
    if (age >= 1) {
      this.warp = null;
      return 0;
    }
    return Math.sin(Math.PI * age) * this.warp.dir;
  }

  // An arc as a 3D curve between its beats, bowed out in its own fixed
  // random direction, with the waveform rippling along that direction.
  private arcPoints3D(edge: Edge, wave: Float32Array | null): ScaledPoint[] {
    const a = this.world[edge.src.which];
    const b = this.world[edge.dest.which];
    if (!a || !b) {
      return [];
    }
    const cx = b.x - a.x;
    const cy = b.y - a.y;
    const cz = b.z - a.z;
    const length = Math.hypot(cx, cy, cz);
    if (length < 1) {
      return [];
    }
    // Two directions perpendicular to the chord: one across the ground,
    // one rising out of it; the arc picks a fixed blend of them.
    const flat = Math.hypot(cx, cy) || 1;
    const u1 = { x: cy / flat, y: -cx / flat, z: 0 };
    const u2 = {
      x: (u1.y * cz - u1.z * cy) / length,
      y: (u1.z * cx - u1.x * cz) / length,
      z: (u1.x * cy - u1.y * cx) / length,
    };
    const turn = (((edge.id * 2654435761) % 4096) / 4096) * Math.PI * 2;
    const dir = {
      x: u1.x * Math.cos(turn) + u2.x * Math.sin(turn),
      y: u1.y * Math.cos(turn) + u2.y * Math.sin(turn),
      z: u1.z * Math.cos(turn) + u2.z * Math.sin(turn),
    };
    const bow = length * RIDE_ARC_LIFT;
    const ctrl = {
      x: (a.x + b.x) / 2 + dir.x * bow,
      y: (a.y + b.y) / 2 + dir.y * bow,
      z: (a.z + b.z) / 2 + dir.z * bow,
    };
    const amplitude = Math.min(WAVE_ARC_MAX_PX, length * WAVE_ARC_RATIO);
    const points: ScaledPoint[] = [];
    for (let k = 0; k < WAVE_EDGE_POINTS; k += 1) {
      const t = k / (WAVE_EDGE_POINTS - 1);
      const m = 1 - t;
      const wobble =
        waveSample(wave, k + edge.id * 37) * amplitude * Math.sin(Math.PI * t);
      points.push(
        this.cameraView({
          x: m * m * a.x + 2 * m * t * ctrl.x + t * t * b.x + dir.x * wobble,
          y: m * m * a.y + 2 * m * t * ctrl.y + t * t * b.y + dir.y * wobble,
          z: m * m * a.z + 2 * m * t * ctrl.z + t * t * b.z + dir.z * wobble,
        }),
      );
    }
    return points;
  }

  // Ring (or ripple) points riding: on the ground at `radius`, with the
  // waveform rising up out of it. NaN entries are hidden behind the camera.
  private ringPoints3D(
    radius: number,
    wave: Float32Array | null,
    amplitude: number,
    rotation: number,
  ): ScaledPoint[] {
    const half = WAVE_RING_POINTS / 2;
    const points: ScaledPoint[] = [];
    for (let k = 0; k <= WAVE_RING_POINTS; k += 1) {
      const mirrored = k <= half ? k : WAVE_RING_POINTS - k;
      const angle =
        (k / WAVE_RING_POINTS) * Math.PI * 2 - Math.PI / 2 + rotation;
      points.push(
        this.cameraView({
          x: this.center.x + Math.cos(angle) * radius,
          y: this.center.y + Math.sin(angle) * radius,
          z: waveSample(wave, mirrored) * amplitude,
        }),
      );
    }
    return points;
  }

  // Spins, travels and tumbles the layout while audio plays (paused: holds
  // still, and resumes without a jump). Beats move, so edge curves are re-resolved and
  // the base layer (beat dots) redrawn; bend decisions stay cached by index.
  private advanceMotion(playing: boolean) {
    const now = performance.now();
    if (!this.data) {
      return;
    }
    const elapsed = this.motionAt ? Math.min(100, now - this.motionAt) : 0;
    this.motionAt = now;
    if (elapsed === 0) {
      return;
    }
    const dragged = this.advanceDrag(elapsed);
    const frames = elapsed / (1000 / 60);
    const target = this.motionOn ? 1 : 0;
    this.motionLevel += (target - this.motionLevel) * (1 - MOTION_EASE ** frames);
    if (Math.abs(target - this.motionLevel) < 0.002) {
      this.motionLevel = target;
    }
    // Switched off: drift back to the static view (the short way round).
    const returning = !this.motionOn && this.awayFromRest();
    if (returning) {
      const k = 1 - RETURN_EASE ** frames;
      const toRest = (value: number, lap: number) => {
        const off = value > lap / 2 ? value - lap : value;
        const next = off * (1 - k);
        return Math.abs(next) < 1e-4 ? 0 : (next + lap) % lap;
      };
      this.spinAngle = toRest(this.spinAngle, Math.PI * 2);
      this.tumbleAngle = toRest(this.tumbleAngle, Math.PI * 2);
      this.travelPhase = toRest(this.travelPhase, 1);
    }
    const moving = playing && this.motionLevel > 0;
    if (!moving && !returning) {
      if (dragged) {
        this.positions = this.placePositions();
        this.edgeGeometry = new WeakMap();
        this.drawBase();
      }
      return;
    }
    const level = moving ? this.motionLevel : 0;
    if (this.spin) {
      this.spinAngle =
        (this.spinAngle +
          (elapsed / (RING_SPIN_BEATS * this.beatMs)) * Math.PI * 2 * level) %
        (Math.PI * 2);
    }
    if (this.travel) {
      const { width, height } = this.size;
      this.travelPhase =
        (this.travelPhase + (elapsed / (this.travel * this.beatMs)) * level) % 1;
      this.basePositions = this.positioner(
        this.data,
        width,
        height,
        this.travelPhase,
      );
    }
    this.tumbleAngle =
      (this.tumbleAngle +
        (elapsed / (TUMBLE_BEATS * this.beatMs)) * Math.PI * 2 * level) %
      (Math.PI * 2);
    this.positions = this.placePositions();
    this.edgeGeometry = new WeakMap();
    this.drawBase();
  }

  // Layout positions after the in-plane spin, then the 3D tumble, scaled to
  // stay inside the canvas.
  private placePositions() {
    const cos = Math.cos(this.spinAngle);
    const sin = Math.sin(this.spinAngle);
    const { x: cx, y: cy } = this.center;
    const world = this.basePositions.map(({ x, y, z }) => ({
      x: cx + (x - cx) * cos - (y - cy) * sin,
      y: cy + (x - cx) * sin + (y - cy) * cos,
      z: z ?? 0,
    }));
    this.world = world;
    if (this.riding()) {
      this.fitScale = 1;
      this.aimCamera(world);
      const views = world.map((p) => this.cameraView(p));
      this.dotScale = views.map((v) => v.scale);
      return views.map(({ x, y }) => ({ x, y }));
    }
    this.dotScale = null;
    const tumbled = world.map((p) => this.tumble(p));
    // Keep within the room the flat layout already uses on each axis, so a
    // resting layout isn't shrunk.
    const reach = (points: Point[], axis: "x" | "y") =>
      points.reduce(
        (max, p) => Math.max(max, Math.abs(p[axis] - this.center[axis])),
        1,
      );
    this.fitScale = Math.min(
      1,
      reach(this.basePositions, "x") / reach(tumbled, "x"),
      reach(this.basePositions, "y") / reach(tumbled, "y"),
    );
    return tumbled.map((p) => this.fit(p));
  }

  private tumble(point: Point & { z?: number }): Point {
    const { width, height } = this.size;
    return tumblePoint(
      point,
      this.center,
      this.tumbleAngle,
      (TUMBLE_FOCAL * Math.max(width, height)) / 2,
      this.drag.yaw,
      this.drag.pitch,
    );
  }

  private awayFromRest() {
    return this.spinAngle !== 0 || this.tumbleAngle !== 0 || this.travelPhase !== 0;
  }

  // Whether the motion is still speeding up, slowing down or returning to
  // the static view (keeps frames coming even while paused).
  private motionSettling() {
    return (
      this.motionLevel !== (this.motionOn ? 1 : 0) ||
      (!this.motionOn && this.awayFromRest())
    );
  }

  // Steps the drag rotation: coast a released flick, then ease the shown
  // angles toward the targets. Returns whether the view moved.
  private advanceDrag(elapsed: number) {
    const d = this.drag;
    const frames = elapsed / (1000 / 60);
    if (!d.pointer) {
      d.targetYaw += d.velYaw * elapsed;
      d.targetPitch += d.velPitch * elapsed;
      d.velYaw *= DRAG_FRICTION ** frames;
      d.velPitch *= DRAG_FRICTION ** frames;
    }
    const keep = DRAG_EASE ** frames;
    const stepYaw = (d.targetYaw - d.yaw) * (1 - keep);
    const stepPitch = (d.targetPitch - d.pitch) * (1 - keep);
    d.yaw += stepYaw;
    d.pitch += stepPitch;
    const settling =
      Math.abs(d.targetYaw - d.yaw) + Math.abs(d.targetPitch - d.pitch) >
        1e-4 || Math.abs(d.velYaw) + Math.abs(d.velPitch) > 1e-6;
    d.moving = d.pointer !== null || settling;
    return Math.abs(stepYaw) + Math.abs(stepPitch) > 0;
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.data) {
      return;
    }
    this.drag.pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      moved: false,
    };
    this.drag.suppressClick = false;
    this.drag.velYaw = 0;
    this.drag.velPitch = 0;
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    const p = this.drag.pointer;
    if (!p || p.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;
    if (!p.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      p.moved = true;
      this.overlayCanvas.setPointerCapture(event.pointerId);
      this.overlayCanvas.style.cursor = "grabbing";
    }
    const dt = Math.max(1, event.timeStamp - p.at);
    const yaw = dx * DRAG_SENSITIVITY;
    const pitch = dy * DRAG_SENSITIVITY;
    this.drag.targetYaw += yaw;
    this.drag.targetPitch += pitch;
    // Smoothed drag speed, kept as momentum on release.
    this.drag.velYaw = this.drag.velYaw * 0.6 + (yaw / dt) * 0.4;
    this.drag.velPitch = this.drag.velPitch * 0.6 + (pitch / dt) * 0.4;
    p.x = event.clientX;
    p.y = event.clientY;
    p.at = event.timeStamp;
    this.drag.moving = true;
    this.requestOverlayAnimation();
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    const p = this.drag.pointer;
    if (!p || p.id !== event.pointerId) {
      return;
    }
    this.drag.pointer = null;
    if (p.moved) {
      // The click that follows a drag shouldn't select an arc.
      this.drag.suppressClick = true;
      this.overlayCanvas.style.cursor = "grab";
      // Let go after holding still: no flick.
      if (event.timeStamp - p.at > 80) {
        this.drag.velYaw = 0;
        this.drag.velPitch = 0;
      }
      this.requestOverlayAnimation();
    }
  };

  private fit(point: Point): Point {
    const { x: cx, y: cy } = this.center;
    return {
      x: cx + (point.x - cx) * this.fitScale,
      y: cy + (point.y - cy) * this.fitScale,
    };
  }

  // Applies the current 3D tumble (and fit), or the follow cam, to a flat
  // layout point.
  private project(point: Point): Point {
    if (this.riding()) {
      return this.cameraProject({ x: point.x, y: point.y, z: 0 });
    }
    return this.fit(this.tumble(point));
  }

  private riding() {
    return this.follow && this.ride;
  }

  // Places the follow cam behind and above where the playhead is now (eased
  // between beats), facing along the line.
  private aimCamera(world: Point3[]) {
    const n = world.length;
    if (n === 0) {
      return;
    }
    const now = performance.now();
    const i = Math.max(0, this.currentIndex) % n;
    const frac = Math.min(1, (now - this.beatAt) / this.beatMs);
    const a = world[i];
    const b = world[(i + 1) % n];
    const target = {
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      z: a.z + (b.z - a.z) * frac,
    };
    const behind = world[(i - RIDE_LOOK + n) % n];
    const ahead = world[(i + RIDE_LOOK) % n];
    let hx = ahead.x - behind.x;
    let hy = ahead.y - behind.y;
    const len = Math.hypot(hx, hy) || 1;
    hx /= len;
    hy /= len;
    // Dragging sideways orbits the camera around the playhead.
    const oc = Math.cos(this.drag.yaw);
    const os = Math.sin(this.drag.yaw);
    [hx, hy] = [hx * oc - hy * os, hx * os + hy * oc];
    const unit = Math.min(this.size.width, this.size.height);
    const wantPos = {
      x: target.x - hx * RIDE_BACK * unit,
      y: target.y - hy * RIDE_BACK * unit,
      z: target.z + RIDE_HEIGHT * unit,
    };
    const wantLook = {
      x: target.x + hx * RIDE_AHEAD * unit,
      y: target.y + hy * RIDE_AHEAD * unit,
      z: target.z,
    };
    const prev = this.cam;
    const frames = this.camAt
      ? Math.min(6, (now - this.camAt) / (1000 / 60))
      : 0;
    this.camAt = now;
    // Faster during a warp, so the jump feels like a teleport.
    const k = prev ? 1 - (this.warp ? 0.75 : RIDE_EASE) ** frames : 1;
    const ease = (from: Point3 | undefined, to: Point3) =>
      from
        ? {
            x: from.x + (to.x - from.x) * k,
            y: from.y + (to.y - from.y) * k,
            z: from.z + (to.z - from.z) * k,
          }
        : to;
    const pos = ease(prev?.pos, wantPos);
    const look = ease(prev?.look, wantLook);
    // Camera basis; world "up" is +z (toward the viewer of the flat layout).
    const norm = (v: Point3) => {
      const l = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    };
    const forward = norm({
      x: look.x - pos.x,
      y: look.y - pos.y,
      z: look.z - pos.z,
    });
    const right = norm({ x: -forward.y, y: forward.x, z: 0 });
    const up = {
      x: forward.y * right.z - forward.z * right.y,
      y: forward.z * right.x - forward.x * right.z,
      z: forward.x * right.y - forward.y * right.x,
    };
    this.cam = { pos, look, right, up, forward };
    const raw = this.cameraView(target, false);
    if (Number.isFinite(raw.x)) {
      this.warpCenter = { x: raw.x, y: raw.y };
    }
  }

  // Projects a world point through the follow cam. Points behind the camera
  // come back as NaN, which canvas drawing skips.
  private cameraProject(p: Point3): Point {
    const c = this.cam;
    if (!c) {
      return { x: p.x, y: p.y };
    }
    const { width, height } = this.size;
    const dx = p.x - c.pos.x;
    const dy = p.y - c.pos.y;
    const dz = p.z - c.pos.z;
    const depth = dx * c.forward.x + dy * c.forward.y + dz * c.forward.z;
    if (depth < RIDE_NEAR * Math.min(width, height)) {
      return { x: NaN, y: NaN };
    }
    return this.cameraView(p);
  }

  // Follow-cam projection plus a size scale (1 = as close as the playhead).
  // A warp zooms the view out (forward) or in (back) around the playhead.
  private cameraView(p: Point3, warped = true): Point & { scale: number } {
    const c = this.cam;
    const { width, height } = this.size;
    if (!c) {
      return { x: p.x, y: p.y, scale: 1 };
    }
    const dx = p.x - c.pos.x;
    const dy = p.y - c.pos.y;
    const dz = p.z - c.pos.z;
    const depth = dx * c.forward.x + dy * c.forward.y + dz * c.forward.z;
    const unit = Math.min(width, height);
    if (depth < RIDE_NEAR * unit) {
      return { x: NaN, y: NaN, scale: 0 };
    }
    const focal = (RIDE_FOCAL * width) / depth;
    const x =
      width / 2 + (dx * c.right.x + dy * c.right.y + dz * c.right.z) * focal;
    const y = height / 2 - (dx * c.up.x + dy * c.up.y + dz * c.up.z) * focal;
    const zoom = warped ? 1 - WARP_FOV * this.warpAmount() : 1;
    const { x: wx, y: wy } = this.warpCenter;
    return {
      x: wx + (x - wx) * zoom,
      y: wy + (y - wy) * zoom,
      scale: (RIDE_BACK * unit) / depth,
    };
  }

  // Any world point to the screen: through the follow cam when riding,
  // otherwise through the tumble.
  private view3D(p: Point3): Point & { scale: number } {
    if (this.riding()) {
      return this.cameraView(p);
    }
    return { ...this.fit(this.tumble(p)), scale: 1 };
  }

  // Path sink that projects each point before passing it on. Points hidden
  // behind the follow cam break the path instead of joining across the gap.
  private projectedSink(sink: PathSink): PathSink {
    let broken = true;
    const step = (x: number, y: number, move: boolean) => {
      const p = this.project({ x, y });
      if (!Number.isFinite(p.x)) {
        broken = true;
      } else if (move || broken) {
        sink.moveTo(p.x, p.y);
        broken = false;
      } else {
        sink.lineTo(p.x, p.y);
      }
    };
    return {
      moveTo: (x, y) => step(x, y, true),
      lineTo: (x, y) => step(x, y, false),
    };
  }

  // Emits a copy of the ring's waveform on each new beat and draws the live
  // ones growing out from the ring toward the canvas corners.
  private drawRipples(
    shaped: Float32Array,
    radius: number,
    amplitude: number,
    reach: number,
    gradient: CanvasGradient,
    trailDim: number,
  ) {
    const ctx = this.overlayCtx;
    const now = performance.now();
    const newest = this.ripples[this.ripples.length - 1];
    // A jump updates the viz twice in one beat; that's still one ripple.
    if (this.rippleDue && (!newest || now - newest.born > 100)) {
      this.ripples.push({
        wave: shaped.slice(),
        born: now,
        angle: this.spinAngle,
      });
    }
    this.rippleDue = false;
    const life = RIPPLE_LIFE_BEATS * this.beatMs;
    this.ripples = this.ripples.filter((r) => now - r.born < life);
    const elapsed = this.ripplesAt ? Math.min(100, now - this.ripplesAt) : 0;
    this.ripplesAt = now;
    const spinRate = this.spin
      ? ((Math.PI * 2) / (RING_SPIN_BEATS * this.beatMs)) * this.motionLevel
      : 0;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    for (const ripple of this.ripples) {
      const state = rippleAt(now - ripple.born, life);
      const r = radius + state.spread * (reach - radius);
      ripple.angle += spinRate * (radius / r) ** 2 * elapsed;
      ctx.globalAlpha = 0.45 * state.alpha * trailDim;
      ctx.beginPath();
      if (this.riding()) {
        const points = this.ringPoints3D(
          r,
          ripple.wave,
          amplitude * state.amplitude * RIDE_RING_LIFT,
          ripple.angle,
        );
        const buckets: StrokeBuckets = new Map();
        addScaledLine(buckets, points, RIDE_RING_WIDTH * 0.6, () => gradient);
        strokeBuckets(ctx, buckets);
        continue;
      }
      traceWaveRing(
        this.projectedSink(ctx),
        this.center,
        r,
        ripple.wave,
        amplitude * state.amplitude,
        ripple.angle,
      );
      ctx.stroke();
    }
  }

  private drawOverlayMarkers() {
    if (this.selectedEdge && !this.selectedEdge.deleted) {
      this.drawEdge(
        this.overlayCtx,
        this.selectedEdge,
        this.theme.edgeSelected,
        4
      );
    }
    if (this.currentIndex < 0) {
      return;
    }
    const current = this.positions[this.currentIndex];
    if (current) {
      this.overlayCtx.fillStyle = this.theme.beatHighlight;
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(current.x, current.y, 10, 0, Math.PI * 2);
      this.overlayCtx.fill();
    }
    if (this.jumpLine) {
      const age = performance.now() - this.jumpLine.at;
      if (age < 1000) {
        const from = this.positions[this.jumpLine.from];
        const to = this.positions[this.jumpLine.to];
        if (from && to) {
          const alpha = 1 - age / 1000;
          // Softer on the flat views; the ride view keeps the full flash.
          const flash = this.riding() ? 1 : JUMP_FLASH_FIXED;
          const jumpColor = this.resolveBeatJumpColor(alpha * flash);
          // Starts thick and glowing, thinning as it fades out.
          const jumpWidth = 2 + 8 * alpha * flash;
          this.overlayCtx.save();
          this.overlayCtx.lineCap = "round";
          this.overlayCtx.shadowColor = this.theme.beatHighlight;
          this.overlayCtx.shadowBlur = 24 * alpha * flash;
          if (this.shouldBendEdge(from, to, this.jumpLine.from, this.jumpLine.to)) {
            const control = this.resolveControlPointForPair(
              from,
              to,
              this.jumpLine.from,
              this.jumpLine.to
            );
            this.drawBentLineWithControl(
              this.overlayCtx,
              from,
              to,
              control,
              jumpColor,
              jumpWidth
            );
          } else {
            this.overlayCtx.strokeStyle = jumpColor;
            this.overlayCtx.lineWidth = jumpWidth;
            this.overlayCtx.beginPath();
            this.overlayCtx.moveTo(from.x, from.y);
            this.overlayCtx.lineTo(to.x, to.y);
            this.overlayCtx.stroke();
          }
          this.overlayCtx.restore();
        }
        this.requestOverlayAnimation();
      } else {
        this.jumpLine = null;
        this.cancelOverlayAnimation();
      }
    } else {
      this.cancelOverlayAnimation();
    }
  }

  private requestOverlayAnimation() {
    if (this.overlayRafId !== null) {
      return;
    }
    this.overlayRafId = window.requestAnimationFrame(() => {
      this.overlayRafId = null;
      this.drawOverlay();
    });
  }

  private cancelOverlayAnimation() {
    if (this.overlayRafId === null) {
      return;
    }
    window.cancelAnimationFrame(this.overlayRafId);
    this.overlayRafId = null;
  }

  private resolveBeatJumpColor(alpha: number) {
    if (this.theme.beatHighlightRgb) {
      const { r, g, b } = this.theme.beatHighlightRgb;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return this.theme.beatHighlight;
  }

  private readonly handleCanvasClick = (event: MouseEvent) => {
    if (this.drag.suppressClick) {
      this.drag.suppressClick = false;
      return;
    }
    if (!this.data || !this.visible) {
      return;
    }
    const rect = this.overlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.onSelect) {
      const maxDistance = BEAT_SELECT_RADIUS_PX;
      let bestIndex = -1;
      let bestDist = Infinity;
      for (let i = 0; i < this.positions.length; i += 1) {
        const p = this.positions[i];
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestDist <= maxDistance) {
        if (this.onEdgeSelect && this.selectedEdge) {
          this.onEdgeSelect(null);
        }
        this.onSelect(bestIndex);
        return;
      }
    }
    if (this.onEdgeSelect) {
      const edgeThreshold = EDGE_SELECT_RADIUS_PX;
      let bestEdge: Edge | null = null;
      let bestEdgeDist = Infinity;
      for (const edge of this.data.edges) {
        if (edge.deleted) {
          continue;
        }
        const from = this.positions[edge.src.which];
        const to = this.positions[edge.dest.which];
        if (!from || !to) {
          continue;
        }
        const geometry = this.getEdgeGeometry(edge);
        if (!geometry) {
          continue;
        }
        const dist =
          geometry.bend && geometry.control
            ? distanceToQuadratic(
                { x, y },
                from,
                { x: geometry.control[0], y: geometry.control[1] },
                to,
              )
            : distanceToSegment(x, y, from.x, from.y, to.x, to.y);
        if (dist < bestEdgeDist) {
          bestEdgeDist = dist;
          bestEdge = edge;
        }
      }
      if (bestEdge && bestEdgeDist <= edgeThreshold) {
        const nextEdge = this.selectedEdge === bestEdge ? null : bestEdge;
        this.onEdgeSelect(nextEdge);
        return;
      }
      if (this.selectedEdge) {
        this.onEdgeSelect(null);
      }
    }
  };

  private drawEdge(
    ctx: CanvasRenderingContext2D,
    edge: Edge,
    color: string,
    lineWidth: number
  ) {
    const from = this.positions[edge.src.which];
    const to = this.positions[edge.dest.which];
    if (!from || !to) {
      return;
    }
    const geometry = this.getEdgeGeometry(edge);
    if (geometry?.bend && geometry.control) {
      this.drawBentLineWithControl(ctx, from, to, geometry.control, color, lineWidth);
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  private getEdgeGeometry(
    edge: Edge
  ): { bend: boolean; control: [number, number] | null } | null {
    const cached = this.edgeGeometry.get(edge);
    if (cached) {
      return cached;
    }
    const from = this.positions[edge.src.which];
    const to = this.positions[edge.dest.which];
    if (!from || !to) {
      return null;
    }
    const next = this.resolveEdgeGeometry(
      edge,
      from,
      to,
      edge.src.which,
      edge.dest.which
    );
    this.edgeGeometry.set(edge, next);
    return next;
  }

  private resolveEdgeGeometry(
    edge: Edge | null,
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex: number,
    toIndex: number
  ): { bend: boolean; control: [number, number] | null } {
    if (!this.data) {
      return { bend: false, control: null };
    }
    if (this.edgeControlPointResolver) {
      return {
        bend: true,
        control: this.edgeControlPointResolver({
          edge,
          from,
          to,
          fromIndex,
          toIndex,
          data: this.data,
          center: this.center,
        }),
      };
    }
    const bend = this.shouldBendEdge(from, to, fromIndex, toIndex);
    return {
      bend,
      control: bend ? this.getBendControlPoint(from, to) : null,
    };
  }

  private resolveControlPointForPair(
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex: number,
    toIndex: number
  ): [number, number] {
    return this.resolveEdgeGeometry(null, from, to, fromIndex, toIndex).control ?? [
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
    ];
  }

  private shouldBendEdge(
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex?: number,
    toIndex?: number
  ) {
    if (this.forceBendEdges) {
      return true;
    }
    if (fromIndex !== undefined && toIndex !== undefined) {
      const min = Math.min(fromIndex, toIndex);
      const max = Math.max(fromIndex, toIndex);
      const key = `${min}:${max}`;
      const cached = this.bendCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const computed = this.computeShouldBend(from, to);
      this.bendCache.set(key, computed);
      return computed;
    }
    return this.computeShouldBend(from, to);
  }

  private computeShouldBend(from: { x: number; y: number }, to: { x: number; y: number }) {
    const step = Math.max(1, Math.ceil(this.positions.length / MAX_EDGE_SAMPLES));
    for (let i = 0; i < this.positions.length; i += step) {
      const p = this.positions[i];
      if (!p) {
        continue;
      }
      if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) {
        continue;
      }
      const dist = distanceToSegment(p.x, p.y, from.x, from.y, to.x, to.y);
      if (dist <= BEAT_AVOID_RADIUS_PX) {
        return true;
      }
    }
    return false;
  }

  private drawBentLineWithControl(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    control: [number, number],
    color: string,
    lineWidth: number
  ) {
    const [cx, cy] = control;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.stroke();
  }

  private getBendControlPoint(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): [number, number] {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const dirX = this.center.x - mid.x;
    const dirY = this.center.y - mid.y;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen === 0) {
      return [mid.x, mid.y];
    }
    const normX = dirX / dirLen;
    const normY = dirY / dirLen;
    const centerDist = Math.hypot(this.center.x - mid.x, this.center.y - mid.y);
    return [
      mid.x + normX * (centerDist * 0.5),
      mid.y + normY * (centerDist * 0.5),
    ];
  }
}

function createArcDiagramPositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    const paddingX = 30;
    const timelineY = height * 0.5;
    const span = Math.max(0, width - paddingX * 2);
    if (count <= 0) {
      return [];
    }
    if (count === 1) {
      return [{ x: width / 2, y: timelineY }];
    }
    return Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      return {
        x: paddingX + span * t,
        y: timelineY,
      };
    });
  };
}

function createArcDiagramControlPointResolver(): EdgeControlPointResolver {
  return ({ edge, from, to, fromIndex, toIndex, center }) => {
    const midX = (from.x + to.x) / 2;
    const baseY = (from.y + to.y) / 2;
    const span = Math.abs(to.x - from.x);
    const forward =
      edge !== null ? edge.dest.which >= edge.src.which : toIndex >= fromIndex;
    // Gate: forward jumps arc above the timeline, backward jumps arc below.
    const direction = forward ? -1 : 1;
    const canvasHeight = center.y * 2;
    const availableLift =
      direction < 0
        ? baseY + 100
        : canvasHeight - baseY + 100;
    const maxLift = Math.max(4, availableLift);
    const minLift = Math.min(24, maxLift);
    const desiredLift = Math.max(minLift, span * 1.25);
    const lift = Math.min(maxLift, desiredLift);
    return [midX, baseY + direction * lift];
  };
}

function createGridPositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    let beatsPerBar = 4;
    if (count > 0) {
      const counts = new Map<number, number>();
      let totalParents = 0;
      const seenParents = new Set<object>();
      for (const beat of data.beats) {
        const parent = beat.parent;
        if (!parent?.children) {
          continue;
        }
        if (!seenParents.has(parent)) {
          seenParents.add(parent);
          const length = Math.max(1, parent.children.length);
          counts.set(length, (counts.get(length) ?? 0) + 1);
          totalParents += 1;
        }
      }
      if (counts.size > 0) {
        let best = beatsPerBar;
        let bestCount = -1;
        for (const [size, value] of counts.entries()) {
          if (value > bestCount) {
            bestCount = value;
            best = size;
          }
        }
        beatsPerBar = best;
      }
      if (totalParents === 0) {
        beatsPerBar = 4;
      }
    }
    const bars: Array<{ bar: QuantumBase | null; section: QuantumBase | null }> = [];
    const barIndex = new Map<QuantumBase, number>();
    for (const beat of data.beats) {
      const parent = beat.parent ?? null;
      if (parent && !barIndex.has(parent)) {
        barIndex.set(parent, bars.length);
        bars.push({ bar: parent, section: parent.parent ?? null });
      }
    }
    if (bars.length === 0) {
      const totalBars = Math.max(
        1,
        Math.ceil(count / Math.max(1, beatsPerBar))
      );
      for (let i = 0; i < totalBars; i += 1) {
        bars.push({ bar: null, section: null });
      }
    }
    const totalBars = Math.max(1, bars.length);
    const targetBarsPerRow = Math.max(1, Math.ceil(Math.sqrt(totalBars)));
    const rowBars: number[] = [];
    if (bars.some((entry) => entry.section)) {
      let currentSection: QuantumBase | null = bars[0]?.section ?? null;
      let sectionBars = 0;
      const pushSectionRows = () => {
        if (sectionBars <= 0) {
          return;
        }
        let remaining = sectionBars;
        while (remaining > 0) {
          const chunk = Math.min(remaining, targetBarsPerRow);
          rowBars.push(chunk);
          remaining -= chunk;
        }
      };
      for (const entry of bars) {
        if (entry.section !== currentSection) {
          pushSectionRows();
          currentSection = entry.section;
          sectionBars = 0;
        }
        sectionBars += 1;
      }
      pushSectionRows();
    } else {
      let remaining = totalBars;
      while (remaining > 0) {
        const chunk = Math.min(remaining, targetBarsPerRow);
        rowBars.push(chunk);
        remaining -= chunk;
      }
    }
    const rows = Math.max(1, rowBars.length);
    const paddingX = 28;
    const verticalPad = Math.max(18, Math.min(36, height * 0.08));
    const paddingTop = verticalPad;
    const paddingBottom = verticalPad;
    const gridW = width - paddingX * 2;
    const gridH = height - paddingTop - paddingBottom;
    const safeRatio = (index: number, max: number) =>
      max <= 1 ? 0.5 : index / (max - 1);
    const rowStartBar: number[] = [];
    let running = 0;
    for (const barsInRow of rowBars) {
      rowStartBar.push(running);
      running += barsInRow;
    }
    return Array.from({ length: count }, (_, i) => {
      const beat = data.beats[i];
      const parent = beat.parent ?? null;
      const barIdx = parent ? barIndex.get(parent) ?? 0 : Math.floor(i / beatsPerBar);
      let rowIndex = 0;
      for (let r = 0; r < rowBars.length; r += 1) {
        const start = rowStartBar[r] ?? 0;
        const end = start + rowBars[r];
        if (barIdx >= start && barIdx < end) {
          rowIndex = r;
          break;
        }
      }
      const barsInRow = rowBars[rowIndex] ?? 1;
      const rowBarOffset = Math.max(0, barIdx - (rowStartBar[rowIndex] ?? 0));
      let beatInBar = beat.indexInParent ?? -1;
      if (beatInBar < 0 && parent?.children) {
        beatInBar = parent.children.indexOf(beat);
      }
      if (beatInBar < 0) {
        beatInBar = i % Math.max(1, beatsPerBar);
      }
      const cols = Math.max(1, beatsPerBar * barsInRow);
      const col = Math.min(cols - 1, rowBarOffset * beatsPerBar + beatInBar);
      return {
        x: paddingX + safeRatio(col, cols) * gridW,
        y: paddingTop + safeRatio(rowIndex, rows) * gridH,
      };
    });
  };
}

// A helix along the width: seen side-on it's a sine wave, and the 3D tumble
// reveals the spiral. `phase` turns it about its own axis like a screw, so
// the wave appears to travel.
function createWavePositioner(): Positioner {
  return (
    data: VisualizationData,
    width: number,
    height: number,
    phase = 0,
  ) => {
    const count = data.beats.length;
    const padding = 28;
    const amp = Math.min(Math.max(0, height * 0.42), Math.max(0, height / 2 - 18));
    const center = height / 2;
    const span = width - padding * 2;
    const waveTurns = 3;
    return Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1);
      const angle = (t * waveTurns - phase) * Math.PI * 2;
      return {
        x: padding + span * t,
        y: center + Math.sin(angle) * amp,
        z: Math.cos(angle) * amp,
      };
    });
  };
}

// An hourglass of straight lines strung between two circles, like string
// art. Each line runs from one circle to the other while twisting
// HOURGLASS_TWIST of a turn, and lines alternate direction (down, up, down...)
// so both families of crossing lines appear and pinch into a waist. Beats sit
// along the lines in order; `phase` turns the hourglass on its vertical axis.
const HOURGLASS_LINES = 20;
// Twist per line in turns; with HOURGLASS_LINES it must come back round to the
// start (lines * twist a whole number). 0.35 turn -> waist ~45% of the rim.
const HOURGLASS_TWIST = 7 / 20;
export function createHourglassPositioner(): Positioner {
  return (
    data: VisualizationData,
    width: number,
    height: number,
    phase = 0,
  ) => {
    const count = data.beats.length;
    const cx = width / 2;
    const cy = height / 2;
    const halfHeight = Math.min(
      Math.max(0, height * 0.42),
      Math.max(0, height / 2 - 18),
    );
    const radius = Math.min(width * 0.32, halfHeight * 0.9);
    return Array.from({ length: count }, (_, i) => {
      const along = (i / Math.max(1, count)) * HOURGLASS_LINES;
      const line = Math.floor(along);
      const s = along - line;
      // Every line starts where the last ended, so angles keep advancing.
      const startAngle = (line * HOURGLASS_TWIST + phase) * Math.PI * 2;
      const endAngle = startAngle + HOURGLASS_TWIST * Math.PI * 2;
      // Straight chord between the rim points (not an arc round the rim).
      const x0 = Math.cos(startAngle) * radius;
      const z0 = Math.sin(startAngle) * radius;
      const x1 = Math.cos(endAngle) * radius;
      const z1 = Math.sin(endAngle) * radius;
      const down = line % 2 === 0;
      const y = (down ? -1 + 2 * s : 1 - 2 * s) * halfHeight;
      return {
        x: cx + x0 + (x1 - x0) * s,
        y: cy + y,
        z: z0 + (z1 - z0) * s,
      };
    });
  };
}

// The figure-eight. Beats flow round it with `phase`; one strand rises and
// the other dips (z) so the crossing is an over/under, like a coaster bridge.
function createInfinitePositioner(): Positioner {
  return (
    data: VisualizationData,
    width: number,
    height: number,
    phase = 0,
  ) => {
    const count = data.beats.length;
    const cx = width / 2;
    const cy = height / 2;
    const ampX = width * 0.4;
    const ampY = Math.min(Math.max(0, height * 0.42), Math.max(0, height / 2 - 18));
    return Array.from({ length: count }, (_, i) => {
      const t = (i / count + phase) * Math.PI * 2;
      return {
        x: cx + Math.sin(t) * ampX,
        y: cy + Math.sin(t * 2) * ampY,
        z: Math.cos(t) * ampY * 0.25,
      };
    });
  };
}

function createGalaxyPositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) * 0.49;
    const minRadius = Math.min(width, height) * 0.08;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1);
      const angle = i * goldenAngle;
      const radius = minRadius + (maxRadius - minRadius) * Math.sqrt(t);
      const wobble =
        0.06 * Math.sin(i * 12.9898) + 0.04 * Math.cos(i * 4.1414);
      const r = radius * (1 + wobble);
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      };
    });
  };
}

function getDefaultVisualizationDefinitions(): VisualizationDefinition[] {
  return [
    {
      positioner: createArcDiagramPositioner(),
      options: {
        forceBendEdges: true,
        edgeControlPointResolver: createArcDiagramControlPointResolver(),
      },
    },
    {
      positioner: JukeboxViz.createClassicPositioner(),
      options: { waveRing: true, spin: true, ride: true },
    },
    { positioner: createGalaxyPositioner() },
    { positioner: createGridPositioner() },
    {
      positioner: createInfinitePositioner(),
      options: { travel: INFINITE_TRAVEL_BEATS, ride: true },
    },
    {
      positioner: createWavePositioner(),
      // Looking partly along the helix so it reads as a coil, not a sine.
      options: { travel: WAVE_TRAVEL_BEATS, view: { yaw: 0.6, pitch: 0.3 } },
    },
    {
      positioner: createHourglassPositioner(),
      // Seen a little from above so the rims read as circles.
      options: { travel: INFINITE_TRAVEL_BEATS, view: { yaw: 0, pitch: 0.35 } },
    },
  ];
}

export class JukeboxViz {
  private readonly vizLayer: HTMLElement;
  private readonly definitions: VisualizationDefinition[];
  private readonly enableInteraction: boolean;
  private activeViz: CanvasViz | null = null;
  private activeIndex = 0;
  private visible = true;
  private data: VizData | null = null;
  private selectedEdge: Edge | null = null;
  private lastUpdate: LastUpdate | null = null;
  private anchorHighlightEnabled = false;
  private followCam = false;
  private motion = false;
  private waveformSource: WaveformSource | null = null;
  private onSelectHandler: ((index: number) => void) | null = null;
  private onEdgeSelectHandler: ((edge: Edge | null) => void) | null = null;

  static createClassicPositioner(): Positioner {
    return (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const radius = Math.min(width, height) * 0.48;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    };
  }

  constructor(
    vizLayer: HTMLElement,
    options?: {
      positioners?: Positioner[];
      enableInteraction?: boolean;
    }
  ) {
    this.vizLayer = vizLayer;
    this.enableInteraction = options?.enableInteraction ?? true;
    this.definitions = options?.positioners
      ? options.positioners.map((positioner) => ({ positioner }))
      : getDefaultVisualizationDefinitions();
    this.mountActiveVisualization(0);
  }

  getCount() {
    return this.definitions.length;
  }

  private createVisualization(index: number): CanvasViz | null {
    const definition = this.definitions[index];
    if (!definition) {
      return null;
    }
    const viz = new CanvasViz(this.vizLayer, definition.positioner, {
      enableInteraction: this.enableInteraction,
      ...(definition.options ?? {}),
    });
    viz.setAnchorHighlightEnabled(this.anchorHighlightEnabled);
    if (this.waveformSource) {
      viz.setWaveformSource(this.waveformSource);
    }
    viz.setVisible(this.visible);
    if (this.onSelectHandler) {
      viz.setOnSelect(this.onSelectHandler);
    }
    if (this.onEdgeSelectHandler) {
      viz.setOnEdgeSelect(this.onEdgeSelectHandler);
    }
    if (this.data) {
      viz.setData(this.data);
    }
    if (this.selectedEdge) {
      viz.setSelectedEdge(this.selectedEdge);
    }
    if (this.lastUpdate) {
      viz.update(
        this.lastUpdate.index,
        this.lastUpdate.animate,
        this.lastUpdate.previousIndex
      );
    }
    if (this.followCam) {
      viz.setFollowCam(true);
    }
    if (this.motion) {
      viz.setMotion(true);
    }
    return viz;
  }

  private mountActiveVisualization(index: number) {
    if (this.activeViz) {
      this.activeViz.destroy();
      this.activeViz = null;
    }
    this.activeViz = this.createVisualization(index);
    this.activeViz?.resizeNow();
  }

  setActiveIndex(index: number) {
    if (index < 0 || index >= this.definitions.length) {
      return;
    }
    if (this.activeViz && index === this.activeIndex) {
      this.activeViz.resizeNow();
      return;
    }
    this.activeIndex = index;
    this.mountActiveVisualization(index);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.activeViz?.setVisible(visible);
  }

  setData(data: VizData) {
    this.data = data;
    this.activeViz?.setData(data);
  }

  setAnchorHighlightEnabled(enabled: boolean) {
    this.anchorHighlightEnabled = enabled;
    this.activeViz?.setAnchorHighlightEnabled(enabled);
  }

  // Whether layout `index` offers the follow cam.
  canFollowCam(index: number) {
    return this.definitions[index]?.options?.ride ?? false;
  }

  setFollowCam(on: boolean) {
    this.followCam = on;
    this.activeViz?.setFollowCam(on);
  }

  setMotion(on: boolean) {
    this.motion = on;
    this.activeViz?.setMotion(on);
  }

  setWaveformSource(source: WaveformSource | null) {
    this.waveformSource = source;
    this.activeViz?.setWaveformSource(source);
  }

  refresh() {
    this.activeViz?.refresh();
  }

  resizeNow() {
    this.activeViz?.resizeNow();
  }

  resizeActive() {
    this.activeViz?.resizeNow();
  }

  update(index: number, animate: boolean, previousIndex: number | null) {
    this.lastUpdate = { index, animate, previousIndex };
    this.activeViz?.update(index, animate, previousIndex);
  }

  reset() {
    this.activeViz?.reset();
  }

  destroy() {
    this.activeViz?.destroy();
    this.activeViz = null;
    this.data = null;
    this.selectedEdge = null;
    this.lastUpdate = null;
    this.visible = false;
    this.activeIndex = 0;
    this.onSelectHandler = null;
    this.onEdgeSelectHandler = null;
  }

  setOnSelect(handler: (index: number) => void) {
    this.onSelectHandler = handler;
    this.activeViz?.setOnSelect(handler);
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.onEdgeSelectHandler = handler;
    this.activeViz?.setOnEdgeSelect(handler);
  }

  setSelectedEdge(edge: Edge | null) {
    this.selectedEdge = edge;
    this.activeViz?.setSelectedEdge(edge);
  }

  setSelectedEdgeActive(edge: Edge | null) {
    this.selectedEdge = edge;
    this.activeViz?.setSelectedEdge(edge);
  }
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  if (t <= 0) {
    return Math.hypot(px - x1, py - y1);
  }
  if (t >= 1) {
    return Math.hypot(px - x2, py - y2);
  }
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function distanceToQuadratic(
  point: Point,
  start: Point,
  control: Point,
  end: Point,
) {
  let closest = Infinity;
  const steps = 20;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const it = 1 - t;
    const qx = it * it * start.x + 2 * it * t * control.x + t * t * end.x;
    const qy = it * it * start.y + 2 * it * t * control.y + t * t * end.y;
    const d = Math.hypot(point.x - qx, point.y - qy);
    if (d < closest) {
      closest = d;
    }
  }
  return closest;
}
