// Prototype behaviour shared by the editor's Preview mode, the player (present mode and HTML
// export) and the flow canvas: live controls inside frames and hotspot navigation.

export interface FrameInfo {
  screen: string;
  frame: string;
  device: string;
  width: number;
  height: number;
}

/** The target screen's frame for the same device; else the same width; else the closest width. */
export function pickFrame<T extends FrameInfo>(candidates: T[], current: { device?: string; width: number }): T | undefined {
  if (!candidates.length) return undefined;
  return (
    (current.device && current.device !== "custom" ? candidates.find((f) => f.device === current.device) : undefined) ??
    candidates.find((f) => f.width === current.width) ??
    [...candidates].sort((a, b) => Math.abs(a.width - current.width) - Math.abs(b.width - current.width))[0]
  );
}

/** What a frame element says about itself (renderFrame records it as data attributes). */
export function frameInfoOf(el: HTMLElement): FrameInfo {
  return { screen: el.dataset.screen ?? "", frame: el.dataset.frame ?? "", device: el.dataset.device ?? "custom", width: Number(el.dataset.w) || el.offsetWidth, height: Number(el.dataset.h) || el.offsetHeight };
}

/**
 * Handle a click inside rendered frames in a live (non-design) context. Hotspots call
 * `navigate`; tabs and tab bars switch their active item. Returns true when it handled the
 * click. A click on nothing interactive briefly highlights the hotspots, as in Figma.
 */
export function prototypeClick(e: MouseEvent, navigate: (to: string, frame: HTMLElement, hotspot: HTMLElement) => void): boolean {
  const el = e.target as HTMLElement;
  const frame = el.closest<HTMLElement>(".fx-frame");
  if (!frame) return false;
  const hot = el.closest<HTMLElement>("[data-to]");
  if (hot && frame.contains(hot)) {
    e.preventDefault();
    navigate(hot.dataset.to!, frame, hot);
    return true;
  }
  const tab = el.closest<HTMLElement>(".fx-tab, .fx-tabbar-item, .fx-nav-item");
  if (tab && !tab.matches(":disabled")) {
    for (const sib of Array.from(tab.parentElement?.children ?? [])) sib.classList.toggle("is-active", sib === tab);
    return true;
  }
  if (!el.closest("input, textarea, select, label, button, a")) flashHotspots(frame);
  return false;
}

function flashHotspots(frame: HTMLElement) {
  if (!frame.querySelector("[data-to]")) return;
  frame.classList.add("fx-hints-flash");
  setTimeout(() => frame.classList.remove("fx-hints-flash"), 650);
}

/** Fade `box` out, run `swap`, fade back in (150ms in total). */
export async function crossfade(box: HTMLElement, swap: () => void): Promise<void> {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof box.animate !== "function") return swap();
  await box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 75, easing: "ease-out" }).finished.catch(() => undefined);
  swap();
  await box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 75, easing: "ease-in" }).finished.catch(() => undefined);
}

/** Styles for hotspot hints; injected once by whichever runtime runs. */
export const PROTOTYPE_CSS = `
.fx-frame [data-to] { cursor: pointer; }
.fx-hints .fx-frame [data-to], .fx-frame.fx-hints-flash [data-to] { outline: 2px solid rgba(59,108,255,.75); outline-offset: 2px; border-radius: 4px; transition: outline-color .2s; }
`;

export function injectPrototypeCss() {
  if (document.getElementById("fx-proto-css")) return;
  const s = document.createElement("style");
  s.id = "fx-proto-css";
  s.textContent = PROTOTYPE_CSS;
  document.head.append(s);
}
