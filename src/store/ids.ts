import { randomInt } from "node:crypto";

// Crockford-ish base32 without ambiguous characters (no i, l, o, u).
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Short random id with a prefix, e.g. `n_7f3a`. Collision-checked by the caller. */
export function shortId(prefix: string, length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}_${out}`;
}

/** Document ids become filenames, so they are restricted to a safe slug. */
export const DOC_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidDocId(id: string): boolean {
  return DOC_ID_PATTERN.test(id);
}

/** Turn a human name into a valid document id ("Account Overview" -> "account-overview"). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "untitled";
}
