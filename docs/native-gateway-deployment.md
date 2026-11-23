# Linux 本机网关部署

网关支持直接运行在 Linux，无需 Docker。以下脚本使用普通用户的 systemd 服务，不需要 sudo，也不会自动拉取或覆盖 Git 工作区。

## 环境准备

- Node.js 至少 22.13，Bun 与仓库 `.bun-version` 一致。
- Git、curl、flock、systemd 用户管理器；原生依赖缺少预编译产物时还需要 Python、make、g++。
- 浏览器实时预览使用 Playwright Chromium。首次安装会下载浏览器；缺少系统动态库时，需要管理员安装 Playwright 所需系统依赖。
- 请在已登录的普通用户会话执行脚本。systemd 用户管理器必须可达。

## 安装

在仓库根目录运行：

```bash
./scripts/native-gateway/install.sh
```

安装会依次完成锁文件依赖安装、workspace 包及网关构建、复制 `bash.txt` 资源、前端构建、Chromium 安装与真实启动验证、端口检查、用户服务安装及健康检查。端口被 Docker 等其他实例占用时会报错，避免把旧实例的健康响应误判为新部署成功。

默认配置位于 `~/.config/openawork-gateway/gateway.env`，权限为 `0600`。已有配置不会被覆盖。默认设置：

```dotenv
NODE_ENV=production
GATEWAY_HOST=0.0.0.0
GATEWAY_PORT=8000
JWT_SECRET=安装时生成的随机密钥
OPENAWORK_DATA_DIR=/home/你的用户名/.local/share/OpenAWork/native-gateway/data
OPENAWORK_BROWSER_LIVE=1
```

环境文件采用简单的 shell 赋值格式，值含空格时使用引号；systemd 也直接读取它，请勿写命令替换或 shell 逻辑。不要提交真实密钥。

可指定前端发布目录（绝对路径，可含空格）：

```dotenv
OPENAWORK_WEB_DIST=/绝对路径/web-dist
```

普通安装和更新始终执行 `bun run --filter @openAwork/web build`，从 `apps/web/dist` 发布全新的 HTML、资源及隐藏文件，旧目录中已废弃的文件不会混入新版本。不设置此变量时直接使用 `apps/web/dist`，并检查 `index.html`；显式设置为同一路径时也无需复制。目标不能是根目录、构建源的祖先、前端源码树内的其他目录或符号链接。外部目标的父目录需要写入及遍历权限；不存在的父目录会自动创建。

如果父进程设置了其他产品的浏览器目录，建议为本机网关显式设置独立目录：

```dotenv
PLAYWRIGHT_BROWSERS_PATH=/home/你的用户名/.local/share/OpenAWork/native-gateway/browsers
```

如果使用已安装的系统 Chromium，可设置 `OPENAWORK_BROWSER_PATH=/绝对路径/chromium`。开启实时预览只需 `OPENAWORK_BROWSER_LIVE=1`；`DESKTOP_AUTOMATION=1` 还会启用桌面自动化工具，不是实时预览的必要条件。

主流程已完成构建和浏览器安装时，可执行：

```bash
./scripts/native-gateway/install.sh --skip-build --skip-browser-install
```

跳过浏览器安装仍会真正启动 Chromium，避免只检查到可执行文件却漏掉系统依赖问题。

`--skip-build` 不重建或发布前端，只验证并使用当前已部署目录（外部目标需提前准备）。普通安装发布外部目录时也会保留旧前端备份。

## 服务管理

```bash
./scripts/native-gateway/gateway.sh status
./scripts/native-gateway/gateway.sh logs
./scripts/native-gateway/gateway.sh restart
./scripts/native-gateway/gateway.sh stop
./scripts/native-gateway/gateway.sh start
./scripts/native-gateway/gateway.sh health
```

服务名是 `openawork-gateway.service`，用户单元位于 `~/.config/systemd/user/`，日志进入 journal。安装会固定当前 Node 的真实可执行路径，并把 Node、Bun 和安装时 PATH 写入单元，避免 fnm 登录环境与后台服务环境不同。

