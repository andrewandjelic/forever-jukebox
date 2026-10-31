"""Plain-track candidate scoring.

Ranks YouTube search results so the plain studio track -- official audio,
audio-only "Topic" channels -- outranks music videos, live cuts, remixes
and bootleg re-uploads. Queries arrive as "Artist - Track" from the web
client, and the Spotify duration (when known) is a first-class signal:
candidates far off the target are rejected outright.

Ported from the track-grab tool.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# Word-boundary patterns so titles like "Live Your Life" survive.
HARD_REJECT = [
    r"official\s+video",
    r"music\s+video",
    r"\bm\s*/?\s*v\b",          # "mv" / "m/v"
    r"video\s+oficial",
    r"video\s+clip",
    r"live\s+at",
    r"live\s+from",
    r"live\s+version",
    r"unplugged",
    r"live\s+lounge",
    r"\bconcert\b",
    r"in\s+session",
    r"\bai\b[\w\s]*\b(cover|version|song|remix)\b",
    r"\bcovers?\b",
    r"karaoke",
    r"instrumental",
    r"acoustic",
    r"acapella",
    r"\bmashups?\b",
    r"bass\s+boosted",
    r"\breverbs?\b",
    r"nightcore",
    r"\b8d\b",
    r"longer\s+version",       # stretched/slowed re-uploads
    r"type\s+beat",
    r"tribute",
    r"full\s+album",
    r"\b\d+\s*(hours?|hrs?)\b",  # "1 hour", "10 hours"
    r"muffled",
    r"reaction",
    r"slowed",
    r"sped\s+up",
]

# Rejects dropped when the query itself asks for that kind of track.
QUERY_SENSITIVE = {
    "remix": [r"\bremix(es|ed)?\b"],
    "cover": [r"\bcovers?\b", r"\bai\b[\w\s]*\b(cover|song)\b"],
    "live": [r"live\s+at", r"live\s+from", r"live\s+version",
             r"\bconcert\b", r"unplugged", r"live\s+lounge"],
    "instrumental": [r"instrumental"],
    "acoustic": [r"acoustic"],
    "acapella": [r"acapella"],
}

# Soft penalties: often still the plain audio, just not the best upload.
PENALTIES = [
    (r"\blive\b", 40, "standalone 'live'"),
    (r"\blyrics?\b", 20, "lyrics upload"),
    (r"\bfeat\.?\b|\bft\.", 15, "feat artist not in query"),
    (r"radio\s+edit", 25, "radio edit"),
    (r"\bextended\b", 10, "extended mix"),
]

# Penalties dropped when the query itself asks for that version.
QUERY_SENSITIVE_PENALTIES = {
    "live": [r"\blive\b"],
    "lyric": [r"\blyrics?\b"],
    "feat": [r"\bfeat\.?\b|\bft\."],
    "radio": [r"radio\s+edit"],   # the full-length original is usually canonical
    "extended": [r"\bextended\b"],
}

# Never reject "remastered", "album version", "radio edit", "explicit",
# "clean", "lyrics", "official audio", "audio" -- those are the plain track.

STOPWORDS = {
    "the", "a", "an", "and", "of", "feat", "ft", "with", "official",
    "audio", "video", "song", "radio", "edit", "version", "remastered",
}


def fold(text: str) -> str:
    """Lowercase and strip accents, so 'rufus' matches 'RÜFÜS'."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def strip_annotations(title: str) -> str:
    """Fold case/accents and drop (parenthetical) [bracketed] groups."""
    return fold(re.sub(r"[(\[{][^)\]}]*[)\]}]", " ", title))


def tokens(phrase: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9']+", fold(phrase))
            if len(w) > 1 and w not in STOPWORDS]


def token_ratio(haystack: str, phrase: str) -> float:
    toks = tokens(phrase)
    if not toks:
        return 0.0
    return sum(1 for w in toks if w in haystack) / len(toks)


def split_query(query: str) -> tuple[str, str]:
    """'Artist - Track' -> (artist, track); falls back to ('', query)."""
    parts = [p.strip() for p in re.split(r"\s+-\s+|:\s+", query, maxsplit=1)]
    if len(parts) == 2:
        return parts
    return "", query


