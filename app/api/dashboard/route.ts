import { getDashboardData } from '@/lib/monitor/dashboard';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return Response.json(await getDashboardData(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: 'Monitor data is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
