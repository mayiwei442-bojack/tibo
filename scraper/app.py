import hmac
import json
import logging
import os
import re
import subprocess
import sys
import threading
import signal
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
browser_lock = threading.Lock()
logger = logging.getLogger('tibo.scraper')


class ScrapeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latestTweetTime: str | None = Field(default=None, max_length=50)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tweets")
def tweets(body: ScrapeRequest, authorization: str | None = Header(default=None)):
    secret = os.environ.get("SCRAPER_SECRET", "")
    if len(secret) < 32 or not hmac.compare_digest((authorization or "").encode(), f"Bearer {secret}".encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not browser_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Scraper busy")
    started = time.monotonic()
    try:
        # Kill the entire owned process group on timeout, including Chromium.
        process = subprocess.Popen([sys.executable, "-m", "scraper.worker"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            start_new_session=os.name != "nt", cwd=str(Path(__file__).resolve().parent.parent))
        try:
            stdout, _ = process.communicate(input=body.model_dump_json(), timeout=75)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise
        finally:
            if os.name != "nt":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if process.returncode != 0 or len(stdout) > 2_000_000:
            diagnostic = {}
            try:
                diagnostic = json.loads(stdout) if len(stdout) <= 4096 else {}
            except (json.JSONDecodeError, TypeError):
                pass
            def safe(value):
                return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z_]{1,50}', value) else 'UNAVAILABLE'
            def safe_number(value):
                return value if type(value) is int and 0 <= value <= 1_000_000 else -1
            progress = diagnostic.get('progress') if isinstance(diagnostic.get('progress'), dict) else {}
            logger.warning('Scrape failed stage=%s code=%s type=%s elapsed_s=%.1f exit_code=%s posts=%s scrolls=%s scroll_y=%s scroll_height=%s articles=%s fallback_failed=%s',
                safe(diagnostic.get('stage')), safe(diagnostic.get('error')),
                safe(diagnostic.get('type')), time.monotonic() - started, process.returncode,
                safe_number(progress.get('posts')), safe_number(progress.get('scrolls')),
                safe_number(progress.get('scroll_y')), safe_number(progress.get('scroll_height')),
                safe_number(progress.get('articles')), safe_number(progress.get('fallback_failed')))
            raise HTTPException(status_code=503, detail="Timeline unavailable")
        data = json.loads(stdout)
        if not data.get("tweets"):
            logger.warning('Scrape returned empty result elapsed_s=%.1f', time.monotonic() - started)
            raise HTTPException(status_code=503, detail="Timeline unavailable")
        return data
    except (subprocess.TimeoutExpired, ValueError, OSError) as error:
        logger.warning('Scrape process failed type=%s elapsed_s=%.1f', type(error).__name__, time.monotonic() - started)
        raise HTTPException(status_code=503, detail="Timeline unavailable") from None
    finally:
        browser_lock.release()
