'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { UtcClock } from './UtcClock';
import { categoryLabels } from '@/lib/monitor/locale';
import { ResetDisplay } from './ResetDisplay';
import { CHECK_INTERVAL_MINUTES, hasNewTweetVersion } from '@/lib/monitor/display';
import type { DashboardData, MonitorHealth } from '@/types/dashboard';
import type { StoredTweet } from '@/types/tweet';

const healthLabels: Record<MonitorHealth, string> = {
  unconfigured: '等待连接',
  waiting: '等待首次检查',
  healthy: '监控运行中',
  degraded: '检查中断',
  stale: '检查已延迟',
};
const realtimeUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const realtimeKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const realtimeConfigured = Boolean(realtimeUrl && realtimeKey);
function timestamp(value: string | null) {
  return value
    ? new Date(value).toISOString().replace('T', ' ').slice(0, 19)
    : '尚未检查';
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
  const [showTranslation, setShowTranslation] = useState(false);
  const translationId = useId();
  return (
    <article className={`tweet-card ${tweet.important ? 'is-important' : ''}`}>
      <div className="tweet-meta">
        <time dateTime={tweet.published_at}>
          {timestamp(tweet.published_at)} UTC
        </time>
        <span className={`tag ${tweet.related_to_codex ? 'tag-green' : ''}`}>
          {categoryLabels[tweet.category]}
        </span>
        {tweet.important && <span className="important-label">重要更新</span>}
      </div>
      <p className="tweet-text" lang="en">{tweet.tweet_text}</p>
      <button className="translate-button" aria-expanded={showTranslation} aria-controls={translationId} onClick={() => setShowTranslation(value => !value)}>
        {showTranslation ? '收起译文' : '翻译成中文'}
      </button>
      <div id={translationId} hidden={!showTranslation} className="tweet-translation" lang="zh-CN">
        {tweet.tweet_translation ? <><span className="eyebrow">AI 译文 · 以英文原文为准</span><p>{tweet.tweet_translation}</p></> : <p>这条推文暂未保存译文，英文原文仍可查看。</p>}
      </div>
      <div className="tweet-summary">
        <span className="eyebrow">AI 摘要</span>
        <p>{tweet.summary}</p>
      </div>
      <SourceLink url={tweet.tweet_url}>查看原文</SourceLink>
    </article>
  );
}

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<'all' | 'related' | 'important'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const request = useRef<AbortController | null>(null);
  const manualRequest = useRef<AbortController | null>(null);
  const latestWatermark = useRef(initialData.state.latest_tweet_time);
  const refresh = useCallback(async (replace = false) => {
    if (request.current && !replace) return;
    request.current?.abort();
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
      const nextData = (await response.json()) as DashboardData;
      if (request.current !== controller) return;
      latestWatermark.current = nextData.state.latest_tweet_time;
      setData(nextData);
      setRefreshError(false);
    } catch {
      if (request.current === controller) setRefreshError(true);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  const checkAndRefresh = useCallback(async () => {
    if (manualRequest.current) return;
    const controller = new AbortController();
    manualRequest.current = controller;
    setChecking(true);
    setCheckNotice('正在检查 X，发现新推文后会分析并更新页面，请稍候。');
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
      const response = await fetch('/api/monitor/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      const result = await response.json();
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After')) || 300;
        setCheckNotice(`刚刚已检查过，请约 ${Math.ceil(seconds / 60)} 分钟后重试。本次不重复抓取。`);
      } else if (response.status === 409) {
        setCheckNotice('已有检查正在进行，本次未重复启动。请稍后查看结果。');
      } else if (response.ok && result.status === 'deferred') {
        setCheckNotice(`已处理 ${result.processed} 条新推文，剩余内容将在后续检查继续处理。`);
      } else if (response.ok && result.status === 'complete') {
        setCheckNotice(result.processed > 0
          ? `检查完成，已处理 ${result.processed} 条新推文。`
          : '检查完成，没有发现新推文。');
      } else {
        setCheckNotice('本次检查未完成，已有记录仍可查看，请稍后重试。');
      }
      // Even a no-new-post check updates the time/status displayed to its caller.
      await refresh(true);
    } catch {
      setCheckNotice('未能确认检查结果，后台可能仍在运行，请稍后重新打开页面查看。');
    } finally {
      clearTimeout(timeout);
      manualRequest.current = null;
      setChecking(false);
    }
  }, [refresh]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    if (!realtimeUrl || !realtimeKey) {
      return () => {
        request.current?.abort();
        manualRequest.current?.abort();
        document.removeEventListener('visibilitychange', onVisible);
      };
    }

    const db = createClient(realtimeUrl, realtimeKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    let active = true;
    const onUpdate = (value: unknown) => {
      if (!hasNewTweetVersion(value, latestWatermark.current)) return;
      if (document.visibilityState === 'visible') void refresh();
    };
    const channel = db.channel('dashboard-update-signal')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'dashboard_updates', filter: 'id=eq.1',
      }, (payload) => onUpdate(payload.new.latest_tweet_time))
      .subscribe((status) => {
        if (!active) return;
        setRealtimeConnected(status === 'SUBSCRIBED');
        if (status !== 'SUBSCRIBED') return;
        // Reconcile the short gap between the server render and subscription.
        void db.from('dashboard_updates').select('latest_tweet_time').eq('id', 1).single()
          .then(({ data }) => {
            if (active) onUpdate(data?.latest_tweet_time);
          });
      });
    return () => {
      active = false;
      void db.removeChannel(channel);
      request.current?.abort();
      manualRequest.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const signal = data.latestSignal;
  const status = signal
    ? signal.category === 'reset'
      ? '检测到 Reset 信息'
      : '检测到 Codex 更新'
    : '暂无相关更新';
  const health = refreshError ? 'degraded' : data.state.health;
  const shown = data.tweets.filter(
    (tweet) =>
      filter === 'all' ||
      (filter === 'related' ? tweet.related_to_codex : tweet.important),
  );

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Codex Reset 监控首页">
          <span className="brand-icon">
            <Icon name="pulse" />
          </span>
          <span>
            CODEX<span className="brand-secondary"> / Reset 监控</span>
          </span>
        </Link>
        <div className="topbar-right">
          <span className="desktop-only">追踪原始消息，不猜测 Reset。</span>
          <UtcClock />
        </div>
      </header>
      <main id="main-content">
        <section className="intro">
          <div>
            <div className="eyebrow accent">
              <span className="tiny-square" /> Tibo 消息观测站
            </div>
            <h1>
              关注每一次
              <br />
              <span>Codex Reset.</span>
            </h1>
            <p className="intro-copy">
              跟进 Codex 额度变化，始终保留原始出处。
              <br />
              只记录公开消息与相关更新，不预测 Reset。
            </p>
          </div>
          <div className="intro-index" aria-hidden="true">
            <span>监控</span>
            <b>01</b>
            <span>Codex / Usage / Reset</span>
          </div>
        </section>

        <div className="section-label">
          <span>
            <span
              className={`health-dot ${health === 'healthy' ? 'online' : ''}`}
            />
            {healthLabels[health]}
          </span>
          <span>所有时间均为 UTC</span>
        </div>
        <section className="signal-panel" aria-label="最新相关消息">
          <div className="signal-content">
            <div className="panel-kicker">
              <span className="eyebrow">最新相关消息</span>
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
                  发布于 {timestamp(signal.published_at)} UTC
                  {signal.important ? ' · 重要更新' : ''}
                </p>
              </>
            ) : (
              <>
                <h2 className="signal-title">
                  持续关注
                  <br />
                  下一条消息<span className="cursor">_</span>
                </h2>
                <p className="signal-description">
                  {health === 'unconfigured'
                    ? '监控正在等待首次连接，确认后的消息会显示在这里。'
                    : '尚未记录 Codex 相关推文，检查成功后会显示新消息。'}
                </p>
              </>
            )}
            <div className="signal-details">
              <div>
                <span className="eyebrow">分类</span>
                <strong>
                  {signal
                    ? categoryLabels[signal.category]
                    : '暂无消息'}
                </strong>
              </div>
              <div>
                <span className="eyebrow">Reset 时间</span>
                <strong>
                  {signal?.reset_time
                    ? `${timestamp(signal.reset_time)} UTC`
                    : '原文未明确说明'}
                </strong>
              </div>
            </div>
            {signal && (
              <SourceLink url={signal.tweet_url}>查看消息原文</SourceLink>
            )}
          </div>
          <ResetDisplay signal={data.latestResetSignal ?? null} stale={health !== 'healthy'} />
        </section>

        <section className="metrics" aria-label="监控统计">
          <div className="metric">
            <span className="eyebrow">最近检查</span>
            <strong className="time-value">
              {timestamp(data.state.last_check_at)}
            </strong>
            <small>
              {data.state.last_check_at
                ? 'UTC · 本页最近同步的检查'
                : '等待首次运行'}
            </small>
          </div>
          <div className="metric">
            <span className="eyebrow">检查间隔</span>
            <strong>
              {CHECK_INTERVAL_MINUTES}<span className="unit">分钟</span>
            </strong>
            <small>定时检查周期</small>
          </div>
          <div className="metric">
            <span className="eyebrow">已处理推文</span>
            <strong>{String(data.totalProcessed).padStart(2, '0')}</strong>
            <small>已完成分析并保存</small>
          </div>
          <div className="metric">
            <span className="eyebrow">相关消息</span>
            <strong className="accent">
              {String(data.relatedCount).padStart(2, '0')}
            </strong>
            <small>Codex 相关推文</small>
          </div>
        </section>

        <section className="posts-section" aria-labelledby="recent-heading">
          <div className="posts-heading">
            <div>
              <div className="eyebrow">原始消息流</div>
              <h2 id="recent-heading">
                最近推文<span className="heading-period">.</span>
              </h2>
            </div>
            <button
              className="refresh-button"
              onClick={() => void checkAndRefresh()}
              disabled={checking || refreshing}
              title="检查 X 的最新推文并更新页面；全站共享 5 分钟冷却时间"
            >
              <Icon name="refresh" className={checking || refreshing ? 'spinning' : ''} />
              {checking ? '正在检查 X' : refreshing ? '正在更新页面' : '检查并刷新'}
            </button>
          </div>
          <div className="posts-toolbar">
            <div
              className="filters"
              role="group"
              aria-label="筛选最近推文"
            >
              {(['all', 'related', 'important'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? 'selected' : ''}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all'
                    ? '全部推文'
                    : value === 'related'
                      ? 'Codex 相关'
                      : '重要更新'}
                  {value === 'all' && <span>{data.tweets.length}</span>}
                </button>
              ))}
            </div>
            <span className="feed-note">最近 30 条 / 按发布时间倒序</span>
          </div>
          {checkNotice && <p className="notice" role="status">{checkNotice}</p>}
          {refreshError && (
            <p className="notice" role="status">
              暂时无法获取最新数据，当前显示上次加载的内容，请稍后重新打开页面。
            </p>
          )}
          {(health === 'degraded' || health === 'stale') && !refreshError && (
            <p className="notice" role="status">
              {health === 'stale'
                ? '定时检查已延迟。'
                : '上次检查未能完成。'}{' '}
              已有消息仍可查看。最近一次成功检查：{' '}
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
                    ? '当前筛选下没有推文'
                    : '首次检查后，这里将显示推文。'}
                </h3>
                <p>
                  {data.tweets.length
                    ? '试试其他筛选条件，查看最近的推文。'
                    : '推文处理完成后，将在这里显示英文原文、中文摘要和出处。'}
                </p>
                <span className="eyebrow">
                  {data.tweets.length
                    ? '切换筛选条件继续查看'
                    : '暂无已处理推文'}
                </span>
              </div>
            )}
          </div>
        </section>
        <section className="source-strip">
          <div className="source-profile">
            <span className="avatar">T</span>
            <div>
              <span className="eyebrow">监控来源</span>
              <strong>
                Tibo <span>/ X</span>
              </strong>
            </div>
          </div>
          <p>
            单一来源，保留原始语境。
            <br />
            <span>每条消息都可追溯至原始推文。</span>
          </p>
          {data.sourceUrl ? (
            <SourceLink url={data.sourceUrl}>查看 X 主页</SourceLink>
          ) : (
            <span className="source-pending">等待连接来源账号</span>
          )}
        </section>
      </main>
      <footer>
        <span>
          <Icon name="cross" /> Codex Reset 监控
        </span>
        <span>{realtimeConnected
          ? '新推文入库后自动更新'
          : realtimeConfigured
            ? '自动更新连接中 · 可手动刷新'
            : '打开或切回页面时读取最新数据'}</span>
        <span className="footer-note">记录消息，不做预测。</span>
      </footer>
    </div>
  );
}
