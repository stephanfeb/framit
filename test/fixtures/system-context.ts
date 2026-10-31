// "The system context for this repo": Framit itself. Used by the M4 tests.

export const SYSTEM_CONTEXT = {
  id: "framit-context",
  name: "Framit · system context",
  description: "How Framit sits between a person, Claude Code and the browser.",
  direction: "LR",
  nodes: [
    { id: "person", label: "Designer / developer", kind: "actor" },
    { id: "claude-code", label: "Claude Code", kind: "client", tech: "MCP client" },
    { id: "model", label: "Claude", kind: "external", tech: "Anthropic API", description: "Writes screens and diagrams as JSON" },
    { id: "mcp", label: "Framit MCP server", kind: "service", tech: "Node 20 · TypeScript", group: "framit", emphasis: true, description: "Tools: themes, screens, flows, diagrams, export" },
    { id: "preview", label: "Preview server", kind: "service", tech: "Hono · 127.0.0.1", group: "framit", description: "Editor pages, render API, SSE" },
    { id: "shots", label: "Screenshotter", kind: "function", tech: "Playwright", group: "framit" },
    { id: "store", label: ".framit/ store", kind: "storage", tech: "JSON + revisions", group: "framit" },
    { id: "browser", label: "Browser editor", kind: "client", tech: "Vanilla TS runtime" },
  ],
  groups: [{ id: "framit", label: "Framit (local process)" }],
  edges: [
    { id: "e_ask", from: "person", to: "claude-code", label: "Describes UI" },
    { id: "e_llm", from: "claude-code", to: "model", label: "Prompts", bidirectional: true },
    { id: "e_tools", from: "claude-code", to: "mcp", label: "MCP over stdio" },
    { id: "e_write", from: "mcp", to: "store", label: "Reads / writes" },
    { id: "e_start", from: "mcp", to: "preview", label: "Starts", style: "dashed" },
    { id: "e_shot", from: "mcp", to: "shots", label: "Screenshots" },
    { id: "e_load", from: "shots", to: "preview", label: "Loads pages" },
    { id: "e_edit", from: "person", to: "browser", label: "Edits" },
    { id: "e_patch", from: "browser", to: "preview", label: "PATCH · SSE", bidirectional: true },
    { id: "e_serve", from: "preview", to: "store", label: "Reads / writes" },
  ],
};

export const TIERS = {
  id: "tiers",
  name: "Tiers",
  direction: "TB",
  nodes: [
    { id: "web", label: "Web app", kind: "client", group: "clients" },
    { id: "ios", label: "iOS app", kind: "client", group: "clients" },
    { id: "api", label: "API", kind: "service", tech: "Go", group: "services" },
    { id: "jobs", label: "Workers", kind: "service", group: "services" },
    { id: "q", label: "Jobs", kind: "queue", tech: "SQS", group: "services" },
    { id: "db", label: "Postgres", kind: "database", group: "data" },
    { id: "cache", label: "Redis", kind: "cache", group: "data" },
    { id: "note", label: "Note", kind: "note", description: "Workers scale on queue depth." },
  ],
  groups: [
    { id: "clients", label: "Clients", lane: true },
    { id: "services", label: "Services", lane: true },
    { id: "data", label: "Data", lane: true },
  ],
  edges: [
    { from: "web", to: "api" },
    { from: "ios", to: "api" },
    { from: "api", to: "q", label: "enqueue", style: "dashed" },
    { from: "q", to: "jobs" },
    { from: "api", to: "db" },
    { from: "api", to: "cache", style: "dotted" },
    { from: "jobs", to: "db" },
  ],
};
