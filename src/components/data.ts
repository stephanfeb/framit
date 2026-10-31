import { z } from "zod";
import { Tone } from "../schema/tokens.js";
import { cls, esc, initials } from "../renderer/html.js";
import type { RenderCtx } from "./types.js";
import { defineComponent } from "./types.js";

const Cell = z.union([
  z.string(),
  z.number(),
  z.null(),
  z
    .object({
      text: z.string().optional(),
      sub: z.string().optional().describe("Second line under the text."),
      badge: z.string().optional(),
      tone: Tone.optional(),
      link: z.string().optional(),
      avatar: z.string().optional().describe("Name for an initials avatar before the text."),
      icon: z.string().optional(),
      muted: z.boolean().optional(),
      bold: z.boolean().optional(),
      mono: z.boolean().optional(),
    })
    .strict(),
]);
type Cell = z.infer<typeof Cell>;

const Column = z.union([
  z.string(),
  z
    .object({
      key: z.string().optional().describe("Row object key; defaults to the label."),
      label: z.string(),
      align: z.enum(["left", "center", "right"]).optional(),
      width: z.union([z.number(), z.string()]).optional(),
    })
    .strict(),
]);

function renderCell(c: Cell | undefined, ctx: RenderCtx, ptr: string): string {
  if (c === undefined || c === null || c === "") return `<span class="fx-muted">—</span>`;
  if (typeof c !== "object") return ctx.edit(ptr, c);
  if (c.badge !== undefined) return `<span class="fx-badge fx-badge--soft fx-tone-${c.tone ?? "neutral"}">${ctx.edit(`${ptr}/badge`, c.badge)}</span>`;
  if (c.link !== undefined) return `<a class="fx-link">${ctx.edit(`${ptr}/link`, c.link)}</a>`;
  const main = `<span class="${cls(c.muted && "fx-muted", c.bold && "fx-strong", c.mono && "fx-mono", c.tone && `fx-tone-${c.tone}`)}">${ctx.edit(`${ptr}/text`, c.text ?? "")}</span>`;
  const body = c.sub ? `<span class="fx-cell-stack">${main}<span class="fx-cell-sub">${ctx.edit(`${ptr}/sub`, c.sub)}</span></span>` : main;
  const lead = c.avatar !== undefined ? `<span class="fx-avatar-disc" style="width:28px;height:28px;font-size:11px;--fx-avatar-hue:${[...c.avatar].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360}">${esc(initials(c.avatar))}</span>` : c.icon ? ctx.icon(c.icon, 16, "fx-muted-icon") : "";
  return lead ? `<span class="fx-cell-lead">${lead}${body}</span>` : body;
}

