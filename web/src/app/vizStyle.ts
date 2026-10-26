import { getAppContext } from "./runtime";

// Per-song visual styles. Each is a set of CSS overrides keyed on
// body[data-style] (dark theme only; see the style sections in style.css).
export const VIZ_STYLES = [
  "cyberpunk",
  "rustic",
  "psychedelic",
  "soviet",
  "street",
  "celestial",
  "inferno",
  "bubblegum",
  "speakeasy",
  "irish",
] as const;
export type VizStyle = (typeof VIZ_STYLES)[number];

// Each label names the kind of music the style was made for.
export const VIZ_STYLE_LABELS: Record<VizStyle, string> = {
  cyberpunk: "Cyberpunk · Electronic",
  rustic: "Rustic · Country / Folk",
  psychedelic: "Psychedelic · Psych rock",
  soviet: "Soviet · Choir / March",
  street: "Street · Hip-hop",
  celestial: "Celestial · Ambient / Classical",
  inferno: "Inferno · Metal / Heavy bass",
  bubblegum: "Bubblegum · Pop",
  speakeasy: "Speakeasy · Jazz / Soul",
  irish: "Irish · Celtic / Trad",
};

const DEFAULT_STYLE: VizStyle = "cyberpunk";
const storageKey = (trackId: string) => `fj-viz-style:${trackId}`;

export type TrackGenre = { label: string; score: number };

// Discogs style labels ("Parent---Style") to visual styles. First matching
// rule wins per label, so order matters: specific before general.
const GENRE_RULES: Array<[RegExp, VizStyle]> = [
  [/Celtic|Irish|Gaelic/, "irish"],
  [/Brass & Military|Marches|Military|Choral/, "soviet"],
  [/Psychedelic|Shoegaze|Dream Pop|Space Rock|Krautrock|Stoner|Ethereal/, "psychedelic"],
  [/Happy Hardcore|Dance-pop|Bubblegum|Europop|K-pop|J-pop|Teen Pop|Synth-pop|Eurodance/, "bubblegum"],
  [/^Hip Hop|Grime|Trap|Drill/, "street"],
  [/Metal|Dubstep|Grindcore|Industrial|Drum n Bass|Breakcore|Noise|Hard Rock|Punk|Gabber|Speedcore/, "inferno"],
  [/Ambient|Downtempo|New Age|Drone|^Classical|Score|Soundtrack|Post-Rock/, "celestial"],
  [/^Folk, World, & Country|Country|Bluegrass|Folk Rock|Americana/, "rustic"],
  [/^Jazz|^Funk \/ Soul|^Blues|Swing|Lounge/, "speakeasy"],
  [/^Rock/, "psychedelic"],
  [/^Electronic/, "cyberpunk"],
  [/^Pop|^Latin|^Reggae/, "bubblegum"],
];

// Unmistakable names in the title/artist beat the audio's genre (a trap remix
// of an Irish rebel song should still look Irish).
const TITLE_RULES: Array<[RegExp, VizStyle]> = [
  [/\b(irish|celtic|black and tans|wolfe tones|dubliners|pogues)\b/i, "irish"],
  [/\b(soviet|red army|ussr)\b/i, "soviet"],
];

export function styleForTitle(title: string | null | undefined): VizStyle | null {
  return title
    ? (TITLE_RULES.find(([pattern]) => pattern.test(title))?.[1] ?? null)
    : null;
}

// Picks the style whose matching genres carry the most total score.
export function styleForGenres(
  genres: TrackGenre[] | null | undefined,
): VizStyle | null {
  const totals = new Map<VizStyle, number>();
  for (const { label, score } of genres ?? []) {
    const style = GENRE_RULES.find(([pattern]) => pattern.test(label))?.[1];
    if (style) {
      totals.set(style, (totals.get(style) ?? 0) + score);
    }
  }
  let best: VizStyle | null = null;
  for (const [style, total] of totals) {
    if (best === null || total > (totals.get(best) ?? 0)) {
      best = style;
    }
  }
  return best;
}

function getSavedStyle(trackId: string | null): VizStyle | null {
  if (!trackId) {
    return null;
  }
  try {
    const saved = localStorage.getItem(storageKey(trackId));
    return VIZ_STYLES.includes(saved as VizStyle) ? (saved as VizStyle) : null;
  } catch {
    return null;
  }
}

// The user's pick for this song wins, then a telling title, then the
// detected genre.
export function getTrackStyle(
  trackId: string | null,
  genres?: TrackGenre[] | null,
  title?: string | null,
): VizStyle {
  return (
    getSavedStyle(trackId) ??
    styleForTitle(title) ??
    styleForGenres(genres) ??
    DEFAULT_STYLE
  );
}

export function saveTrackStyle(trackId: string | null, style: VizStyle) {
  if (!trackId) {
    return;
  }
  try {
    localStorage.setItem(storageKey(trackId), style);
  } catch {
    // Private mode / blocked storage: the style just won't be remembered.
  }
}

export function applyStyle(style: VizStyle) {
  document.body.dataset.style = style;
  // The canvas viz reads its colors from CSS variables; repaint with them.
  getAppContext().jukebox?.refresh();
}
