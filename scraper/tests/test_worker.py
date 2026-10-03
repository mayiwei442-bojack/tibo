import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

from scraper.worker import advance_timeline, diagnostic_progress, scrape
from scraper.tests.test_parser import html


class WorkerScrollTests(unittest.TestCase):
    def setUp(self):
        diagnostic_progress.update(posts=0, scrolls=0, scroll_y=0,
                                   scroll_height=0, articles=0, fallback_failed=0)

    def test_stalled_window_scroll_uses_article_container(self):
        page = MagicMock()
        page.evaluate.side_effect = [0, None, 0,
                                     {'y': 0, 'height': 1800, 'articles': 5}]
        page.viewport_size = {'height': 800}
        advance_timeline(page)
        page.locator.return_value.last.scroll_into_view_if_needed.assert_called_once()
        page.mouse.wheel.assert_called_once_with(0, 800)
        self.assertEqual(diagnostic_progress['scrolls'], 1)
        self.assertEqual(diagnostic_progress['articles'], 5)

    def test_visible_posts_return_with_explicit_incomplete_coverage(self):
        now = datetime.now(timezone.utc)
        oldest = now - timedelta(hours=2)
        source = html(author='thsottiaux', number=2, timestamp=now.isoformat()) + \
            html(author='thsottiaux', number=1, timestamp=oldest.isoformat())
        page = MagicMock()
        page.content.return_value = source

        def fetch(_target, **kwargs):
            kwargs['page_action'](page)
            response = MagicMock()
            response.status = 200
            return response

        with patch('scraper.worker.DynamicFetcher.fetch', side_effect=fetch), \
             patch('scraper.worker.advance_timeline'):
            result = scrape((oldest - timedelta(days=1)).isoformat())
        self.assertFalse(result['coverageComplete'])
        self.assertEqual(len(result['tweets']), 2)
        self.assertEqual(result['oldestOrdinaryPublishedAt'], oldest.isoformat().replace('+00:00', 'Z'))

    def test_moving_window_scroll_does_not_use_fallback(self):
        page = MagicMock()
        page.evaluate.side_effect = [100, None, 700,
                                     {'y': 700, 'height': 2600, 'articles': 8}]
        advance_timeline(page)
        page.mouse.wheel.assert_not_called()
        self.assertEqual(diagnostic_progress['scroll_y'], 700)

    def test_failed_optional_fallback_preserves_coverage_diagnostic(self):
        page = MagicMock()
        page.evaluate.side_effect = [0, None, 0,
                                     {'y': 0, 'height': 1800, 'articles': 5}]
        page.locator.return_value.last.scroll_into_view_if_needed.side_effect = TimeoutError()
        advance_timeline(page)
        self.assertEqual(diagnostic_progress['fallback_failed'], 1)
        self.assertEqual(diagnostic_progress['scrolls'], 1)
