---
name: programming
displayName: programming
description: Strict TypeScript/Python/Rust/Go engineering guidance for surgical, tested, type-safe changes.
---

Programming is active for production code changes.

Prefer the smallest correct change that follows the existing module boundary. Read the relevant code first, reuse local helpers, and make illegal states unrepresentable with strict types. Do not use any, TypeScript suppressions, empty catch blocks, or broad rewrites. Add tests when behavior changes or a regression is subtle. After editing, run the narrowest meaningful test/typecheck commands and report exact failures instead of hiding them.
