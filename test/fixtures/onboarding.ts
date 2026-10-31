// A three-screen onboarding prototype used by the M3 tests.

const phoneShell = (id: string, children: unknown[]) => ({ id: `${id}_root`, type: "stack", props: { padding: "xl", gap: "lg" }, children });

export const WELCOME = {
  id: "welcome",
  name: "Welcome",
  theme: "wire-mid-light",
  frames: [
    {
      id: "f_desk",
      name: "Desktop",
      device: "desktop",
      root: {
        id: "w_droot",
        type: "stack",
        props: { padding: "2xl", gap: "lg", align: "center" },
        children: [
          { id: "w_dtitle", type: "text", props: { role: "display", content: "Welcome to Ledger" } },
          { id: "w_dcta", type: "button", props: { label: "Get started", variant: "primary", to: "verify-email" } },
        ],
      },
    },
    {
      id: "f_phone",
      name: "Phone",
      device: "phone",
      root: phoneShell("w", [
        { id: "w_title", type: "text", props: { role: "h1", content: "Welcome to Ledger" } },
        { id: "w_intro", type: "text", props: { content: "Track every account in one place.", muted: true } },
        { id: "w_email", type: "input", props: { label: "Email", placeholder: "you@example.com" } },
        { id: "w_cta", type: "button", props: { label: "Get started", variant: "primary", fullWidth: true } },
        { id: "w_login", type: "link", props: { label: "I already have an account" } },
      ]),
    },
  ],
};

export const VERIFY = {
  id: "verify-email",
  name: "Verify email",
  theme: "wire-mid-light",
  frames: [
    {
      id: "f_desk",
      device: "desktop",
      root: { id: "v_droot", type: "stack", props: { padding: "2xl" }, children: [{ id: "v_dtitle", type: "text", props: { role: "h1", content: "Check your inbox (desktop)" } }] },
    },
    {
      id: "f_phone",
      device: "phone",
      root: phoneShell("v", [
        { id: "v_title", type: "text", props: { role: "h1", content: "Check your inbox" } },
        { id: "v_code", type: "input", props: { label: "6-digit code", placeholder: "123456" } },
        { id: "v_done", type: "button", props: { label: "Verify", variant: "primary", fullWidth: true, to: "all-set" } },
        { id: "v_back", type: "link", props: { label: "Use a different email", to: "welcome" } },
      ]),
    },
  ],
};

export const ALL_SET = {
  id: "all-set",
  name: "All set",
  theme: "wire-mid-light",
  frames: [
    {
      id: "f_phone",
      device: "phone",
      root: phoneShell("a", [
        { id: "a_title", type: "text", props: { role: "h1", content: "You're all set" } },
        { id: "a_tabs", type: "tabs", props: { items: ["Accounts", "Budgets"], active: 0 } },
        { id: "a_done", type: "button", props: { label: "Open dashboard", variant: "primary", fullWidth: true } },
      ]),
    },
  ],
};

export const ONBOARDING_FLOW = {
  id: "onboarding",
  name: "Onboarding",
  device: "phone",
  steps: [{ screen: "welcome" }, { screen: "verify-email", label: "Verify" }, { screen: "all-set" }],
  // The phone welcome button has no `to`: the flow edge makes it a hotspot.
  edges: [{ from: { screen: "welcome", node: "w_cta" }, to: "verify-email", label: "Tap Get started" }],
};
