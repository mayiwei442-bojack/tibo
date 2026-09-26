import 'server-only';
import { MonitorError } from './errors';

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new MonitorError('CONFIGURATION_REQUIRED');
  return value;
}

export function sourceUrl(): string | null {
  const value = process.env.TIBO_X_URL?.trim() || 'https://x.com/thsottiaux';
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !['x.com', 'www.x.com', 'twitter.com'].includes(url.hostname) ||
      url.username ||
      url.password
    )
      return null;
    if (!/^\/[a-zA-Z0-9_]{1,15}\/?$/.test(url.pathname)) return null;
    return `https://x.com/${url.pathname.split('/')[1].toLowerCase()}`;
  } catch {
    return null;
  }
}
