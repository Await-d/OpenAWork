# Post-Mortem: [Incident Title]

**Date:** YYYY-MM-DD  
**Severity:** P{0|1|2}  
**Duration:** X hours Y minutes  
**Author(s):** @name  
**Status:** Draft / Final

---

## Summary

_One paragraph: what happened, what was the user impact, how was it resolved._

---

## Timeline

| Time (UTC) | Event                                |
| ---------- | ------------------------------------ |
| HH:MM      | Incident started / first alert fired |
| HH:MM      | On-call engineer paged               |
| HH:MM      | Root cause identified                |
| HH:MM      | Mitigation applied                   |
| HH:MM      | Service fully restored               |
| HH:MM      | Incident closed                      |

---

## Impact

- **Users affected:** ~N users / X% of active users
- **Duration:** X hours Y minutes
- **Requests failed:** ~N (error rate: X%)
- **Revenue impact:** $X (if applicable)
- **Data loss:** None / Describe if any

---

## Root Cause

_Describe the root cause in detail. Use the 5-Whys technique if helpful._

**Why #1:** ...
**Why #2:** ...
**Why #3:** ...

---

## Contributing Factors

- Factor 1
- Factor 2

---

## Detection

_How was the incident detected? Was alerting sufficient?_

- Alert fired: Yes / No
- Time to detect: X minutes
- Could detection have been faster? If so, how?

---

## Metrics

| Metric              | Baseline (P50/P95) | During Incident | Post-Recovery |
| ------------------- | ------------------ | --------------- | ------------- |
| First token latency | Xms / Xms          | Xms / Xms       | Xms / Xms     |
| Error rate          | X%                 | X%              | X%            |
| Active connections  | X                  | X               | X             |
| Crash rate (mobile) | X%                 | X%              | X%            |

---

## Resolution

_Describe what was done to resolve the incident._

---

## Action Items

| Action                | Owner | Priority | Due Date   |
| --------------------- | ----- | -------- | ---------- |
| Add alert for X       | @name | P1       | YYYY-MM-DD |
| Improve runbook for Y | @name | P2       | YYYY-MM-DD |
| Fix root cause Z      | @name | P1       | YYYY-MM-DD |

---

## Lessons Learned

### What went well

-

### What could be improved

-

### Where we got lucky

- ***

## Cost Analysis

| Category                   | Value |
| -------------------------- | ----- |
| Infra cost during incident | $X    |
| Token cost (model API)     | $X    |
| Daily active users at time | N     |
| Cost per active user/day   | $X    |

---

_This document follows the blameless post-mortem culture. Focus on systems and processes, not individuals._