export const table = defineComponent({
  type: "table",
  category: "data",
  summary:
    "Data table. Columns are labels or {key,label,align,width}. Rows are arrays (by position) or objects (by key). Cells are text or {text,sub,badge,tone,link,avatar,icon,muted,bold,mono}.",
  container: false,
  props: z
    .object({
      columns: z.array(Column).min(1),
      rows: z.array(z.union([z.array(Cell), z.record(z.string(), Cell)])).default([]),
      dense: z.boolean().default(false),
      selectable: z.boolean().default(false).describe("Leading checkbox column."),
      rowActions: z.boolean().default(false).describe("Trailing overflow menu per row."),
      footer: z.string().optional().describe('e.g. "Showing 1–10 of [N]".'),
      framed: z.boolean().default(true).describe("Draw the table on a bordered surface."),
    })
    .strict(),
  example: {
    width: 460,
    props: {
      columns: ["Name", "Status", { label: "Seats", align: "right" }],
      rows: [
        [{ text: "Ada Lovelace", avatar: "Ada Lovelace" }, { badge: "Active", tone: "success" }, "12"],
        [{ text: "Grace Hopper", avatar: "Grace Hopper" }, { badge: "Invited", tone: "warning" }, "3"],
      ],
    },
  },
  render: (n, ctx) => {
    const p = n.props;
    const cols = p.columns.map((c, i) => (typeof c === "string" ? { key: c, label: c, align: undefined, width: undefined, ptr: `/columns/${i}` } : { ...c, key: c.key ?? c.label, ptr: `/columns/${i}/label` }));
    const thAttr = (c: (typeof cols)[number]) => {
      const st = [c.align && c.align !== "left" ? `text-align:${c.align}` : "", c.width !== undefined ? `width:${typeof c.width === "number" ? `${c.width}px` : esc(c.width)}` : ""].filter(Boolean).join(";");
      return st ? ` style="${st}"` : "";
    };
    const check = `<td class="fx-td-check"><span class="fx-check-box"></span></td>`;
    const head = `<tr>${p.selectable ? `<th class="fx-td-check"><span class="fx-check-box"></span></th>` : ""}${cols.map((c) => `<th${thAttr(c)}>${typeof p.columns[cols.indexOf(c)] === "string" ? ctx.text(c.label) : ctx.edit(c.ptr, c.label)}</th>`).join("")}${p.rowActions ? "<th></th>" : ""}</tr>`;
    const body = p.rows
      .map((r, ri) => {
        const cells = cols.map((c, i) => {
          const v = Array.isArray(r) ? r[i] : r[c.key];
          const ptr = `/rows/${ri}/${Array.isArray(r) ? i : c.key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
          return `<td${c.align && c.align !== "left" ? ` style="text-align:${c.align}"` : ""}>${renderCell(v, ctx, ptr)}</td>`;
        });
        if (Array.isArray(r) && r.length > cols.length) ctx.warn(n.id, `table row has ${r.length} cells but only ${cols.length} columns.`);
        return `<tr>${p.selectable ? check : ""}${cells.join("")}${p.rowActions ? `<td class="fx-td-actions">${ctx.icon("ellipsis", 16, "fx-muted-icon")}</td>` : ""}</tr>`;
      })
      .join("");
    const s = ctx.theme.components.table ?? {};
    const footer = p.footer ? `<div class="fx-table-footer">${ctx.edit("/footer", p.footer)}</div>` : "";
    return `<div ${ctx.attrs(n, cls("fx-table-wrap", p.framed && "fx-table-wrap--framed"))}><div class="fx-table-scroll"><table class="${cls("fx-table", p.dense && "fx-table--dense", s.header === "filled" && "fx-table--filled", s.zebra && "fx-table--zebra")}"><thead>${head}</thead><tbody>${body}</tbody></table></div>${footer}</div>`;
  },
});

const Leading = z
  .object({ icon: z.string().optional(), avatar: z.string().optional(), image: z.boolean().optional(), tone: Tone.optional() })
  .strict();
const Trailing = z.union([
  z.enum(["chevron", "toggle", "toggle-on", "check", "more"]),
  z.object({ badge: z.string().optional(), tone: Tone.optional(), text: z.string().optional(), icon: z.string().optional(), button: z.string().optional() }).strict(),
]);

export const list = defineComponent({
  type: "list",
  category: "data",
  summary: "Rows with title, subtitle, meta, a leading icon/avatar/image and a trailing chevron, toggle, badge, text or button. The workhorse of mobile screens.",
  container: false,
  props: z
    .object({
      items: z
        .array(
          z
            .object({
              title: z.string(),
              subtitle: z.string().optional(),
              meta: z.string().optional().describe("Small text at the top right, e.g. a time."),
              leading: Leading.optional(),
              trailing: Trailing.optional(),
              to: z.string().optional(),
            })
            .strict(),
        )
        .default([]),
      divided: z.boolean().default(true),
      variant: z.enum(["plain", "inset"]).default("plain").describe("inset draws the list on a rounded surface."),
      dense: z.boolean().default(false),
    })
    .strict(),
  example: {
    width: 320,
    props: {
      variant: "inset",
      items: [
        { title: "Ada Lovelace", subtitle: "Sent you a message", meta: "2m", leading: { avatar: "Ada Lovelace" } },
        { title: "Notifications", leading: { icon: "bell" }, trailing: "toggle-on" },
        { title: "Privacy", leading: { icon: "lock" }, trailing: "chevron" },
      ],
    },
  },
  render: (n, ctx) => {
    const items = n.props.items
      .map((it, i) => {
        const l = it.leading;
        const lead = !l
          ? ""
          : l.avatar !== undefined
            ? `<span class="fx-avatar-disc" style="width:36px;height:36px;font-size:13px;--fx-avatar-hue:${[...l.avatar].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc(initials(l.avatar))}</span>`
            : l.image
              ? `<span class="fx-list-thumb">${ctx.icon("image", 18)}</span>`
              : l.icon
                ? `<span class="${cls("fx-list-icon", l.tone && `fx-tone-${l.tone}`)}">${ctx.icon(l.icon, 18)}</span>`
                : "";
        const t = it.trailing;
        const trail =
          t === undefined
            ? ""
            : t === "chevron"
              ? ctx.icon("chevron-right", 18, "fx-muted-icon")
              : t === "more"
                ? ctx.icon("ellipsis", 18, "fx-muted-icon")
                : t === "check"
                  ? ctx.icon("check", 18, "fx-tone-accent")
                  : t === "toggle" || t === "toggle-on"
                    ? `<span class="fx-switch"><input type="checkbox"${t === "toggle-on" ? " checked" : ""}><span class="fx-switch-track"></span></span>`
                    : t.badge !== undefined
                      ? `<span class="fx-badge fx-badge--soft fx-tone-${t.tone ?? "neutral"}">${ctx.text(t.badge)}</span>`
                      : t.button !== undefined
                        ? `<span class="fx-button fx-button--secondary fx-button--sm"><span>${ctx.text(t.button)}</span></span>`
                        : `${t.text !== undefined ? `<span class="fx-muted">${ctx.text(t.text)}</span>` : ""}${t.icon ? ctx.icon(t.icon, 18, "fx-muted-icon") : ""}`;
        return `<li class="fx-list-item"${it.to ? ` data-to="${esc(it.to)}"` : ""}>${lead}<span class="fx-list-body"><span class="fx-list-top"><span class="fx-list-title">${ctx.edit(`/items/${i}/title`, it.title)}</span>${it.meta ? `<span class="fx-list-meta">${ctx.edit(`/items/${i}/meta`, it.meta)}</span>` : ""}</span>${it.subtitle ? `<span class="fx-list-sub">${ctx.edit(`/items/${i}/subtitle`, it.subtitle)}</span>` : ""}</span>${trail ? `<span class="fx-list-trail">${trail}</span>` : ""}</li>`;
      })
      .join("");
    return `<ul ${ctx.attrs(n, cls("fx-list", n.props.divided && "fx-list--divided", `fx-list--${n.props.variant}`, n.props.dense && "fx-list--dense"))}>${items}</ul>`;
  },
});
