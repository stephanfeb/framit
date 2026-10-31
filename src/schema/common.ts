import { z } from "zod";

export const DocId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use a lowercase slug of letters, digits, "-" or "_", e.g. "account-overview".')
  .describe('Document id; also the filename. Lowercase slug, e.g. "account-overview".');
