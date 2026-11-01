import type { TabId } from "./context";
import { serializeParams } from "./tuning";

export type FaqSubtabId = "faq" | "whats-new";

export function pathForTab(tabId: TabId, trackId?: string | null) {
  if (tabId === "search") {
    return "/search";
  }
  if (tabId === "play") {
    if (trackId) {
      return `/listen/${encodeURIComponent(trackId)}`;
    }
    return "/listen";
  }
  if (tabId === "faq") {
    return "/faq";
  }
  return "/";
}

export function tabFromPathname(pathname: string): TabId {
  if (pathname.startsWith("/search")) {
    return "search";
  }
  if (pathname.startsWith("/listen")) {
    return "play";
  }
  if (pathname.startsWith("/faq") || pathname.startsWith("/whats-new")) {
    return "faq";
  }
  return "top";
}

export function urlForTrack(
  trackId: string,
  baseUrl: string,
  tuningParams?: string | null,
) {
  const url = new URL(pathForTrack(trackId, tuningParams), baseUrl);
  return url.toString();
}

export function pathForFaqSubtab(subtabId: FaqSubtabId) {
  return subtabId === "whats-new" ? "/whats-new" : "/faq";
}

export function pathForTrack(
  trackId: string,
  tuningParams?: string | null,
) {
  return `${pathForTab("play", trackId)}${buildSearchParams(tuningParams)}`;
}

export function buildSearchParams(tuningParams?: string | null) {
  const params = new URLSearchParams(tuningParams ?? "");
  // Links from when the Autocanonizer and Wub Machine existed may carry a
  // mode; they play in the jukebox now.
  params.delete("mode");
  const search = serializeParams(params);
  return search ? `?${search}` : "";
}
