'use client';

import { useEffect, useState } from 'react';
import { countdownParts } from '@/lib/monitor/display';
import type { StoredTweet } from '@/types/tweet';

const modes = {
  completed: { code: '01 / 已完成', title: 'Reset 已完成', subtitle: '已重置', detail: '已记录重置完成消息，暂无下一次重置公告。' },
  upcoming: { code: '02 / 已公布', title: 'Reset 即将到来', subtitle: '明确将重置', detail: '已明确宣布将重置，具体时间尚未说明。' },
  possible: { code: '03 / 未确认', title: '疑似 Reset', subtitle: '疑似将重置', detail: '推文措辞含蓄，尚不能确认会重置。请以原文及后续公告为准。' },
  unknown: { code: '— / 等待消息', title: '等待 Reset 消息', subtitle: '重置状态待确认', detail: '暂无已分类的重置消息。不将缺少信息视为已重置。' },
};

export function ResetDisplay({ signal, stale }: { signal: StoredTweet | null; stale: boolean }) {
  const mode = signal?.related_to_codex && signal.category === 'reset' &&
    (signal.reset_status === 'completed' || signal.reset_status === 'upcoming' || signal.reset_status === 'possible')
    ? signal.reset_status : 'unknown';
  const copy = modes[mode];
  const target = mode === 'upcoming' ? signal?.reset_time ?? null : null;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);
  const countdown = countdownParts(target, now);
  return (
    <aside className={`led-panel led-${mode}`} aria-label="Reset 状态显示屏" data-mode={mode}>
      <div className="led-hardware"><span>CR / 消息终端</span><span>● ● ●</span></div>
      <div className="led-screen">
        <div className="led-topline"><span className="led-indicator" />{copy.code}<span className="led-source">TIBO / X</span></div>
        <div className="led-symbol" aria-hidden="true">{mode === 'completed' ? '✓' : mode === 'upcoming' ? '↗' : mode === 'possible' ? '?' : '—'}</div>
        <h3 className="led-title">{copy.title}</h3>
        <p className="led-subtitle" lang="zh-CN">{copy.subtitle}</p>
        {target ? (
          <div className="led-countdown">
            <div className="led-digits" role="timer" aria-label="距离公告 Reset 时间">
              {(countdown?.values ?? ['--', '--', '--', '--']).map((value, index) => (
                <div key={index}><strong>{value}</strong><small>{['天', '时', '分', '秒'][index]}</small></div>
              ))}
            </div>
            <p lang="zh-CN">{countdown?.expired ? '公告时间已到，等待重置完成确认。' : '距公告中的重置时间'}</p>
            <time dateTime={target}>{new Date(target).toISOString().replace('T', ' ').slice(0, 19)} UTC</time>
          </div>
        ) : <p className="led-detail" lang="zh-CN">{copy.detail}</p>}
        <div className="led-evidence">
          <span>{stale ? '上次记录 · 检查延迟' : '依据已记录的推文'}</span>
          {signal && <a href={signal.tweet_url} target="_blank" rel="noopener noreferrer">{new Date(signal.published_at).toISOString().slice(0, 16).replace('T', ' ')} UTC ↗</a>}
        </div>
      </div>
      <div className="led-legend" aria-label="状态颜色图例">
        <span className={mode === 'completed' ? 'active' : ''}>● 已重置</span>
        <span className={mode === 'upcoming' ? 'active' : ''}>● 将重置</span>
        <span className={mode === 'possible' ? 'active' : ''}>● 疑似</span>
      </div>
    </aside>
  );
}
