import unittest
from datetime import datetime, timezone, timedelta
from scraper.parser import parse_posts, finalize_posts, target_profile, ScrapeError


def html(author="test", text="Codex reset soon", number=1, timestamp=None, pinned=False):
    timestamp = timestamp or datetime.now(timezone.utc).isoformat()
    return f'''<article data-testid="tweet">
      {'<span data-testid="socialContext">Pinned</span>' if pinned else ''}
      <a href="/{author}/status/{number}"><time datetime="{timestamp}"></time></a>
      <div data-testid="tweetText">{text}</div>
    </article>'''


class ParserTests(unittest.TestCase):
    def test_required_fields_and_emoji(self):
        result = parse_posts(html(text='<img alt="🚨"/> Codex <span>reset</span> soon'), "test")[0]
        self.assertEqual(result["text"], "🚨 Codex reset soon")
        self.assertEqual(result["url"], "https://x.com/test/status/1")
        self.assertTrue(result["publishedAt"].endswith("Z"))

    def test_excludes_other_authors(self):
        self.assertEqual(parse_posts(html(author="other"), "test"), [])

    def test_quote_text_does_not_replace_missing_own_text(self):
        content = html(text="").replace('<div data-testid="tweetText"></div>', '<div role="link"><div data-testid="tweetText">Quoted text</div></div>')
        with self.assertRaises(ScrapeError):
            parse_posts(content, "test")

    def test_empty_or_truncated_text_fails(self):
        with self.assertRaises(ScrapeError):
            parse_posts(html(text=""), "test")
        with self.assertRaises(ScrapeError):
            parse_posts(html().replace('</article>', '<a data-testid="tweet-text-show-more-link">Show more</a></article>'), "test")
        with self.assertRaises(ScrapeError):
            parse_posts(html(timestamp="bad"), "test")

    def test_pinned_post_does_not_establish_watermark_coverage(self):
        now = datetime.now(timezone.utc)
        source = html(number=1, timestamp=(now - timedelta(days=100)).isoformat(), pinned=True) + html(number=2, timestamp=now.isoformat())
        with self.assertRaisesRegex(ScrapeError, "COVERAGE_INCOMPLETE"):
            finalize_posts(parse_posts(source, "test"), (now - timedelta(days=1)).isoformat())
        self.assertEqual(len(finalize_posts(parse_posts(source, "test"),
                                            (now - timedelta(days=1)).isoformat(),
                                            allow_incomplete=True)), 2)

    def test_non_chronological_timeline_fails(self):
        now = datetime.now(timezone.utc)
        source = html(number=1, timestamp=(now - timedelta(days=1)).isoformat()) + html(number=2, timestamp=now.isoformat())
        with self.assertRaisesRegex(ScrapeError, "NOT_CHRONOLOGICAL"):
            finalize_posts(parse_posts(source, "test"), None)

    def test_empty_timeline_is_failure_not_zero_new_posts(self):
        with self.assertRaisesRegex(ScrapeError, "TIMELINE_UNAVAILABLE"):
            finalize_posts([], None)

    def test_covered_chronological_timeline_deduplicates(self):
        now = datetime.now(timezone.utc)
        older = now - timedelta(minutes=20)
        posts = parse_posts(html(number=2, timestamp=now.isoformat()) + html(number=1, timestamp=older.isoformat()), "test")
        result = finalize_posts(posts + posts, older.isoformat())
        self.assertEqual(len(result), 2)
        self.assertNotIn("pinned", result[0])

    def test_stale_bootstrap_fails(self):
        posts = parse_posts(html(timestamp=(datetime.now(timezone.utc) - timedelta(days=30)).isoformat()), "test")
        with self.assertRaisesRegex(ScrapeError, "NOT_RECENT"):
            finalize_posts(posts, None)

    def test_only_profile_urls_accepted(self):
        self.assertEqual(target_profile("https://x.com/Test"), ("https://x.com/test", "test"))
        for value in ["http://x.com/test", "https://example.com/test", "https://x.com/test/status/123", "https://x.com@test.invalid/test"]:
            with self.assertRaises(ScrapeError):
                target_profile(value)
