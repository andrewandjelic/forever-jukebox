from __future__ import annotations

import unittest

from api.track_scoring import rank_candidates, score_candidate, title_rejected


def entry(
    title: str,
    channel: str = "",
    duration: int = 180,
    vid: str = "vid",
) -> dict:
    return {"id": vid, "title": title, "channel": channel, "duration": duration}


class TitleRejectedTests(unittest.TestCase):
    def test_live_your_life_survives_live_reject(self) -> None:
        # word-boundary matching: the plain track "Live Your Life" is not a
        # live cut
        self.assertIsNone(
            title_rejected("Rihanna - Live Your Life (Official Audio)", "Rihanna - Live Your Life")
        )

    def test_music_video_rejected(self) -> None:
        self.assertIsNotNone(
            title_rejected("Lil Yachty - Poland (Official Video)", "Lil Yachty - Poland")
        )

    def test_longer_version_rejected(self) -> None:
        self.assertIsNotNone(
            title_rejected("Lil Yachty - Poland (LONGER VERSION)", "Lil Yachty - Poland")
        )

    def test_live_at_rejected(self) -> None:
        self.assertIsNotNone(
            title_rejected("Daft Punk - Alive 2007 Live at Coachella", "Daft Punk - Something About Us")
        )

    def test_live_allowed_when_query_asks_for_live(self) -> None:
        self.assertIsNone(
            title_rejected("Daft Punk - Something About Us (Live)", "Daft Punk - Something About Us (Live)")
        )

    def test_radio_edit_not_rejected(self) -> None:
        # only demoted, never rejected, unless the query says radio
        self.assertIsNone(
            title_rejected("Innerbloom (Radio Edit)", "Rufus Du Sol - Innerbloom")
        )


class ScoreCandidateTests(unittest.TestCase):
    def test_topic_channel_outranks_official_video(self) -> None:
        query = "Lil Yachty - Poland"
        topic = score_candidate(
            entry("Poland", "Lil Yachty - Topic", duration=84, vid="topic"), query, 84
        )
        video = score_candidate(
            entry("Lil Yachty - Poland (Official Video)", "Lil Yachty", duration=84, vid="video"),
            query,
            84,
        )
        self.assertIsNotNone(topic[0])
        self.assertIsNone(video[0])  # hard-rejected, not just outranked

    def test_duration_far_off_target_rejected(self) -> None:
        score, reason = score_candidate(
            entry("Poland", "Lil Yachty - Topic", duration=244, vid="slow"), "Lil Yachty - Poland", 84
        )
        self.assertIsNone(score)
        self.assertIn("duration", reason)

    def test_radio_edit_demoted_below_full_version(self) -> None:
        query = "Rufus Du Sol - Innerbloom"
        full = score_candidate(
            entry("Rufus Du Sol - Innerbloom (Official Audio)", "RÜFÜS DU SOL - Topic", duration=579, vid="full"),
            query,
            579,
        )
        radio = score_candidate(
            entry("Innerbloom (Radio Edit)", "Rufus Du Sol - Topic", duration=239, vid="radio"), query, 579
        )
        # the 3:59 radio edit is far off the Spotify target and drops out;
        # the full-length original survives
        self.assertIsNotNone(full[0])
        self.assertIsNone(radio[0])

    def test_accent_folding_matches_uploader(self) -> None:
        score, _ = score_candidate(
            entry("Innerbloom", "RÜFÜS DU SOL - Topic", duration=579, vid="x"),
            "Rufus Du Sol - Innerbloom",
            579,
        )
        self.assertGreaterEqual(score, 100)  # topic channel + artist uploader

    def test_feat_not_in_query_penalized(self) -> None:
        plain = score_candidate(
            entry("Poland", "Lil Yachty - Topic", duration=84, vid="plain"),
            "Lil Yachty - Poland",
            84,
        )
        feat = score_candidate(
            entry("Poland feat. Some Bootleg Artist", "Random Uploads", duration=84, vid="feat"),
            "Lil Yachty - Poland",
            84,
        )
        self.assertIsNotNone(plain[0])
        self.assertIsNotNone(feat[0])
        self.assertGreater(plain[0], feat[0])


class RankCandidatesTests(unittest.TestCase):
    def test_plain_track_first_rejects_after(self) -> None:
        query = "Lil Yachty - Poland"
        items = [
            entry("When Lil Yachty was recording 'Poland'", "Vlog Channel", duration=620, vid="vlog"),
            entry("Lil Yachty - Poland (Official Video)", "Lil Yachty", duration=84, vid="video"),
            entry("Poland", "Lil Yachty - Topic", duration=84, vid="topic"),
            entry("Poland (LONGER VERSION)", "Bootlegger", duration=244, vid="slow"),
        ]
        ranked = rank_candidates(items, query, 84)
        self.assertEqual(ranked[0]["id"], "topic")
        # the video and bootleg stay in the list for a manual override,
        # but after every surviving plain-track candidate
        self.assertEqual({item["id"] for item in ranked}, {"vlog", "video", "topic", "slow"})

    def test_keeps_duration_fallback_when_nothing_scores(self) -> None:
        items = [
            entry("Totally Unrelated Song", "Someone", duration=300, vid="far"),
            entry("Unrelated Too", "Someone Else", duration=100, vid="near"),
        ]
        ranked = rank_candidates(items, "Aphex Twin - Xtal", 110)
        self.assertEqual(ranked[0]["id"], "near")

    def test_return_shape_preserved(self) -> None:
        ranked = rank_candidates(
            [entry("Poland", "Lil Yachty - Topic", duration=84, vid="t")],
            "Lil Yachty - Poland",
            84,
        )
        self.assertEqual(set(ranked[0]), {"id", "title", "channel", "duration"})

    def test_vlog_name_dropping_the_track_loses_to_plain_upload(self) -> None:
        # regression: plain ytsearch pools have no "- Topic" channels, and a
        # vlog whose title names the artist+track mid-sentence used to
        # outrank the actual audio because every keyword filter passed
        query = "Lil Yachty - Poland"
        items = [
            entry('When Lil Yachty was recording "Poland"', "Trap Lore", duration=99, vid="vlog"),
            entry("Poland", "lil boat", duration=84, vid="plain"),
            entry("I PERFORMED POLAND IN POLAND 6 TIMES", "lil boat", duration=71, vid="performed"),
        ]
        ranked = rank_candidates(items, query, 84)
        self.assertEqual(ranked[0]["id"], "plain")

    def test_view_count_breaks_ties_toward_popular_uploads(self) -> None:
        ranked = rank_candidates(
            [
                {"id": "niche", "title": "Track", "channel": "Some Channel",
                 "duration": 180, "view_count": 1_000},
                {"id": "popular", "title": "Track", "channel": "Some Channel",
                 "duration": 180, "view_count": 11_000_000},
            ],
            "Artist - Track",
            180,
        )
        self.assertEqual(ranked[0]["id"], "popular")


if __name__ == "__main__":
    unittest.main()