"""Only this package knows about X's DOM. Parsing never requests a URL."""
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
import re

from scrapling import Selector


class ScrapeError(Exception):
    pass


def target_profile(value: str) -> tuple[str, str]:
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.netloc not in {"x.com", "www.x.com", "twitter.com"}:
        raise ScrapeError("INVALID_SOURCE")
    if not re.fullmatch(r"/[A-Za-z0-9_]{1,15}/?", parsed.path):
        raise ScrapeError("INVALID_SOURCE")
    author = parsed.path.strip("/").lower()
    return f"https://x.com/{author}", author


def parse_time(value: str) -> datetime:
    if not isinstance(value, str):
        raise ScrapeError("INVALID_TIMESTAMP")
    try:
        time = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if time.tzinfo is None:
            raise ValueError("Missing timezone")
        return time.astimezone(timezone.utc)
    except (ValueError, TypeError):
        raise ScrapeError("INVALID_TIMESTAMP") from None


def parse_posts(html: str, author: str) -> list[dict]:
    page = Selector(html)
    posts = []
    for article in page.css('article'):
        # Quoted posts are nested articles in the current public X markup.
        # They are not independent entries in the monitored user's timeline.
        if article.xpath('ancestor::article').getall():
            continue
        # Reposts can expose somebody else's content and historical pinned posts
        # must not be used as evidence that a chronological watermark was reached.
        context = article.css('[data-testid="socialContext"]').getall()
        is_pinned = any("Pinned" in value for value in context)
        time_nodes = article.css('time[datetime]')
        if not time_nodes:
            # Current public X markup uses normal articles and a relative-time
            # permalink, without test IDs. Resolve its date on the public detail page.
            links = [urlparse(href).path for href in article.css('a::attr(href)').getall()]
            permalink = next((path for path in links if re.fullmatch(r'/[A-Za-z0-9_]+/status/\d+', path)), None)
            if not permalink or permalink.split('/')[1].lower() != author:
                continue
            own = [node for node in article.css('[dir="auto"]') if not node.xpath('ancestor::*[@role="link" and ancestor::article]')]
            if not own:
                raise ScrapeError("INCOMPLETE_POST")
            text = "".join(own[0].xpath('.//text() | .//img/@alt').getall()).strip()
            if not text:
                raise ScrapeError("INCOMPLETE_POST")
            posts.append({"text": text, "publishedAt": None, "url": f"https://x.com/{author}/status/{permalink.split('/')[-1]}", "pinned": is_pinned})
            continue
        # The first time/permalink belongs to the outer post, not a quoted post.
        time_node = time_nodes[0]
        links = time_node.xpath("ancestor::a[1]/@href").getall()
        if not links:
            raise ScrapeError("INCOMPLETE_POST")
        path = urlparse(links[0]).path
        match = re.fullmatch(r"/([A-Za-z0-9_]+)/status/(\d+)", path)
        if not match or match[1].lower() != author:
            continue
        text_nodes = article.css('[data-testid="tweetText"]')
        # A quoted post can have its own tweetText; exclude quote containers.
        own_nodes = [node for node in text_nodes if not node.xpath('ancestor::*[@data-testid="quoteTweet" and ancestor::article]') and not node.xpath('ancestor::*[@role="link" and ancestor::article and not(@data-testid="tweet")]')]
        if not own_nodes:
            raise ScrapeError("INCOMPLETE_POST")
        text = "".join(own_nodes[0].xpath(".//text() | .//img/@alt").getall()).strip()
        if not text or len(text) > 30000:
            raise ScrapeError("INCOMPLETE_POST")
        if article.css('[data-testid="tweet-text-show-more-link"]'):
            raise ScrapeError("TRUNCATED_POST")
        time = parse_time(time_node.attrib["datetime"])
        if time > datetime.now(timezone.utc) + timedelta(minutes=1):
            raise ScrapeError("INVALID_TIMESTAMP")
        posts.append({"text": text, "publishedAt": time.isoformat().replace("+00:00", "Z"),
                      "url": f"https://x.com/{author}/status/{match[2]}", "pinned": is_pinned})
    return posts


DETAIL_TIME_PATTERN = r'^\d{1,2}:\d{2} [AP]M · [A-Za-z]{3} \d{1,2}, \d{4}$'


def parse_detail(html: str, url: str) -> dict:
    """The caller MUST render with locale en-US and browser timezone UTC.

    The current public detail view exposes minute precision, not seconds.
    We preserve that precision; IDs are never decoded into timestamps.
    """
    parsed_url = urlparse(url)
    author = parsed_url.path.split('/')[1].lower()
    page = Selector(html)
    if not re.fullmatch(r'/[A-Za-z0-9_]{1,15}/status/\d+', parsed_url.path):
        raise ScrapeError('INVALID_SOURCE')
    for anchor in page.css('a'):
        if urlparse(anchor.attrib.get('href', '')).path != parsed_url.path:
            continue
        text = anchor.get_all_text(separator='', strip=False).strip()
        if not re.fullmatch(DETAIL_TIME_PATTERN, text):
            continue
        # The original detail post is a div, while replies are articles. Start
        # from its exact timestamp permalink, never from an unrelated reply.
        containers = anchor.xpath(f'ancestor::*[.//*[@dir="auto"] and .//a[@href="/{author}"]][1]')
        if not containers:
            raise ScrapeError('INCOMPLETE_POST')
        container = containers[0]
        body = container.css('[dir="auto"]')[0]
        post_text = ''.join(body.xpath('.//text() | .//img/@alt').getall()).strip()
        if not post_text:
            raise ScrapeError('INCOMPLETE_POST')
        try:
            published = datetime.strptime(text, '%I:%M %p · %b %d, %Y').replace(tzinfo=timezone.utc)
        except ValueError:
            raise ScrapeError('INVALID_TIMESTAMP') from None
        now = datetime.now(timezone.utc)
        # Wait for this minute to close, otherwise a later sibling in the same
        # minute could be mistaken for an already processed post on the next run.
        if published >= now.replace(second=0, microsecond=0):
            raise ScrapeError('TIMESTAMP_MINUTE_IN_PROGRESS')
        if len(post_text) > 30000 or container.css('[data-testid="tweet-text-show-more-link"]'):
            raise ScrapeError('TRUNCATED_POST')
        return {'text': post_text, 'publishedAt': published.isoformat().replace('+00:00', 'Z'),
                'url': url, 'pinned': False}
    raise ScrapeError('INCOMPLETE_POST')


def finalize_posts(posts: list[dict], since: str | None) -> list[dict]:
    unique = {}
    for post in posts:
        previous = unique.get(post["url"])
        if previous and any(previous[key] != post[key] for key in ("text", "publishedAt")):
            raise ScrapeError("CONFLICTING_POST")
        unique[post["url"]] = post
    if not unique:
        raise ScrapeError("TIMELINE_UNAVAILABLE")
    chronological = [parse_time(p["publishedAt"]) for p in unique.values() if not p["pinned"]]
    # Anonymous X sometimes serves popularity-sorted historical posts. Fail closed.
    if not chronological or chronological != sorted(chronological, reverse=True):
        raise ScrapeError("TIMELINE_NOT_CHRONOLOGICAL")
    if since and min(chronological) > parse_time(since):
        raise ScrapeError("TIMELINE_COVERAGE_INCOMPLETE")
    # Bootstrap only from a currently visible recent timeline, never a stale profile.
    if not since and (datetime.now(timezone.utc) - max(chronological)).days > 7:
        raise ScrapeError("TIMELINE_NOT_RECENT")
    return [{key: post[key] for key in ("text", "publishedAt", "url")} for post in unique.values()]
