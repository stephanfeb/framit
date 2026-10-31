import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { FramitError } from "../errors.js";
import { isValidDocId } from "./ids.js";
import { assignScreenIds } from "./nodes.js";

export const STORE_DIRNAME = ".framit";

export type DocKind = "screen" | "diagram" | "flow" | "theme";
export const DOC_KINDS: readonly DocKind[] = ["screen", "diagram", "flow", "theme"] as const;

const KIND_DIRS: Record<DocKind, string> = {
  screen: "screens",
  diagram: "diagrams",
  flow: "flows",
  theme: "themes",
};

/** Fields every stored document carries. The rest is kind-specific. */
export interface StoredDoc {
  kind: DocKind;
  id: string;
  name?: string;
  revision: number;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ProjectMeta {
  name: string;
  defaultTheme: string;
  createdAt: string;
  framitVersion: string;
}

export interface WriteResult {
  doc: StoredDoc;
  /** False when the incoming document was identical to what was on disk (idempotent write). */
  changed: boolean;
}

export interface DocSummary {
  id: string;
  name?: string;
  revision: number;
  updatedAt: string;
}

/**
 * The document store: JSON files under `<root>/.framit/`. It is the single source of
 * truth (ADR-004). Writes are atomic (temp file + rename) and serialised per document
 * inside this process so the MCP server and the preview server cannot interleave a
 * read-modify-write.
 */
export interface ChangeEvent {
  kind: DocKind;
  id: string;
  revision: number | null; // null when deleted
  /** Who made the change: an editor tab id, "mcp", or undefined. Lets a tab ignore its own echo. */
  source?: string;
}

export class Store {
  /** Emits "change" (ChangeEvent) after every successful write or delete. */
  readonly events = new EventEmitter();
  readonly root: string;
  readonly base: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(root: string, private readonly version = "0.0.1") {
    this.events.setMaxListeners(100);
    this.root = path.resolve(root);
    this.base = path.join(this.root, STORE_DIRNAME);
  }

  // ---------- project ----------

  async isInitialized(): Promise<boolean> {
    return exists(this.projectFile());
  }

  /** Create `.framit/` and `project.json`. Idempotent: an existing project is returned unchanged. */
  async init(opts: { name?: string; defaultTheme?: string } = {}): Promise<{ project: ProjectMeta; created: boolean }> {
    for (const dir of [...Object.values(KIND_DIRS), "exports", ".cache"]) {
      await mkdir(path.join(this.base, dir), { recursive: true });
    }
    if (await this.isInitialized()) return { project: await this.getProject(), created: false };

    const project: ProjectMeta = {
      name: opts.name ?? path.basename(this.root),
      defaultTheme: opts.defaultTheme ?? "wire-mid-light",
      createdAt: new Date().toISOString(),
      framitVersion: this.version,
    };
    await atomicWriteJson(this.projectFile(), project);
    // Rendered output and screenshots are derived; keep them out of the user's git.
    await atomicWrite(path.join(this.base, ".gitignore"), ".cache/\nexports/\n");
    return { project, created: true };
  }

  async getProject(): Promise<ProjectMeta> {
    await this.requireInit();
    return readJson<ProjectMeta>(this.projectFile());
  }

  // ---------- documents ----------

  async read(kind: DocKind, id: string): Promise<StoredDoc> {
    await this.requireInit();
    const file = this.docFile(kind, id);
    if (!(await exists(file))) {
      const known = (await this.list(kind)).map((d) => d.id);
      throw new FramitError("NOT_FOUND", `No ${kind} with id "${id}".`, {
        hint: known.length ? `Known ${kind} ids: ${nearest(id, known).join(", ")}` : `There are no ${kind}s yet.`,
      });
    }
    return readJson<StoredDoc>(file);
  }

