import { z } from "zod";
import { FramitError } from "../errors.js";
import { applyOps, PatchError, pointerOf, type Op } from "../shared/patch-core.js";

/*
 * Server-side wrapper around the shared patch core: Zod validation of ops and conversion of
 * patch errors into FramitErrors with hints. See src/shared/patch-core.ts for semantics.
 */

export const PatchOp = z
  .object({
    op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
    node: z.string().optional().describe("Node or frame id that `path` is relative to."),
    path: z.string().default("").describe('JSON Pointer, e.g. "/props/label". Empty means the node itself.'),
    value: z.unknown().optional(),
    from: z.string().optional().describe("Source pointer for move/copy (relative to fromNode if given)."),
    fromNode: z.string().optional().describe("Node id that `from` is relative to; for move/copy of a whole node, omit `from`."),
  })
  .strict();
export type PatchOp = z.input<typeof PatchOp>;

export { pointerOf };

/** Apply ops to a deep copy of `doc`. All-or-nothing: on error the input is untouched. */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  const parsed = ops.map((o, i) => {
    const r = PatchOp.safeParse(o);
    if (!r.success) throw new FramitError("SCHEMA", `Patch op ${i} is invalid: ${r.error.issues[0]?.message}`);
    return r.data as Op;
  });
  try {
    return applyOps(doc, parsed);
  } catch (err) {
    if (err instanceof PatchError) {
      throw new FramitError(err.code === "NOT_FOUND" ? "NOT_FOUND" : "SCHEMA", err.message, {
        hint: err.code === "NOT_FOUND" ? "Call read_screen to get current node ids." : undefined,
      });
    }
    throw err;
  }
}
