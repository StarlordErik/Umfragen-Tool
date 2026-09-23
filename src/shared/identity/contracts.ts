import { z } from 'zod';
import { projectIdSchema } from '../projects/project';

/** Internal stable identifier; never an email address or an authentication token. */
export const globalUserIdSchema = z
  .string()
  .min(1)
  .max(200)
  .brand<'GlobalUserId'>();
export type GlobalUserId = z.infer<typeof globalUserIdSchema>;
export const participantIdentitySchema = z.object({
  projectId: projectIdSchema,
  participantId: z.string().min(1),
  globalUserId: globalUserIdSchema.optional(),
});
export type ParticipantIdentity = z.infer<typeof participantIdentitySchema>;

// No authentication provider, global profile fields or survey answer schema is
// chosen here. A project can remain anonymous or legacy-only indefinitely.
