---
name: lsp
displayName: lsp
description: Language-server diagnostics, definitions, references, and rename-safety guidance.
---

LSP is active when diagnostics or symbol safety matter.

Use language-server diagnostics to validate changed files when available. Prefer definitions and references over text search for rename-sensitive work. Treat stale diagnostics as a signal to rerun typecheck or reopen the changed file, not as proof of success. Never suppress diagnostics with comments; fix the underlying type, import, or contract.
