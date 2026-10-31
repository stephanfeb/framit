import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FramitError } from "../src/errors.js";
import { Store } from "../src/store/store.js";

let root: string;
let store: Store;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-store-"));
  store = new Store(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const screen = (extra: Record<string, unknown> = {}) => ({
  kind: "screen",
  id: "home",
  name: "Home",
  theme: "wire-mid-light",
  frames: [
    {
      device: "desktop",
      position: { x: 0, y: 0 },
      root: {
        type: "stack",
        children: [
          { type: "text", props: { role: "h1", content: "Hello" } },
          { id: "n_keep", type: "button", props: { label: "Go" } },
        ],
      },
    },
  ],
  ...extra,
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(FramitError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("init", () => {
  it("creates the layout and is idempotent", async () => {
    const first = await store.init({ name: "Demo" });
    expect(first.created).toBe(true);
    expect(first.project.name).toBe("Demo");
    const dirs = await readdir(path.join(root, ".framit"));
    expect(dirs).toEqual(expect.arrayContaining(["screens", "themes", "diagrams", "flows", "exports", ".cache", "project.json", ".gitignore"]));

    const second = await store.init({ name: "Other" });
    expect(second.created).toBe(false);
    expect(second.project.name).toBe("Demo");
  });

  it("defaults the project name to the directory name", async () => {
    const { project } = await store.init();
    expect(project.name).toBe(path.basename(root));
  });

  it("rejects document operations before init", async () => {
    await expectCode(store.read("screen", "home"), "NOT_INITIALIZED");
    await expectCode(store.write("screen", screen()), "NOT_INITIALIZED");
  });
});

describe("write and read", () => {
  beforeEach(() => store.init());

  it("assigns revision, timestamp, and missing ids while keeping existing ones", async () => {
    const { doc, changed } = await store.write("screen", screen());
    expect(changed).toBe(true);
    expect(doc.revision).toBe(1);
    expect(Date.parse(doc.updatedAt)).not.toBeNaN();

    const frame = (doc.frames as any[])[0];
    expect(frame.id).toMatch(/^f_[0-9a-z]{4}$/);
    expect(frame.root.id).toMatch(/^n_[0-9a-z]{4}$/);
    expect(frame.root.children[0].id).toMatch(/^n_[0-9a-z]{4}$/);
    expect(frame.root.children[1].id).toBe("n_keep");

    expect(await store.read("screen", "home")).toEqual(doc);
  });

  it("does not mutate the caller's input", async () => {
    const input = screen();
    await store.write("screen", input);
    expect((input.frames[0] as any).id).toBeUndefined();
  });

  it("bumps the revision on change and is a no-op for identical content", async () => {
    const first = await store.write("screen", screen());
    const same = await store.write("screen", first.doc);
    expect(same.changed).toBe(false);
    expect(same.doc.revision).toBe(1);

    const renamed = await store.write("screen", { ...first.doc, name: "Home v2" });
    expect(renamed.changed).toBe(true);
    expect(renamed.doc.revision).toBe(2);
  });

  it("ignores caller-supplied revision and updatedAt", async () => {
    const { doc } = await store.write("screen", screen({ revision: 99, updatedAt: "1970-01-01T00:00:00Z" }));
    expect(doc.revision).toBe(1);
    expect(doc.updatedAt).not.toBe("1970-01-01T00:00:00Z");
  });

  it("enforces expectedRevision and returns the current doc on mismatch", async () => {
    await store.write("screen", screen(), { expectedRevision: 0 });
    const err = await store.write("screen", screen({ name: "x" }), { expectedRevision: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(FramitError);
    expect(err.code).toBe("REVISION");
    expect(err.data.current.revision).toBe(1);

    const ok = await store.write("screen", screen({ name: "x" }), { expectedRevision: 1 });
    expect(ok.doc.revision).toBe(2);
  });

  it("rejects duplicate node ids", async () => {
    const dup = screen();
    (dup.frames[0] as any).root.children[0].id = "n_keep";
    await expectCode(store.write("screen", dup), "SCHEMA");
  });

  it("rejects unsafe document ids", async () => {
    for (const id of ["../escape", "Upper", "", "a/b", ".hidden"]) {
      await expectCode(store.write("screen", screen({ id })), "INVALID_ID");
    }
  });

  it("writes atomically and leaves no temp files", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.write("screen", screen({ name: `v${i}` }))));
    const files = await readdir(path.join(root, ".framit", "screens"));
    expect(files).toEqual(["home.json"]);
    const doc = JSON.parse(await readFile(path.join(root, ".framit", "screens", "home.json"), "utf8"));
    expect(doc.revision).toBe(20);
  });

  it("serialises concurrent revision-checked writes so only one wins", async () => {
    await store.write("screen", screen());
    const results = await Promise.allSettled(
      [1, 2, 3].map((n) => store.write("screen", screen({ name: `n${n}` }), { expectedRevision: 1 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
  });
});

describe("list, delete, not found", () => {
  beforeEach(() => store.init());

  it("lists summaries and skips corrupt files", async () => {
    await store.write("screen", screen());
    await store.write("screen", screen({ id: "about", name: "About" }));
    await writeFile(path.join(root, ".framit", "screens", "broken.json"), "{nope");
    const list = await store.list("screen");
    expect(list.map((s) => s.id)).toEqual(["about", "home"]);
    expect(await store.counts()).toEqual({ screen: 2, diagram: 0, flow: 0, theme: 0 });
  });

  it("suggests similar ids when not found", async () => {
    await store.write("screen", screen({ id: "account-overview" }));
    const err = await store.read("screen", "account").catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.hint).toContain("account-overview");
  });

  it("deletes", async () => {
    await store.write("screen", screen());
    await store.delete("screen", "home");
    await expectCode(store.read("screen", "home"), "NOT_FOUND");
    await expectCode(store.delete("screen", "home"), "NOT_FOUND");
  });
});
