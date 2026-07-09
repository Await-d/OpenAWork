---
name: review-work
displayName: review-work
description: Post-implementation review: verify goal fit, code quality, security, tests, and observable behavior before claiming done.
---

Review Work is used after a meaningful implementation change.

Review the actual diff and the user goal before approving. Check requested behavior, type boundaries, error handling, security-sensitive inputs, persistence side effects, test coverage, and whether the feature was exercised through its real surface. Findings come first, ordered by severity with file and line references. If no issue is found, say that clearly and name remaining risk or test gaps. Do not invent verification; report only commands, screenshots, or runtime behavior that actually happened in OpenAWork.
