import {
  VOLUME_STORAGE_KEY,
  parseStoredVolumePct,
} from "@forever-jukebox/shared/audio/volume";

export function resolveStoredVolumePct(): number {
  try {
    return parseStoredVolumePct(localStorage.getItem(VOLUME_STORAGE_KEY));
  } catch {
    return parseStoredVolumePct(null);
  }
}

export function storeVolumePct(pct: number) {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(pct));
  } catch {
    // Volume still applies for this session without storage.
  }
}
