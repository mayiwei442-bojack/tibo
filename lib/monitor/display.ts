export const CHECK_INTERVAL_MINUTES = 90;

/** Compare instants, not JSON timestamp formatting or timezone spelling. */
export function hasNewTweetVersion(incoming: unknown, current: string | null) {
  if (typeof incoming !== 'string') return false;
  const incomingTime = Date.parse(incoming);
  if (!Number.isFinite(incomingTime)) return false;
  return current === null || incomingTime > Date.parse(current);
}

/** Elapsed targets are not evidence that the promised reset happened. */
export function countdownParts(target: string | null, now: number | null) {
  if (!target || now === null || !Number.isFinite(Date.parse(target))) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1000));
  return {
    expired: seconds === 0,
    values: [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24,
      Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')),
  };
}
