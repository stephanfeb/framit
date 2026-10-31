// Error model shared by the store, MCP tools, and (later) the preview server.
// See docs/05-mcp-interface.md "Error model".

export type ErrorCode =
  | "SCHEMA"
  | "REVISION"
  | "NOT_FOUND"
  | "THEME_MISSING"
  | "RENDER"
  | "BROWSER"
  | "NOT_INITIALIZED"
  | "INVALID_ID"
  | "IO";

export class FramitError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly data: unknown;

  constructor(code: ErrorCode, message: string, opts: { hint?: string; data?: unknown } = {}) {
    super(message);
    this.name = "FramitError";
    this.code = code;
    this.hint = opts.hint;
    this.data = opts.data;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, data: this.data };
  }
}
