import {z} from 'zod';
export const TEMPLATE_VERSION='synthetic-foundation-v1';
export const snapshotSchema=z.object({synthetic:z.literal(true),reference:z.string().regex(/^SYNTHETIC-[A-Za-z0-9_-]{1,60}$/),label:z.string().max(200)}).strict();
export type FoundationSnapshot=z.infer<typeof snapshotSchema>;
