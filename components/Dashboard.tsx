'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { UtcClock } from './UtcClock';
import type { DashboardData, MonitorHealth } from '@/types/dashboard';
import type { StoredTweet } from '@/types/tweet';

const healthLabels: Record<MonitorHealth, string> = {
  unconfigured: 'AWAITING CONNECTION',
  waiting: 'AWAITING FIRST CHECK',
  healthy: 'MONITOR ONLINE',
  degraded: 'CHECK INTERRUPTED',
  stale: 'CHECK OVERDUE',
};
function timestamp(value: string | null) {
  return value
    ? new Date(value).toISOString().replace('T', ' ').slice(0, 19)
    : 'Not checked yet';
}
function Icon({
  name,
  className = '',
}: {
  name: 'arrow' | 'refresh' | 'pulse' | 'cross';
  className?: string;
}) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {name === 'arrow' ? (
        <path d="M6 18 18 6M6 6h12v12" />
      ) : name === 'refresh' ? (
        <>
          <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
        </>
      ) : name === 'cross' ? (
        <path d="M12 4v16M4 12h16" />
      ) : (
        <path d="M2 12h5l3-8 5 16 3-8h4" />
      )}
    </svg>
  );
}
function SourceLink({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className="source-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <Icon name="arrow" />
    </a>
  );
}
function TweetCard({ tweet }: { tweet: StoredTweet }) {
  return (
    <article className={`tweet-card ${tweet.important ? 'is-important' : ''}`}>
      <div className="tweet-meta">
        <time dateTime={tweet.published_at}>
          {timestamp(tweet.published_at)} UTC
        </time>
        <span className={`tag ${tweet.related_to_codex ? 'tag-green' : ''}`}>
          {tweet.category.replaceAll('_', ' ')}
        </span>
        {tweet.important && <span className="important-label">IMPORTANT</span>}
      </div>
      <p className="tweet-text">{tweet.tweet_text}</p>
      <div className="tweet-summary">
        <span className="eyebrow">AI SUMMARY</span>
        <p>{tweet.summary}</p>
      </div>
      <SourceLink url={tweet.tweet_url}>Original post</SourceLink>
    </article>
  );
}

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<'all' | 'related' | 'important'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/dashboard', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Unavailable');
      setData((await response.json()) as DashboardData);
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    } finally {
      clearTimeout(timeout);
      request.current = null;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const polling = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 45000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(polling);
      request.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const signal = data.latestSignal;
  const status = signal
    ? signal.category === 'reset'
      ? 'RESET INFORMATION DETECTED'
      : 'CODEX UPDATE DETECTED'
    : 'NORMAL';
  const health = refreshError ? 'degraded' : data.state.health;
  const shown = data.tweets.filter(
    (tweet) =>
      filter === 'all' ||
      (filter === 'related' ? tweet.related_to_codex : tweet.important),
  );

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Codex Reset Monitor home">
          <span className="brand-icon">
            <Icon name="pulse" />
          </span>
          <span>
            CODEX<span className="brand-secondary"> / RESET MONITOR</span>
          </span>
        </Link>
        <div className="topbar-right">
          <span className="desktop-only">SINGLE SOURCE. CLEAR SIGNAL.</span>
          <UtcClock />
        </div>
      </header>
      <main id="main-content">
        <section className="intro">
          <div>
            <div className="eyebrow accent">
              <span className="tiny-square" /> TIBO SIGNAL OBSERVATORY
            </div>
            <h1>
              STAY AHEAD
              <br />
              OF THE <span>RESET.</span>
            </h1>
            <p className="intro-copy">
              Codex limits change. Keep the source in sight.
              <br />
              Public posts. Relevant updates. Nothing guessed.
            </p>
          </div>
          <div className="intro-index" aria-hidden="true">
            <span>MONITOR</span>
            <b>01</b>
            <span>CODEX / USAGE / RESET</span>
          </div>
        </section>

        <div className="section-label">
          <span>
            <span
              className={`health-dot ${health === 'healthy' ? 'online' : ''}`}
            />
            {healthLabels[health]}
          </span>
          <span>ALL TIMES IN UTC</span>
        </div>
        <section className="signal-panel" aria-label="Latest relevant signal">
          <div className="signal-content">
            <div className="panel-kicker">
              <span className="eyebrow">LATEST RELEVANT SIGNAL</span>
              <span className={`status-pill ${signal ? 'detected' : ''}`}>
                {status}
              </span>
            </div>
            {signal ? (
              <>
                <h2 className="signal-title detected-title">
                  {signal.summary}
                </h2>
                <p className="signal-description">
                  Published {timestamp(signal.published_at)} UTC
                  {signal.important ? ' · Important update' : ''}
                </p>
              </>
            ) : (
              <>
                <h2 className="signal-title">
                  Standing by for
                  <br />
                  the next signal<span className="cursor">_</span>
                </h2>
                <p className="signal-description">
                  {health === 'unconfigured'
                    ? 'The monitor is awaiting its first connection. Verified updates will appear here.'
                    : 'No Codex-related post has been recorded yet. New signals will appear after a successful check.'}
                </p>
              </>
            )}
            <div className="signal-details">
              <div>
                <span className="eyebrow">CATEGORY</span>
                <strong>
                  {signal
                    ? signal.category.replaceAll('_', ' ').toUpperCase()
                    : 'NO SIGNAL YET'}
                </strong>
              </div>
              <div>
                <span className="eyebrow">RESET TIME</span>
                <strong>
                  {signal?.reset_time
                    ? `${timestamp(signal.reset_time)} UTC`
                    : 'Not explicitly stated'}
                </strong>
              </div>
            </div>
            {signal && (
              <SourceLink url={signal.tweet_url}>View original post</SourceLink>
            )}
          </div>
          <div className="radar-panel" aria-hidden="true">
            <span className="radar-corner tl">+</span>
            <span className="radar-corner tr">+</span>
            <div
              className={`radar ${health === 'healthy' ? 'radar-active' : ''}`}
            >
              <div className="radar-ring ring-one" />
              <div className="radar-ring ring-two" />
              <div className="radar-ring ring-three" />
              <div className="radar-axis horizontal" />
              <div className="radar-axis vertical" />
              <div className="radar-sweep" />
              <div className="radar-center">
                <Icon name="pulse" />
              </div>
              <span className="radar-marker">N</span>
            </div>
            <div className="radar-caption">
              <span>TIBO → CODEX</span>
              <small>
                {health === 'healthy'
                  ? 'MONITOR CONNECTED'
                  : 'AWAITING VERIFIED SIGNAL'}
              </small>
            </div>
            <span className="radar-corner bl">+</span>
            <span className="radar-corner br">+</span>
          </div>
        </section>

        <section className="metrics" aria-label="Monitor statistics">
          <div className="metric">
            <span className="eyebrow">LAST CHECKED</span>
            <strong className="time-value">
              {timestamp(data.state.last_check_at)}
            </strong>
            <small>
              {data.state.last_check_at
                ? 'UTC · Last attempted check'
                : 'Waiting for the first run'}
            </small>
          </div>
          <div className="metric">
            <span className="eyebrow">CHECK INTERVAL</span>
            <strong>
              05<span className="unit">MIN</span>
            </strong>
            <small>Scheduled interval</small>
          </div>
          <div className="metric">
            <span className="eyebrow">POSTS PROCESSED</span>
            <strong>{String(data.totalProcessed).padStart(2, '0')}</strong>
            <small>Successfully analysed & saved</small>
          </div>
          <div className="metric">
            <span className="eyebrow">RELEVANT SIGNALS</span>
            <strong className="accent">
              {String(data.relatedCount).padStart(2, '0')}
            </strong>
            <small>Codex-related posts</small>
          </div>
        </section>

        <section className="posts-section" aria-labelledby="recent-heading">
          <div className="posts-heading">
            <div>
              <div className="eyebrow">THE SOURCE FEED</div>
              <h2 id="recent-heading">
                RECENT POSTS<span className="heading-period">.</span>
              </h2>
            </div>
            <button
              className="refresh-button"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <Icon name="refresh" className={refreshing ? 'spinning' : ''} />
              {refreshing ? 'Refreshing' : 'Refresh view'}
            </button>
          </div>
          <div className="posts-toolbar">
            <div
              className="filters"
              role="group"
              aria-label="Filter recent posts"
            >
              {(['all', 'related', 'important'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? 'selected' : ''}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all'
                    ? 'All posts'
                    : value === 'related'
                      ? 'Codex related'
                      : 'Important'}
                  {value === 'all' && <span>{data.tweets.length}</span>}
                </button>
              ))}
            </div>
            <span className="feed-note">LATEST 30 / NEWEST FIRST</span>
          </div>
          {refreshError && (
            <p className="notice" role="status">
              The latest data could not be retrieved. Showing the last available
              view; refresh will retry automatically.
            </p>
          )}
          {(health === 'degraded' || health === 'stale') && !refreshError && (
            <p className="notice" role="status">
              {health === 'stale'
                ? 'The next successful check is overdue.'
                : 'The last check could not finish.'}{' '}
              Existing signals remain visible. Last successful check:{' '}
              {timestamp(data.state.last_success_at)}.
            </p>
          )}
          <div className="post-list">
            {shown.length ? (
              shown.map((tweet) => <TweetCard key={tweet.id} tweet={tweet} />)
            ) : (
              <div className="empty-feed">
                <div className="empty-glyph" aria-hidden="true">
                  <Icon name="pulse" />
                </div>
                <h3>
                  {data.tweets.length
                    ? 'No posts in this filter'
                    : 'The feed starts with the first check.'}
                </h3>
                <p>
                  {data.tweets.length
                    ? 'Try another filter to explore the recent posts.'
                    : 'Once a post is processed, its original text, summary and source will appear here.'}
                </p>
                <span className="eyebrow">
                  {data.tweets.length
                    ? 'ADJUST FILTER TO CONTINUE'
                    : 'NO PROCESSED POSTS YET'}
                </span>
              </div>
            )}
          </div>
        </section>
        <section className="source-strip">
          <div className="source-profile">
            <span className="avatar">T</span>
            <div>
              <span className="eyebrow">MONITORED SOURCE</span>
              <strong>
                Tibo <span>/ X</span>
              </strong>
            </div>
          </div>
          <p>
            One source. Original context.
            <br />
            <span>Every signal links back to the post.</span>
          </p>
          {data.sourceUrl ? (
            <SourceLink url={data.sourceUrl}>View profile</SourceLink>
          ) : (
            <span className="source-pending">PROFILE PENDING CONNECTION</span>
          )}
        </section>
      </main>
      <footer>
        <span>
          <Icon name="cross" /> CODEX RESET MONITOR
        </span>
        <span>VIEW AUTO-REFRESHES EVERY 45S</span>
        <span className="footer-note">Information, not prediction.</span>
      </footer>
    </div>
  );
}
