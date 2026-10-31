export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Listen time as a multiple of the song's own length, in whole tenths, so the
// counter only ticks up once per tenth of a play-through. Null when the length
// is unknown.
export function listenMultiplierTenths(
  listenSeconds: number,
  durationSeconds: number,
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  return Math.floor((Math.max(0, listenSeconds) * 10) / durationSeconds);
}

// "4.2" (or "4,2"), always one decimal.
export function formatListenMultiplier(tenths: number, locale?: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(tenths / 10);
}

export function formatDuration(seconds: number) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
