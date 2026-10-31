import type { ResolvedTheme } from "../schema/theme.js";

/*
 * Starter themes (ADR-008: shipped in the package, copied into a project on first use so
 * they can be edited freely). Each carries prose notes, because the numbers alone do not
 * tell a later session what the designer intended.
 */

const SANS = '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const DEVICES = { desktop: [1440, 900], laptop: [1280, 800], tablet: [834, 1194], phone: [390, 844] } as ResolvedTheme["tokens"]["device"];

const TYPE: ResolvedTheme["tokens"]["type"] = {
  display: [36, 1.15, 700, -0.022],
  h1: [26, 1.25, 650, -0.018],
  h2: [19, 1.35, 600, -0.012],
  h3: [15, 1.4, 600, -0.006],
  body: [14, 1.55, 400, -0.003],
  label: [13, 1.35, 500, 0],
  caption: [12, 1.45, 400, 0],
  overline: [11, 1.3, 600, 0.08],
  code: [13, 1.5, 400, 0],
};

const SPACE = { unit: 4, xs: 1, sm: 2, md: 4, lg: 6, xl: 8, "2xl": 12 };

export const wireMidLight: ResolvedTheme = {
  id: "wire-mid-light",
  name: "Wire · mid-fi light",
  fidelity: "mid",
  mode: "light",
  tokens: {
    color: {
      bg: "#f8f9fb",
      surface: "#ffffff",
      surface2: "#f2f4f7",
      border: "#e4e7ec",
      text: "#101828",
      muted: "#667085",
      accent: "#4f5bd5",
      accentText: "#ffffff",
      success: "#079455",
      warning: "#dc6803",
      danger: "#d92d20",
      info: "#1570ef",
    },
    font: { sans: SANS, mono: MONO },
    type: TYPE,
    space: SPACE,
    radius: { sm: 6, md: 8, lg: 12, pill: 999 },
    stroke: { width: 1 },
    shadow: {
      sm: "0 1px 2px rgba(16,24,40,.06)",
      md: "0 4px 12px -2px rgba(16,24,40,.08), 0 2px 4px -2px rgba(16,24,40,.04)",
      lg: "0 16px 32px -8px rgba(16,24,40,.14), 0 4px 8px -4px rgba(16,24,40,.06)",
    },
    device: DEVICES,
  },
  components: {
    button: { radius: "md", height: 36 },
    input: { radius: "md", height: 38 },
    card: { radius: "lg", padding: "lg", border: true, shadow: "none" },
    nav: { activeStyle: "pill" },
    table: { header: "filled", zebra: false },
  },
  notes:
    "Neutral, clean mid-fidelity wireframes on a light canvas. Content sits on white cards over a faint grey page. " +
    "One indigo accent, used only for primary actions, links, and the active nav item. Status is shown with " +
    "success/warning/danger tones, never the accent. Headings are tight and slightly negative-tracked; body text is 14px. " +
    "Spacing is on a 4px grid: use md between related items, lg between groups, xl for page padding.",
};

export const wireMidDark: ResolvedTheme = {
  id: "wire-mid-dark",
  name: "Wire · mid-fi dark",
  fidelity: "mid",
  mode: "dark",
  tokens: {
    ...wireMidLight.tokens,
    color: {
      bg: "#0b0d14",
      surface: "#141827",
      surface2: "#1b2033",
      border: "#262c42",
      text: "#e8eaf2",
      muted: "#8b91a7",
      accent: "#5b7cff",
      accentText: "#ffffff",
      success: "#3dcc8e",
      warning: "#f0b35a",
      danger: "#ef5a6f",
      info: "#5b9cff",
    },
    shadow: {
      sm: "0 1px 2px rgba(0,0,0,.4)",
      md: "0 6px 16px -4px rgba(0,0,0,.5)",
      lg: "0 20px 40px -12px rgba(0,0,0,.6)",
    },
  },
  components: { ...wireMidLight.components, card: { radius: "lg", padding: "lg", border: true, shadow: "none" } },
  notes:
    "Dark, calm mid-fidelity wireframes: near-black navy page, slightly lifted navy surfaces, hairline borders. " +
    "A single periwinkle accent for primary actions, links and the active nav item. Status uses green/amber/red tones " +
    "for text and soft badges, never the accent. Keep surfaces flat (no shadows); separate regions with borders and " +
    "spacing. Same 4px spacing grid and type scale as wire-mid-light, so screens can be swapped between the two.",
};

export const wireLo: ResolvedTheme = {
  id: "wire-lo",
  name: "Wire · lo-fi",
  fidelity: "lo",
  mode: "light",
  tokens: {
    ...wireMidLight.tokens,
    color: {
      bg: "#ffffff",
      surface: "#ffffff",
      surface2: "#f3f3f3",
      border: "#b8b8b8",
      text: "#1f1f1f",
      muted: "#7a7a7a",
      accent: "#3a3a3a",
      accentText: "#ffffff",
      success: "#4a4a4a",
      warning: "#5a5a5a",
      danger: "#3a3a3a",
      info: "#4a4a4a",
    },
    radius: { sm: 3, md: 4, lg: 6, pill: 999 },
    stroke: { width: 1.5 },
    shadow: { sm: "none", md: "none", lg: "none" },
  },
  components: {
    button: { radius: "sm", height: 36 },
    input: { radius: "sm", height: 38 },
    card: { radius: "md", padding: "lg", border: true, shadow: "none" },
    nav: { activeStyle: "bar" },
    table: { header: "plain", zebra: false },
  },
  notes:
    "Greyscale low-fidelity sketch. No colour at all: hierarchy comes from weight, size and spacing only. " +
    "Heavier 1.5px strokes, small radii, no shadows. Images and charts render as crossed boxes. Use it early, " +
    "when the conversation should be about structure and flow rather than visual polish.",
};

export const BUILTIN_THEMES: Record<string, ResolvedTheme> = Object.fromEntries(
  [wireMidLight, wireMidDark, wireLo].map((t) => [t.id, t]),
);
