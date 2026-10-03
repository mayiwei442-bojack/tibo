"""One bounded, anonymous browser run. JSON on stdout; no cookies or login flow."""
import json
import logging
import os
import sys
import time

from scrapling.fetchers import DynamicFetcher
from .parser import ScrapeError, finalize_posts, parse_posts, parse_detail, parse_time, target_profile, DETAIL_TIME_PATTERN
import re

diagnostic_stage = 'start'
diagnostic_progress = {'posts': 0, 'scrolls': 0, 'scroll_y': 0,
                       'scroll_height': 0, 'articles': 0, 'fallback_failed': 0}


def advance_timeline(page) -> None:
    """Advance the rendered timeline, including pages with a nested scroller."""
    before = page.evaluate("window.scrollY")
    page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
    page.wait_for_timeout(1200)
    after = page.evaluate("window.scrollY")
    if after <= before:
        # Reveal the last article through its scrollable ancestor if moving the
        # window did not work. Failure of this optional fallback must not turn
        # a coverage failure into an unrelated browser exception.
        try:
            page.locator('article').last.scroll_into_view_if_needed(timeout=5000)
            page.mouse.wheel(0, max(600, page.viewport_size['height']))
            page.wait_for_timeout(1200)
        except Exception:
            diagnostic_progress['fallback_failed'] = 1
    metrics = page.evaluate("""() => ({
        y: Math.round(window.scrollY),
        height: Math.round(document.documentElement.scrollHeight),
        articles: document.querySelectorAll('article').length
    })""")
    diagnostic_progress['scrolls'] += 1
    diagnostic_progress['scroll_y'] = max(diagnostic_progress['scroll_y'], metrics['y'])
    diagnostic_progress['scroll_height'] = max(diagnostic_progress['scroll_height'], metrics['height'])
    diagnostic_progress['articles'] = metrics['articles']


def scrape(since: str | None) -> dict:
    global diagnostic_stage
    target, author = target_profile(os.environ.get("TIBO_X_URL") or "https://x.com/thsottiaux")
    if since:
        parse_time(since)
    found: dict[str, dict] = {}
    action_errors: list[Exception] = []
    started = time.monotonic()
    diagnostic_stage = 'profile_fetch'

    def collect_page(page):
        global diagnostic_stage
        diagnostic_stage = 'timeline_wait'
        page.locator('article').first.wait_for(state="attached", timeout=15000)
        for _ in range(12):
            if time.monotonic() - started > 55:
                break
            diagnostic_stage = 'timeline_parse'
            for post in parse_posts(page.content(), author):
                if time.monotonic() - started > 60:
                    raise ScrapeError('TIMELINE_COVERAGE_INCOMPLETE')
                previous = found.get(post["url"])
                if post['publishedAt'] is None:
                    if previous:
                        continue
                    detail = page.context.new_page()
                    try:
                        diagnostic_stage = 'detail_open'
                        detail.goto(post['url'], wait_until='domcontentloaded', timeout=15000)
                        diagnostic_stage = 'detail_wait'
                        detail.locator('a').filter(has_text=re.compile(DETAIL_TIME_PATTERN)).first.wait_for(state='attached', timeout=10000)
                        diagnostic_stage = 'detail_parse'
                        resolved = parse_detail(detail.content(), post['url'])
                        resolved['pinned'] = post['pinned']
                        post = resolved
                    finally:
                        detail.close()
                if previous and (previous["text"] != post["text"] or previous["publishedAt"] != post["publishedAt"]):
                    raise ScrapeError("CONFLICTING_POST")
                found[post["url"]] = post
            diagnostic_progress['posts'] = len(found)
            ordinary = [p for p in found.values() if not p["pinned"]]
            if since and ordinary and min(parse_time(p["publishedAt"]) for p in ordinary) <= parse_time(since):
                break
            if not since and len(ordinary) >= 6:
                break
            if len(found) >= 180:
                break
            diagnostic_stage = 'timeline_scroll'
            advance_timeline(page)

    def collect(page):
        # Scrapling logs page_action exceptions instead of propagating them.
        # Keep our own error channel so partial extraction can never look successful.
        try:
            collect_page(page)
        except Exception as error:
            action_errors.append(error)

    response = DynamicFetcher.fetch(target, headless=True, timeout=20000,
        page_action=collect, disable_resources=True, locale="en-US",
        additional_args={'timezone_id': 'UTC'}, google_search=False, retries=1)
    if action_errors:
        raise action_errors[0]
    if response.status != 200:
        raise ScrapeError("TIMELINE_UNAVAILABLE")
    diagnostic_stage = 'timeline_finalize'
    posts = list(found.values())
    tweets = finalize_posts(posts, since, allow_incomplete=True)
    ordinary = [parse_time(post['publishedAt']) for post in posts if not post['pinned']]
    oldest = min(ordinary)
    return {"sourceUrl": target, "tweets": tweets,
            "coverageComplete": not since or oldest <= parse_time(since),
            "oldestOrdinaryPublishedAt": oldest.isoformat().replace('+00:00', 'Z')}


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        request = json.loads(sys.stdin.read(4096))
        result = scrape(request.get("latestTweetTime"))
        print(json.dumps(result, ensure_ascii=True))
    except Exception as error:
        code = str(error) if isinstance(error, ScrapeError) else "TIMELINE_UNAVAILABLE"
        error_type = type(error).__name__ if type(error).__name__ in {'ScrapeError', 'TimeoutError', 'Error', 'OSError', 'ValueError'} else 'UNEXPECTED'
        print(json.dumps({"error": code, "type": error_type,
                          "stage": diagnostic_stage, "progress": diagnostic_progress}))
        sys.exit(1)
