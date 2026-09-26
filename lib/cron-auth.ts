import { timingSafeEqual } from 'node:crypto';

export function isCronAuthorized(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
