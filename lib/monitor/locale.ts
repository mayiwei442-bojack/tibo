import type { Category } from '@/types/analysis';

export const categoryLabels: Record<Category, string> = {
  reset: 'Reset',
  usage_limit: 'Usage limit',
  quota_change: 'Quota 调整',
  service_change: '服务变化',
  other: '其他讨论',
  irrelevant: '无关推文',
};
