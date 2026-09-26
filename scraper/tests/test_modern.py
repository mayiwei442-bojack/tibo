import unittest
from datetime import datetime, timezone
from scraper.parser import parse_posts, parse_detail, ScrapeError


def modern(time='10:01 PM · Sep 19, 2026', text='Codex status update'):
    return f'''<article><a href="/thsottiaux">Tibo</a>
      <a href="/thsottiaux/status/123">{time}</a>
      <div dir="auto"><span>{text}</span></div>
      <a aria-label="Reply" href="/thsottiaux/status/123">123 replies</a>
    </article>'''


class ModernMarkupTests(unittest.TestCase):
    def test_relative_date_requires_public_detail_resolution(self):
        result = parse_posts(modern(time='16h'), 'thsottiaux')[0]
        self.assertIsNone(result['publishedAt'])
        self.assertEqual(result['url'], 'https://x.com/thsottiaux/status/123')

    def test_extracts_absolute_date_from_utc_detail_view(self):
        result = parse_detail(modern(), 'https://x.com/thsottiaux/status/123')
        self.assertEqual(result['publishedAt'], '2026-09-19T22:01:00Z')
        self.assertEqual(result['text'], 'Codex status update')

    def test_detail_original_is_not_an_article(self):
        source = modern().replace('<article>', '<div>').replace('</article>', '</div>')
        source += modern(text='Reply, not original').replace('/status/123', '/status/456')
        result = parse_detail(source, 'https://x.com/thsottiaux/status/123')
        self.assertEqual(result['text'], 'Codex status update')
        self.assertEqual(result['publishedAt'], '2026-09-19T22:01:00Z')

    def test_profile_outer_link_does_not_hide_original_text(self):
        result = parse_posts('<div role="link">' + modern(time='16h') + '</div>', 'thsottiaux')
        self.assertEqual(result[0]['text'], 'Codex status update')

    def test_nested_quoted_article_is_not_a_timeline_post(self):
        quoted = '<div role="link"><article><a href="/thsottiaux/status/456">11h</a><div dir="auto">Quoted post</div></article></div>'
        source = modern(time='10h').replace('</article>', quoted + '</article>')
        result = parse_posts(source, 'thsottiaux')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['text'], 'Codex status update')
        self.assertEqual(result[0]['url'], 'https://x.com/thsottiaux/status/123')

    def test_ambiguous_time_is_not_guessed(self):
        with self.assertRaises(ScrapeError):
            parse_detail(modern(time='16h'), 'https://x.com/thsottiaux/status/123')

    def test_current_minute_is_deferred_to_avoid_missing_siblings(self):
        now = datetime.now(timezone.utc).strftime('%I:%M %p · %b %d, %Y')
        with self.assertRaisesRegex(ScrapeError, 'MINUTE_IN_PROGRESS'):
            parse_detail(modern(time=now), 'https://x.com/thsottiaux/status/123')
