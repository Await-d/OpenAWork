# Chat Opencode Integration Capability Matrix

| Capability                                  | Web       | Desktop                        | Mobile  |
| ------------------------------------------- | --------- | ------------------------------ | ------- |
| Server-backed slash command list            | Supported | Supported via shared web pages | Pending |
| Global command palette                      | Supported | Supported via shared web pages | Pending |
| Permission prompt and reply                 | Supported | Supported via shared web pages | Pending |
| `/压缩会话` command execution               | Supported | Supported via shared web pages | Pending |
| Compaction status card                      | Supported | Supported via shared web pages | Pending |
| Child-session badge and overview visibility | Supported | Supported via shared web pages | Pending |
| MCP visibility in chat/settings             | Supported | Supported via shared web pages | Pending |

## Notes

- Desktop currently inherits the Web implementation because `apps/desktop` directly reuses `apps/web` chat pages.
- Mobile requires a dedicated follow-up because it uses a separate navigation/state model and has not yet consumed the new web-client command/permission/session helpers.
