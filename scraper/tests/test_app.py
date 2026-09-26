import os
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from scraper.app import app, browser_lock

client = TestClient(app)


class AppTests(unittest.TestCase):
    def test_missing_secret_fails_closed(self):
        with patch.dict(os.environ, {"SCRAPER_SECRET": ""}):
            self.assertEqual(client.post("/tweets", json={}).status_code, 401)

    def test_rejects_request_supplied_target(self):
        response = client.post("/tweets", json={"targetUrl": "https://example.com"})
        self.assertEqual(response.status_code, 422)

    def test_single_browser_at_a_time(self):
        with patch.dict(os.environ, {"SCRAPER_SECRET": "a" * 32}):
            browser_lock.acquire()
            try:
                response = client.post("/tweets", json={}, headers={"Authorization": "Bearer " + "a" * 32})
                self.assertEqual(response.status_code, 409)
            finally:
                browser_lock.release()

    def test_failure_details_are_not_exposed(self):
        process = MagicMock()
        process.communicate.return_value = ('{"error":"private details"}', 'private details')
        process.returncode = 1
        with patch.dict(os.environ, {"SCRAPER_SECRET": "a" * 32}), patch("scraper.app.subprocess.Popen", return_value=process), patch("scraper.app.os.killpg", create=True):
            response = client.post("/tweets", json={}, headers={"Authorization": "Bearer " + "a" * 32})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private", response.text)

    def test_safe_failure_stage_is_logged_without_request_secret(self):
        process = MagicMock()
        process.communicate.return_value = ('{"error":"TIMELINE_UNAVAILABLE","type":"TimeoutError","stage":"detail_wait"}', '')
        process.returncode = 1
        with patch.dict(os.environ, {"SCRAPER_SECRET": "a" * 32}), patch("scraper.app.subprocess.Popen", return_value=process), patch("scraper.app.os.killpg", create=True), patch("scraper.app.logger.warning") as warning:
            response = client.post("/tweets", json={}, headers={"Authorization": "Bearer " + "a" * 32})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('detail_wait', response.text)
            self.assertEqual(warning.call_args.args[1:4], ('detail_wait', 'TIMELINE_UNAVAILABLE', 'TimeoutError'))
            self.assertNotIn('a' * 32, str(warning.call_args))
