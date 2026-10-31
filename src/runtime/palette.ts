import { h } from "./dom.js";
import type { Editor } from "./editor.js";

/** Insert palette (`/` or ⌘K): fuzzy list of components; Enter inserts at the selection. */
export function openPalette(ed: Editor) {
  const items = Object.values(ed.meta.components).sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
  let active = 0;
  let shown = items;
  const input = h("input", { placeholder: "Insert component…", autocomplete: "off", spellcheck: false }) as HTMLInputElement;
  const list = h("ul", {});
  const close = () => {
    backdrop.remove();
    ed.paletteOpen = false;
  };
  const choose = (i: number) => {
    const c = shown[i];
    if (!c) return;
    close();
    ed.insert(c.type);
  };
  // Hover follows real pointer movement only: rows redrawn under a still pointer must not steal the
  // keyboard choice (mouseenter fires when a row appears under the cursor).
  const draw = () => {
    list.replaceChildren(
      ...shown.map((c, i) =>
        h("li", { class: i === active ? "is-active" : undefined, onpointerdown: (e: Event) => (e.preventDefault(), choose(i)), onpointermove: () => active !== i && ((active = i), draw()) }, h("b", {}, c.type), h("span", {}, `${c.category} · ${c.summary}`)),
      ),
    );
    list.children[active]?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    shown = q ? items.filter((c) => c.type.includes(q) || c.summary.toLowerCase().includes(q) || c.category.includes(q)).sort((a, b) => Number(!a.type.startsWith(q)) - Number(!b.type.startsWith(q))) : items;
    active = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (active = Math.min(shown.length - 1, active + 1)), draw(), e.preventDefault();
    else if (e.key === "ArrowUp") (active = Math.max(0, active - 1)), draw(), e.preventDefault();
    else if (e.key === "Enter") choose(active), e.preventDefault();
    else if (e.key === "Escape") close(), e.preventDefault();
    e.stopPropagation();
  });
  const where = ed.insertTarget();
  const hint = h("div", { class: "fx-palette-hint" }, where ? `Inserts ${where.inside ? "inside" : "after"} the selected ${where.label}. ↑↓ to choose, Enter to insert.` : "Select a node or frame first to choose where it goes.");
  const backdrop: HTMLDivElement = h("div", { class: "fx-palette-backdrop" }, h("div", { class: "fx-palette" }, input, list, hint));
  backdrop.addEventListener("pointerdown", (e) => e.target === backdrop && close());
  document.body.append(backdrop);
  ed.paletteOpen = true;
  draw();
  input.focus();
}
