import { z } from 'zod';
import { validateUrlSyntax } from '../../monitoring/ssrf';
import { SUPPORTED_INTERVALS } from '../../monitoring/scheduling';
import { authInputSchema } from '../../monitoring/auth/auth.types';

const urlField = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .max(2048, 'URL is too long')
  .superRefine((val, ctx) => {
    const r = validateUrlSyntax(val);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason });
  });

const statusCode = z.coerce.number().int().min(100).max(599);

const baseFields = {
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  url: urlField,
  method: z.enum(['GET', 'HEAD']),
  intervalSeconds: z.coerce
    .number()
    .refine((v) => (SUPPORTED_INTERVALS as readonly number[]).includes(v), {
      message: 'Interval must be 5, 10 or 30 seconds, or 1, 5 or 10 minutes',
    }),
  timeoutMs: z.coerce.number().int().min(1000, 'Timeout must be at least 1000 ms').max(30000, 'Timeout must be at most 30000 ms'),
  expectedStatusMin: statusCode,
  expectedStatusMax: statusCode,
  /** Omit to keep current credentials; { type: 'NONE' } removes them. */
  auth: authInputSchema,
};

export const createMonitorSchema = z
  .object({
    ...baseFields,
    method: baseFields.method.default('GET'),
    // Default is derived from the interval in the route (min(10 s, interval)).
    timeoutMs: baseFields.timeoutMs.optional(),
    expectedStatusMin: statusCode.default(200),
    expectedStatusMax: statusCode.default(399),
    auth: authInputSchema.optional(),
  })
  .strict()
  .refine((v) => v.expectedStatusMin <= v.expectedStatusMax, {
    message: 'Minimum expected status must not exceed maximum',
    path: ['expectedStatusMax'],
  });

export const updateMonitorSchema = z
  .object(baseFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