安装会尝试免交互开启当前用户的 linger。检查方式：

```bash
loginctl show-user "$USER" -p Linger
```

`Linger=yes` 时，用户服务可以在开机后及退出登录后继续运行。若系统策略拒绝自动开启，脚本只提示；需管理员执行 `loginctl enable-linger 用户名`。不要向脚本输入 sudo 密码。

## 更新

先自行切换到希望部署的源码版本，再执行：

```bash
./scripts/native-gateway/update.sh
```

更新先构建、在外部目标同级暂存完整前端并校验入口、检查浏览器，准备成功后才停止服务。停服后会保存数据库及可能存在的 WAL/SHM、环境配置，备份目录为 `~/.local/state/OpenAWork/native-backups/update-时间-随机后缀/`。备份目录权限 `0700`，文件继承原配置的密钥保护权限。备份先写入同目录的 `.partial-*` 暂存名，全部复制成功后才改名为正式目录；中断留下的半成品会在下次运行或退出钩子里回收，不会被当成有效备份。

冷备份成功后才发布外部前端，随后启动服务。旧前端通过目录重命名保留在目标父目录的 `.openawork-web-随机后缀.previous`，只保留最新一份，更早的在发布成功后删除；中断残留的 `.openawork-web-*` 暂存目录也在同一时机清理。替换失败时恢复原前端；发布前失败会清理暂存目录。若文件系统同时拒绝恢复，日志会给出保留备份路径供人工恢复。数据库及后端产物不会自动回滚；发布成功后的启动失败也不会自动回退前端。

备份是有限保留而非全量归档：`update-*` 与 `docker-migration-*` 各保留最新 `NATIVE_GATEWAY_BACKUP_KEEP` 份（默认 1，即只留最近一次更新前的快照），更早的会在**创建本次备份之前**与**更新结束后**各清理一次，失败退出时同样清理，因此反复失败也不会累积。保留策略清完仍放不下本次快照时，会继续按最旧优先删除历史备份；删光仍不足则直接放弃本次更新，不写半截备份。更新不修改 Docker 数据。附件继续保留在 `OPENAWORK_DATA_DIR` 中；更新备份不是附件的完整灾备副本，长期备份时应另行保存整个数据目录及文档目录。

原服务运行时，更新后会重新启动并检查 `/health`；原服务停止时保持停止。停服后的备份或启动失败，会尝试恢复服务。脚本不会自动回滚数据库或构建产物，失败时应查看 journal 和备份，再决定恢复操作。

更换 Node 版本、移动仓库或需要刷新单元中的 PATH 时，重新执行安装脚本。已有环境配置保持不变。

## Docker 数据迁移

不要让 Docker 与本机实例同时使用同一份数据库。先停止源容器并防止它自动重启，再对停服数据做独立备份，复制到新的本机目录。迁移不仅包括 `openAwork.db`，还包括附件、文件备份、文档及需要保留的平台缓存。

沿用原 `JWT_SECRET` 可保留现有登录令牌语义，账号和模型配置随数据库迁入。容器路径必须按实际卷映射迁移，例如：

| 容器路径             | 本机路径示例                  |
| -------------------- | ----------------------------- |
| `/home/project`      | `/home/await/project`         |
| `/var/lib/openawork` | 本机新的 `OPENAWORK_DATA_DIR` |
| `/root/Documents`    | 本机新的文档目录              |
| `/workspaces`        | 原宿主机工作区目录            |

迁移工具 `scripts/native-gateway/migration.mjs` 由部署流程提供；先执行 `node scripts/native-gateway/migration.mjs --help` 查看参数。应只修改迁移副本中的路径元数据，不应把历史对话正文中的旧路径全局替换。

切换前核对 SQLite 完整性、会话与消息计数、附件可读性。新实例先在独立端口验证，最终使用原端口时再启动正式服务。保留源数据和独立备份用于人工恢复；不要直接再次启动旧容器与新实例争用端口或后台任务。

