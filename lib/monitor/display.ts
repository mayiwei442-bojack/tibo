export const CHECK_INTERVAL_HOURS = 2;
export const VIEW_REFRESH_MINUTES = 100;

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
