import { Dashboard } from '@/components/Dashboard';
import { emptyDashboard, getDashboardData } from '@/lib/monitor/dashboard';

export const dynamic = 'force-dynamic';
export default async function Home() {
  let data;
  try {
    data = await getDashboardData();
  } catch {
    data = emptyDashboard('degraded');
  }
  return <Dashboard initialData={data} />;
}