## 可配置项

| 环境变量                      | 默认值或用途                              |
| ----------------------------- | ----------------------------------------- |
| `NATIVE_GATEWAY_CONFIG_DIR`   | `~/.config/openawork-gateway`             |
| `NATIVE_GATEWAY_ENV_FILE`     | 上述目录中的 `gateway.env`                |
| `NATIVE_GATEWAY_SERVICE_NAME` | `openawork-gateway.service`               |
| `NATIVE_GATEWAY_BACKUP_DIR`   | `~/.local/state/OpenAWork/native-backups` |
| `NATIVE_GATEWAY_BACKUP_KEEP`  | 每类备份保留份数，默认 1，超出即清理      |

这些变量是部署脚本入口配置，建议从命令前缀或 shell 导出；网关环境变量则放入 `gateway.env`。`--skip-build` 与 `--skip-browser-install` 同样适用于更新脚本。

## 当前主机的部署记录（2026-11-14）

当前主机已经从 Docker 切换到用户 `await` 的本机服务，仍使用端口 **8000**，原账号、模型配置和对话继续使用。服务已设为 enabled，且 `Linger=yes`，退出登录后可继续运行。网关使用 Node 22.23.5，实时浏览器使用 Chromium 145.0.7632.6。

| 项目     | 当前路径或状态                                                         |
| -------- | ---------------------------------------------------------------------- |
| 源码     | `/home/await/project/OpenAWork`                                        |
| 配置     | `/home/await/.config/openawork-gateway/gateway.env`（0600）            |
| 数据     | `/home/await/.local/share/OpenAWork/native-gateway/data`               |
| 文档     | `/home/await/.local/share/OpenAWork/native-gateway/documents`          |
| 平台数据 | `/home/await/.local/share/OpenAWork/native-gateway/xdg-data/OpenAWork` |
| 浏览器   | `/home/await/.local/share/OpenAWork/native-gateway/browsers`           |
| 前端产物 | `/home/await/project/OpenAWork/deploy/web-dist`                        |
| 原容器   | `openawork-gateway-gateway-1`，已停止，restart policy 为 `no`          |

`OPENAWORK_BROWSER_LIVE=1` 已写入环境文件并生效。已通过认证接口检查、真实浏览器启动、WebSocket 握手、PNG 截图和实时画面帧验收；不需要为此开启 `DESKTOP_AUTOMATION`。

成功切换时的完整冷备份：

```text
/home/await/.local/state/OpenAWork/native-backups/docker-migration-20261114-161933-qpEq50
```

该目录保留源数据库、文件数据、文档、平台数据、配置和迁移报告，配置含密钥，请按私有备份保存。迁移前后 SQLite 完整性检查正常，3 个账号、29 个会话、6297 条消息、202 个 SQLite 产物和 2122 个文件备份数量一致；消息、账号凭据、模型配置和 SQLite 产物内容比对一致。文件备份的本机路径均存在。

容器中的 `/home/project` 已对应到宿主机 `/home/await/project`。本机进程直接访问该目录，无需挂载。旧消息正文中的容器路径保留原文，只迁移结构化路径字段。源容器中一条历史终端输出文件已经丢失，无法通过迁移恢复；MCP 的命令及参数中的旧绝对路径需按本机工具位置单独核对。

更新流程也已实际执行并通过健康检查，其数据库和配置备份曾位于（该备份已在 2026-11-15 的磁盘清理中按保留策略删除，路径仅作记录）：

```text
/home/await/.local/state/OpenAWork/native-backups/update-20261114-162420-a5rEsL
```

后续在仓库根目录执行 `./scripts/native-gateway/update.sh` 即可部署当前源码。仅修改环境文件后，执行 `./scripts/native-gateway/gateway.sh restart`。不要同时启动旧容器；切回 Docker 前应先停本机服务，并评估切换后产生的新数据。
