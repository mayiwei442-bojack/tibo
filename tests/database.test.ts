import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite();
const token = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const tweet = {
  tweet_url: 'https://x.com/test/status/123',
  tweet_text: 'Test reset announcement',
  published_at: '2026-09-20T10:00:00Z',
  related_to_codex: true,
  category: 'reset',
  summary: 'A test reset announcement.',
  reset_time: null,
  important: true,
};
const acquire = (value = token) =>
  db.query<{ result: { acquired: boolean } }>(
    'select public.monitor_acquire($1) as result',
    [value],
  );
const save = () =>
  db.query('select public.monitor_save_tweet($1, $2::jsonb)', [
    token,
    JSON.stringify(tweet),
  ]);

beforeAll(async () => {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;',
  );
  await db.exec(
    readFileSync('supabase/migrations/20260920142258_monitor_v1.sql', 'utf8'),
  );
  await db.exec(readFileSync('supabase/migrations/20260927092842_reset_status.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20260927094104_chinese_content.sql', 'utf8'));
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    'reset role; truncate public.tweets; update public.monitor_state set latest_tweet_time=null,last_check_at=null,last_success_at=null,last_error=null,lease_token=null,lease_until=null;',
  );
});

describe('actual Postgres migration and RPCs', () => {
  it('backfills only exact historical records and can run twice without changing originals', async () => {
    const original = 'Resets all propagated. That will be all. Have a fantastic weekend.';
    const oldSummary = 'Tibo states that all resets have been propagated and wishes everyone a fantastic weekend.';
    await acquire();
    await db.query('select public.monitor_save_tweet($1, $2::jsonb)', [token, JSON.stringify({ ...tweet, tweet_url: 'https://x.com/thsottiaux/status/2103911959544610829', tweet_text: original, summary: oldSummary })]);
    const sql = readFileSync('supabase/migrations/20260927094104_chinese_content.sql', 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const saved = (await db.query<{tweet_text: string; summary: string; tweet_translation: string}>('select tweet_text,summary,tweet_translation from tweets')).rows[0];
    expect(saved.tweet_text).toBe(original);
    expect(saved.summary).toBe('Tibo 表示所有 Reset 都已生效，并祝大家周末愉快。');
    expect(saved.tweet_translation).toContain('所有 Reset 都已生效');
    expect((await db.query<{latest_tweet_time: unknown}>('select latest_tweet_time from monitor_state')).rows[0].latest_tweet_time).toBeNull();
  });
  it('stores the Chinese translation separately and leaves the original untouched', async () => {
    await acquire();
    await db.query('select public.monitor_save_tweet($1, $2::jsonb)', [token, JSON.stringify({ ...tweet, summary: '宣布 Codex Reset。', tweet_translation: '这是一条 Reset 公告。', reset_status: 'upcoming' })]);
    const saved = (await db.query<{tweet_text: string; summary: string; tweet_translation: string}>('select tweet_text,summary,tweet_translation from tweets')).rows[0];
    expect(saved).toEqual({tweet_text: tweet.tweet_text, summary: '宣布 Codex Reset。', tweet_translation: '这是一条 Reset 公告。'});
  });
  it('stores reset lifecycle and preserves legacy writes as unknown', async () => {
    await acquire();
    await save();
    expect((await db.query<{reset_status: string}>('select reset_status from tweets')).rows[0].reset_status).toBe('unknown');
    await db.query('select public.monitor_save_tweet($1, $2::jsonb)', [token, JSON.stringify({ ...tweet, tweet_url: 'https://x.com/test/status/456', reset_status: 'completed' })]);
    expect((await db.query<{reset_status: string}>("select reset_status from tweets where tweet_url like '%456'")).rows[0].reset_status).toBe('completed');
    await expect(db.query('select public.monitor_save_tweet($1, $2::jsonb)', [token, JSON.stringify({ ...tweet, tweet_url: 'https://x.com/test/status/789', reset_status: 'invented' })])).rejects.toThrow();
  });
  it('grants only the service role access', async () => {
    await db.exec('set role anon');
    await expect(db.query('select * from public.tweets')).rejects.toThrow(
      /permission denied/,
    );
    await expect(acquire()).rejects.toThrow(/permission denied/);
    await db.exec('reset role; set role service_role');
    expect((await acquire()).rows[0].result.acquired).toBe(true);
  });
  it('rejects overlapping leases and expired-owner writes', async () => {
    expect((await acquire()).rows[0].result.acquired).toBe(true);
    expect((await acquire(other)).rows[0].result.acquired).toBe(false);
    await db.exec(
      "update public.monitor_state set lease_until=now()-interval '1 second'",
    );
    expect((await acquire(other)).rows[0].result.acquired).toBe(true);
    await expect(save()).rejects.toThrow(/MONITOR_LEASE_LOST/);
    await expect(
      db.query('select public.monitor_finish($1,null)', [token]),
    ).rejects.toThrow(/MONITOR_LEASE_LOST/);
  });
  it('will not advance a group until all URLs exist at that timestamp', async () => {
    await acquire();
    await save();
    await expect(
      db.query('select public.monitor_advance($1,$2,$3::text[])', [
        token,
        tweet.published_at,
        [tweet.tweet_url, 'https://x.com/test/status/999'],
      ]),
    ).rejects.toThrow(/INCOMPLETE_TIMESTAMP_GROUP/);
    const state = await db.query<{ latest_tweet_time: unknown }>(
      'select latest_tweet_time from public.monitor_state',
    );
    expect(state.rows[0].latest_tweet_time).toBeNull();
    await db.query('select public.monitor_advance($1,$2,$3::text[])', [
      token,
      tweet.published_at,
      [tweet.tweet_url],
    ]);
    await db.query('select public.monitor_finish($1,null)', [token]);
    const success = await db.query<Record<string, unknown>>(
      'select latest_tweet_time,last_success_at,lease_token from public.monitor_state',
    );
    expect(success.rows[0].latest_tweet_time).not.toBeNull();
    expect(success.rows[0].last_success_at).not.toBeNull();
    expect(success.rows[0].lease_token).toBeNull();
  });
  it('does not duplicate a saved URL', async () => {
    await acquire();
    await save();
    await save();
    expect(
      (
        await db.query<{ count: number }>(
          'select count(*)::int as count from public.tweets',
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it('does not claim success after a failed check', async () => {
    await acquire();
    await db.query("select public.monitor_finish($1,'SCRAPER_UNAVAILABLE')", [
      token,
    ]);
    const state = (
      await db.query<Record<string, unknown>>(
        'select * from public.monitor_state',
      )
    ).rows[0];
    expect(state.last_check_at).not.toBeNull();
    expect(state.last_success_at).toBeNull();
    expect(state.latest_tweet_time).toBeNull();
    expect(state.last_error).toBe('SCRAPER_UNAVAILABLE');
  });
});
