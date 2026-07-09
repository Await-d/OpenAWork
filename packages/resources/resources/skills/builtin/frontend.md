---
name: frontend
displayName: frontend
description: OpenAWork frontend design and implementation guidance for responsive, token-driven UI work.
---

Frontend is active for Web UI work.

Use the existing OpenAWork design tokens and components before adding new styling. Build the real workflow surface, not a marketing placeholder. Include loading, empty, error, hover, active, and focus states. Keep layouts responsive down to 375px, avoid hardcoded colors, and avoid nested card-heavy compositions. All gateway access from apps/packages must go through @openAwork/web-client unless the target is an external third-party API.