def active_rejects(query: str) -> list[str]:
    q = query.lower()
    active: list[str] = []
    for key, patterns in QUERY_SENSITIVE.items():
        if re.search(rf"\b{key}", q):
            continue
        active.extend(patterns)
    return active


def title_rejected(title: str, query: str) -> str | None:
    """Return the reject reason if a title can't be the plain track."""
    t = fold(title)
    rejects = active_rejects(query)
    for pat in rejects:
        if re.search(pat, t):
            return f"rejected: {pat}"
    for pat in HARD_REJECT:
        if pat in rejects:
            continue
        if re.search(pat, t):
            return f"rejected: {pat}"
    return None


def score_candidate(
    entry: dict[str, Any],
    query: str,
    target_duration: float | None = None,
) -> tuple[float | None, str]:
    """Score a search candidate as the plain track for a query.

    Returns (score, reason); score is None when the candidate can't be
    the plain track, with reason saying why.
    """
    title = (entry.get("title") or "").strip()
    uploader = (entry.get("uploader") or entry.get("channel") or "").strip()
    duration = entry.get("duration")
    artist, track = split_query(query)
    q = query.lower()

    if duration is None:
        return None, "no duration"
    # the Spotify duration, when known, is the strongest fingerprint there is
    if target_duration is not None and abs(duration - target_duration) > 20:
        return None, f"duration {duration}s vs target {round(target_duration)}s"
    reason = title_rejected(title, query)
    if reason:
        return None, reason

    skipped_penalties: list[str] = []
    for word, pats in QUERY_SENSITIVE_PENALTIES.items():
        if re.search(rf"\b{word}", q):
            skipped_penalties.extend(pats)

    score = 0.0
    # the strongest plain-track signal: audio-only auto-generated channel
    if uploader.rstrip().endswith("- Topic"):
        score += 100
    if re.search(r"official\s+audio", fold(title)):
        score += 40
    elif re.search(r"\baudio\b", fold(title)):
        score += 10
    # the artist's own channel is the most trustworthy source
    if artist:
        artist_toks = tokens(artist)
        if artist_toks and all(w in fold(uploader) for w in artist_toks):
            score += 25
    # title should actually name the track (annotations stripped)
    clean = strip_annotations(title)
    score += token_ratio(clean, track) * 30
    if artist:
        score += token_ratio(clean, artist) * 15
    # vlogs and talk clips name the artist+track mid-sentence ("When Lil
    # Yachty was recording 'Poland'") -- charge for words the query doesn't
    # account for, since a plain upload's title is mostly query words
    query_toks = set(tokens(query))
    extra = [w for w in tokens(clean) if w not in query_toks]
    score -= min(len(extra) * 8, 40)
    # popular uploads skew official; runaway bootlegs stay niche
    views = entry.get("view_count")
    if isinstance(views, (int, float)):
        if views >= 10_000_000:
            score += 10
        elif views >= 1_000_000:
            score += 5
    # right length matters more than any keyword when Spotify tells us
    if target_duration is not None:
        diff = abs(duration - target_duration)
        if diff <= 5:
            score += 15
        elif diff <= 10:
            score += 5

    for pat, penalty, _why in PENALTIES:
        if pat in skipped_penalties:
            continue
        if re.search(pat, fold(title)):
            score -= penalty

    return score, ""


def rank_candidates(
    items: list[dict[str, Any]],
    query: str,
    target_duration: float | None = None,
) -> list[dict[str, Any]]:
    """Order candidates so the plain track comes first.

    Survivors of the scoring are ranked by score; anything the scorer
    rejected keeps its place after them (still duration-sorted when a
    target is known) so a human can still pick it deliberately.
    """
    scored: list[tuple[float, dict[str, Any]]] = []
    rejected: list[dict[str, Any]] = []
    for item in items:
        score, _reason = score_candidate(item, query, target_duration)
        if score is None:
            rejected.append(item)
        else:
            scored.append((score, item))
    if not scored:
        # nothing looked like the plain track -- keep the old behavior
        if target_duration is not None:
            items.sort(key=lambda i: abs(i["duration"] - target_duration))
        return items
    scored.sort(key=lambda p: p[0], reverse=True)
    if target_duration is not None and rejected:
        rejected.sort(key=lambda i: abs(i["duration"] - target_duration))
    return [item for _score, item in scored] + rejected