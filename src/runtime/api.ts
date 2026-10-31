import type { Op } from "../shared/patch-core.js";
import type { Meta, ScreenDoc } from "./model.js";

export type PatchResult = { ok: true; revision: number; doc: ScreenDoc; rebased: boolean } | { ok: false; status: number; error: { code?: string; message: string; hint?: string } };

export class Api {
  constructor(
    readonly id: string,
    readonly clientId: string,
  ) {}

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  doc = () => this.json<ScreenDoc>(`/api/doc/screen/${encodeURIComponent(this.id)}`);
  meta = () => this.json<Meta>("/api/meta");
  canvas = () => this.json<{ revision: number; html: string }>(`/api/render/canvas/${encodeURIComponent(this.id)}`);
  /** Every frame of any screen, for preview-mode navigation. */
  screenFrames = (id: string) => this.json<Array<{ frame: string; name?: string; device: string; width: number; height: number; html: string }>>(`/api/render/screen/${encodeURIComponent(id)}`);
  frame = async (fid: string) => (await this.json<Array<{ frame: string; html: string }>>(`/api/render/screen/${encodeURIComponent(this.id)}?frame=${encodeURIComponent(fid)}`))[0];

  async patch(baseRevision: number, ops: Op[]): Promise<PatchResult> {
    try {
      const res = await fetch(`/api/doc/screen/${encodeURIComponent(this.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-framit-client": this.clientId },
        body: JSON.stringify({ baseRevision, ops }),
      });
      const body = await res.json().catch(() => ({ message: res.statusText }));
      if (!res.ok) return { ok: false, status: res.status, error: body };
      return { ok: true, ...(body as { revision: number; doc: ScreenDoc; rebased: boolean }) };
    } catch (err) {
      return { ok: false, status: 0, error: { message: `Server unreachable: ${(err as Error).message}` } };
    }
  }

  events(onChange: (e: { kind: string; id: string; revision: number | null; source?: string }) => void): EventSource {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        onChange(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    return es;
  }
}
