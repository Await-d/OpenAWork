---
name: ast-grep
displayName: ast-grep
description: AST-aware search/rewrite guidance for structural code queries and deterministic codemods.
---

ast-grep is active for structural code search or codemods.

Use AST-shaped queries when the target is syntax rather than plain text: function calls, imports, JSX attributes, class members, empty catch blocks, missing awaits, or unsafe casts. Keep rewrites deterministic and scoped, then run formatter, typecheck, and targeted tests. Use plain text search for comments, filenames, string contents, and quick literal lookup.
