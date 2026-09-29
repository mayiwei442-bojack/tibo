export const categories = [
  'reset',
  'usage_limit',
  'quota_change',
  'service_change',
  'other',
  'irrelevant',
] as const;
export type Category = (typeof categories)[number];
export const resetStatuses = ['completed', 'upcoming', 'possible', 'none', 'unknown'] as const;
export type ResetStatus = (typeof resetStatuses)[number];

export interface Analysis {
  related_to_codex: boolean;
  category: Category;
  summary: string;
  reset_time: string | null;
  important: boolean;
  reset_status?: ResetStatus;
  tweet_translation?: string | null;
}
