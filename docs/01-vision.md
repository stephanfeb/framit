# 01 · Vision

## The brief

Build a local MCP server that produces beautiful wireframe diagrams from text descriptions.
It should be able to:

- lay out desktop and mobile screens,
- draw architecture diagrams,
- produce theme and style documents that follow-up sessions can use to generate additional
  screens consistently.

## The bar

Best-in-class wireframing tools now behave like Figma or Sketch in the browser. The output is
not a picture. It is a canvas where:

- text can be selected and rewritten in place,
- blocks have selection handles and can be moved and resized,
- a floating toolbar changes text role, weight, alignment, and links,
- form controls are real: dropdowns open, inputs accept typing, tabs switch,
- several screens sit on one canvas with flows drawn between them.

Framit targets that bar, with one deliberate boundary: it is a UI description tool whose
output is editable, not a drawing tool. See [06-decisions.md](06-decisions.md), ADR-001.

## Goals

1. **Beautiful by default.** A one-line description should render into something a product
   person would happily paste into a doc. Typography, spacing, and hierarchy come from the
   theme, not from the calling model's pixel arithmetic.
2. **Consistent across sessions.** A theme is a real contract (a stylesheet plus a component
   catalogue plus a prose description) that any later session loads. Ten screens made over
   ten days look like one product.
3. **Editable and round-trippable.** Humans edit on the canvas. Models read the result. Neither
   side's changes are lost.
4. **Model-driven.** The calling LLM should be able to drive the server blind, discover the
   vocabulary, and see a screenshot of what it made so it can self-correct.
5. **Local and simple.** One process, stdio MCP, files on disk in the user's project, no
   accounts, no cloud.

## Non-goals

- Freeform vector drawing, rotation, boolean path operations, pen tools.
- Pixel-identical rendering across machines. The browser is the renderer; small font
  differences are acceptable.
- Figma import or export. Exports are HTML, PNG, and PDF.
- Multi-user realtime collaboration. Single user, local machine.
- Production code generation. Framit produces wireframes, not components for your app.
  (The HTML it emits is clean enough to be a starting point, but that is a side effect.)

## What "good" looks like

A session in Claude Code:

> "Create a dark theme for a fintech app, blue accent, generous spacing, mid-fidelity.
> Then wireframe the account overview screen for desktop and phone."

Framit creates `.framit/themes/fintech-dark.json`, two screen documents, renders them,
screenshots them, and returns the images. The model notices the balance card truncates on
phone, adjusts the document, re-renders, and reports the preview URL. The user opens it,
rewrites two labels and drags the chart below the transactions list. The next day a new
session runs `read_screen` and sees exactly those changes.
