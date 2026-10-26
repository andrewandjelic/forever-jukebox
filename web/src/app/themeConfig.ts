export type ThemeName = "light" | "dark";

export const themeConfig: Record<ThemeName, Record<string, string>> = {
  dark: {
    // Core — cyberpunk: hot magenta, electric cyan, acid yellow on deep violet
    "--bg": "#07030F",
    "--text": "#F3EDFF",
    "--text-rgb": "243, 237, 255",
    "--muted": "#A99BC9",
    "--accent": "#00F0FF",
    "--title-accent": "#FF2BD6",
    "--title-glow": "rgba(255, 43, 214, 0.6)",
    "--scrim": "rgba(7, 3, 15, 0.8)",
    "--shadow-elevated": "rgba(255, 43, 214, 0.18)",
    "--shadow-soft": "rgba(0, 240, 255, 0.12)",
    "--danger": "#FF3B6B",
    "--danger-border": "#8A1240",
    "--danger-surface": "#2A0716",
    "--danger-text": "#FFC4D6",

    // Surfaces
    "--surface-panel": "rgba(18, 8, 38, 0.82)",
    "--surface-hero": "rgba(28, 10, 56, 0.85)",
    "--surface-control": "#2A1150",
    "--surface-control-hover": "#3A1870",

    // Borders
    "--border-panel": "rgba(0, 240, 255, 0.28)",
    "--border-hero": "rgba(255, 43, 214, 0.45)",
    "--border-control": "rgba(176, 102, 255, 0.55)",

    // Visualizer
    "--viz-bg":
      "radial-gradient(circle closest-side at 50% 50%, #2B0B4F 0%, #12052A 55%, #05020B 100%)",
    "--viz-shadow": "rgba(255, 43, 214, 0.3)",
    "--viz-overlay": "rgba(7, 3, 15, 0.65)",

    // Graph/Beat
    "--edge-stroke": "rgba(0, 240, 255, 0.45)",
    "--edge-selected": "#F9F871",
    "--beat-fill": "rgba(255, 43, 214, 0.75)",
    "--beat-highlight": "#F9F871",
    // Live waveform gradient stops (ring + arcs)
    "--wave-1": "#FF2BD6",
    "--wave-2": "#00F0FF",
    "--wave-3": "#F9F871",
  },
  light: {
    // Core
    "--bg": "#F6F1FF",
    "--text": "#261A38",
    "--text-rgb": "38, 26, 56",
    "--muted": "#635280",
    "--accent": "#2E8BFF",
    "--title-accent": "#B144FF",
    "--title-glow": "rgba(177, 68, 255, 0.34)",
    "--scrim": "rgba(38, 26, 56, 0.42)",
    "--shadow-elevated": "rgba(38, 26, 56, 0.22)",
    "--shadow-soft": "rgba(38, 26, 56, 0.16)",
    "--danger": "#B3261E",
    "--danger-border": "rgba(179, 38, 30, 0.36)",
    "--danger-surface": "#FCEEEE",
    "--danger-text": "#7A1B16",

    // Surfaces
    "--surface-panel": "#FCFAFF",
    "--surface-hero": "#EFE5FF",
    "--surface-control": "#E8DBFF",
    "--surface-control-hover": "#DDCCFF",

    // Borders
    "--border-panel": "rgba(73, 43, 113, 0.20)",
    "--border-hero": "rgba(91, 48, 150, 0.26)",
    "--border-control": "rgba(96, 56, 152, 0.34)",

    // Visualizer
    "--viz-bg":
      "radial-gradient(circle closest-side at 50% 50%, #D9C3FF 0%, #F6F1FF 100%)",
    "--viz-shadow": "rgba(101, 52, 168, 0.24)",
    "--viz-overlay": "rgba(250, 246, 255, 0.74)",

    // Graph/Beat
    "--edge-stroke": "rgba(77, 48, 120, 0.44)",
    "--edge-selected": "#7F39FB",
    "--beat-fill": "#B144FF",
    "--beat-highlight": "#B144FF",
    "--wave-1": "#B144FF",
    "--wave-2": "#2E8BFF",
    "--wave-3": "#FF4FA3",
  },
};