  async list(kind: DocKind): Promise<DocSummary[]> {
    await this.requireInit();
    const dir = path.join(this.base, KIND_DIRS[kind]);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const out: DocSummary[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) continue;
      try {
        const doc = await readJson<StoredDoc>(path.join(dir, entry));
        out.push({ id: doc.id, name: doc.name, revision: doc.revision, updatedAt: doc.updatedAt });
      } catch {
        // A corrupt or half-edited file should not break listing; skip it.
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Create or replace a document. Bumps `revision` and `updatedAt`, assigns missing node
   * ids, and enforces `expectedRevision` when given. Writing content identical to what is
   * on disk is a no-op and returns the stored document with `changed: false`.
   */
  async write(
    kind: DocKind,
    input: Record<string, unknown>,
    opts: { expectedRevision?: number; source?: string } = {},
  ): Promise<WriteResult> {
    await this.requireInit();
    const id = input.id;
    if (typeof id !== "string") throw new FramitError("SCHEMA", "Document is missing a string `id`.");
    this.assertId(id);

    return this.withLock(`${kind}/${id}`, async () => {
      const file = this.docFile(kind, id);
      const current = (await exists(file)) ? await readJson<StoredDoc>(file) : undefined;

      if (opts.expectedRevision !== undefined && (current?.revision ?? 0) !== opts.expectedRevision) {
        throw new FramitError(
          "REVISION",
          `Expected revision ${opts.expectedRevision} of ${kind} "${id}", but it is at ${current?.revision ?? 0}.`,
          {
            hint: "It changed since you read it, possibly from an edit in the browser. Merge your change into `data.current` and write again with its revision.",
            data: { current },
          },
        );
      }

      const { revision: _r, updatedAt: _u, ...body } = structuredClone(input);
      const next = { ...body, kind, id } as Record<string, unknown>;
      if (kind === "screen") assignScreenIds(next);

      if (current) {
        const { revision: _cr, updatedAt: _cu, ...currentBody } = current;
        if (stableStringify(currentBody) === stableStringify(next)) return { doc: current, changed: false };
      }

      const doc: StoredDoc = {
        ...(next as Omit<StoredDoc, "revision" | "updatedAt">),
        kind,
        id,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteJson(file, doc);
      this.events.emit("change", { kind, id, revision: doc.revision, source: opts.source } satisfies ChangeEvent);
      return { doc, changed: true };
    });
  }

  async delete(kind: DocKind, id: string, source?: string): Promise<void> {
    await this.read(kind, id); // throws NOT_FOUND with suggestions
    await this.withLock(`${kind}/${id}`, () => rm(this.docFile(kind, id)));
    this.events.emit("change", { kind, id, revision: null, source } satisfies ChangeEvent);
  }

  async counts(): Promise<Record<DocKind, number>> {
    const out = {} as Record<DocKind, number>;
    for (const kind of DOC_KINDS) out[kind] = (await this.list(kind)).length;
    return out;
  }

  // ---------- internals ----------

  private projectFile() {
    return path.join(this.base, "project.json");
  }

  private docFile(kind: DocKind, id: string) {
    this.assertId(id);
    return path.join(this.base, KIND_DIRS[kind], `${id}.json`);
  }

  private assertId(id: string) {
    if (!isValidDocId(id)) {
      throw new FramitError("INVALID_ID", `"${id}" is not a valid document id.`, {
        hint: "Use 1-64 lowercase letters, digits, '-' or '_', starting with a letter or digit, e.g. \"account-overview\".",
      });
    }
  }

  private async requireInit() {
    if (!(await this.isInitialized())) {
      throw new FramitError("NOT_INITIALIZED", `No Framit project in ${this.root}.`, {
        hint: "Call init_project first.",
      });
    }
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

// ---------- fs helpers ----------

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T> {
  const text = await readFile(file, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new FramitError("IO", `${file} is not valid JSON: ${(err as Error).message}`, {
      hint: "Fix or delete the file by hand; Framit never writes partial files.",
    });
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function atomicWriteJson(file: string, value: unknown): Promise<void> {
  return atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
}

/** JSON.stringify with sorted object keys, for content equality checks. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Up to five known ids, closest first by a cheap edit-distance proxy. */
function nearest(id: string, known: string[]): string[] {
  const score = (k: string) => {
    let common = 0;
    while (common < Math.min(id.length, k.length) && id[common] === k[common]) common++;
    return -common + Math.abs(id.length - k.length) * 0.1 + (k.includes(id) || id.includes(k) ? -5 : 0);
  };
  return [...known].sort((a, b) => score(a) - score(b)).slice(0, 5);
}
