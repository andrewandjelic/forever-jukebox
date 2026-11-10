import type { VocalMap } from "./vocals";

export interface TrackMeta {
  title?: string;
  artist?: string;
  duration?: number;
  tempo?: number;
  time_signature?: number;
  // Top Discogs styles from the engine's genre model, best first.
  genres?: Array<{ label: string; score: number }>;
}

export interface QuantumBase {
  start: number;
  duration: number;
  confidence?: number;
  which: number;
  prev: QuantumBase | null;
  next: QuantumBase | null;
  parent?: QuantumBase;
  children?: QuantumBase[];
  indexInParent?: number;
  overlappingSegments: Segment[];
  oseg?: Segment | null;
  neighbors: Edge[];
  allNeighbors: Edge[];
  reach?: number;
}

export interface Segment {
  start: number;
  duration: number;
  confidence: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  pitches: number[];
  timbre: number[];
  which: number;
}

export interface Edge {
  id: number;
  src: QuantumBase;
  dest: QuantumBase;
  distance: number;
  deleted: boolean;
}

export interface TrackAnalysis {
  sections: QuantumBase[];
  bars: QuantumBase[];
  beats: QuantumBase[];
  tatums: QuantumBase[];
  segments: Segment[];
  track?: TrackMeta;
  // Where the singing is, when the analysis carries a vocal map.
  vocals?: VocalMap | null;
  // Whether the cached nearest neighbors were picked under the vocal rule.
  neighborsRespectVocals?: boolean;
}

export interface JukeboxConfig {
  maxBranches: number;
  maxBranchThreshold: number;
  currentThreshold: number;
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
  minRandomBranchChance: number;
  maxRandomBranchChance: number;
  randomBranchChanceDelta: number;
  minLongBranch: number;
  minLongBranchPercent?: number;
  // Only jump where it keeps sung lines whole. Needs a vocal map; without
  // one it changes nothing.
  respectVocals?: boolean;
  // After a jump, at least this many beats play before the next one. Where a
  // song repeats itself closely, jump points sit on beat after beat and the
  // jumps otherwise come in bursts. The loop-back jump near the end, a
  // pinned anchor and a forced jump are never held back. 0 turns it off.
  minBeatsBetweenJumps?: number;
}

export interface JukeboxGraphState {
  computedThreshold: number;
  currentThreshold: number;
  lastBranchPoint: number;
  totalBeats: number;
  longestReach: number;
  allEdges: Edge[];
}

export interface JukeboxState {
  currentBeatIndex: number;
  beatsPlayed: number;
  currentTime: number;
  lastJumped: boolean;
  lastJumpTime: number | null;
  lastJumpFromIndex: number | null;
  lastJumpToIndex: number | null;
  currentThreshold: number;
  lastBranchPoint: number;
  curRandomBranchChance: number;
  // The jump the engine has already decided to take, if any: the beat it
  // will leave before (the arc's source) and the beat it will land on.
  nextJumpFromIndex?: number | null;
  nextJumpToIndex?: number | null;
}
