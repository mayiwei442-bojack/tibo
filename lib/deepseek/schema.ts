import { z } from 'zod';
import { categories } from '@/types/analysis';

export const analysisSchema = z
  .object({
    related_to_codex: z.boolean(),
    category: z.enum(categories),
    summary: z.string().trim().min(1).max(1000),
    reset_time: z.iso.datetime({ offset: true }).nullable(),
    important: z.boolean(),
  })
  .strict()
  .superRefine((data, ctx) => {
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
