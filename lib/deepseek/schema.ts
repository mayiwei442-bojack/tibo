import { z } from 'zod';
import { categories, resetStatuses } from '@/types/analysis';

export const analysisSchema = z
  .object({
    related_to_codex: z.boolean(),
    category: z.enum(categories),
    summary: z.string().trim().min(1).max(1000),
    reset_time: z.iso.datetime({ offset: true }).nullable(),
    important: z.boolean(),
    reset_status: z.enum(resetStatuses),
    tweet_translation: z.string().trim().min(1).max(30000),
  })
  .strict()
  .superRefine((data, ctx) => {
    if ((data.category !== 'reset' && data.reset_status !== 'none') ||
        (data.category === 'reset' && data.reset_status === 'none') ||
        (data.reset_status === 'possible' && (data.important || data.reset_time !== null)))
      ctx.addIssue({ code: 'custom', message: 'Reset status contradicts analysis' });
    if (data.related_to_codex === (data.category === 'irrelevant'))
      ctx.addIssue({
        code: 'custom',
        message: 'Category contradicts relevance',
      });
    if (!data.related_to_codex && (data.important || data.reset_time !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'Irrelevant posts cannot contain a signal',
      });
  });
