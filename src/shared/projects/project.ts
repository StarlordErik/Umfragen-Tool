import { z } from 'zod';

export const projectIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
export const projectSchema = z.object({
  id: projectIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  href: z.string().regex(/^\/projects\/[a-z0-9-]+$/),
});
export type Project = z.infer<typeof projectSchema>;
