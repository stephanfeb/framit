# Examples

## M1 acceptance: blind session

A fresh Claude Code session (Sonnet) with no access to this repo, only the Framit MCP tools, was given:

> wireframe a settings page for a SaaS app, desktop and phone

It called `get_project`, `describe_dsl`, `list_themes`, `init_project`, `get_theme` and one `write_screen`
(no validation errors, no retries). Eight turns.

| Desktop | Phone |
|---|---|
| ![desktop](m1-settings-desktop.png) | ![phone](m1-settings-phone.png) |

The stored document is [m1-settings.json](m1-settings.json).

## Same structure, dark starter theme

A hand-written settings screen rendered in `wire-mid-dark`:

![dark](m1-settings-dark-desktop.png)
