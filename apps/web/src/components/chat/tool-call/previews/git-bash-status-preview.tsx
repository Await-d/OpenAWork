/**
 * `git_bash` 虚拟 MCP 的状态类工具预览（`which_bash` / `diagnose`）。
 *
 * 这两个工具返回的是「环境探测结果」，原先只能在 `McpResultPreview` 里读一段
 * JSON 文本。这里摊成「是否可用 + bash.exe 路径 + 探测来源 + 探测过的路径」。
 *
 * 注意 `run` 不在这里：它的输出（`{exitCode, cwd, output, timedOut}`）与内置 bash
 * 同形，归一化时直接映射到 `bash`，复用现成的终端预览。
 */

export interface GitBashStatusView {
  /** `diagnose` 才有。 */
  platform?: string;
  /** `diagnose` 才有：本机是否真的能通过 Git Bash 执行命令。 */
  enabled?: boolean;
  /** `diagnose` 才有：`ready` / `missing-git-bash` / `disabled: …`。 */
  status?: string;
  found: boolean;
  path: string | null;
  /** 探测来源：`env` / `program-files` / `path` / `not-found` / `not-required`。 */
  source: string;
  checkedPaths: string[];
}

/**
 * 识别状态类输出。`which_bash` 把结果放在顶层，`diagnose` 嵌在 `resolution` 里——
 * 两者统一按「有 `resolution` 就取它」处理。
 */
export function extractGitBashStatus(output: unknown): GitBashStatusView | null {
  const record = asRecord(output);
  if (!record) return null;

  const resolution = asRecord(record['resolution']) ?? record;
  const found = resolution['found'];
  const source = resolution['source'];
  if (typeof found !== 'boolean' || typeof source !== 'string') return null;

  const rawPath = resolution['path'];
  const checkedPaths = Array.isArray(resolution['checkedPaths'])
    ? resolution['checkedPaths'].filter((item): item is string => typeof item === 'string')
    : [];

  const platform = typeof record['platform'] === 'string' ? record['platform'] : undefined;
  const enabled = typeof record['enabled'] === 'boolean' ? record['enabled'] : undefined;
  const status = typeof record['status'] === 'string' ? record['status'] : undefined;

  return {
    found,
    path: typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : null,
    source,
    checkedPaths,
    ...(platform ? { platform } : {}),
    ...(enabled === undefined ? {} : { enabled }),
    ...(status ? { status } : {}),
  };
}

export function GitBashStatusPreview({ view }: { view: GitBashStatusView }) {
  return (
    <div className="git-bash-status">
      <div className="git-bash-status-head">
        <span className="git-bash-status-badge" data-ok={view.found ? 'true' : 'false'}>
          {view.found ? '✓ 已找到 Git Bash' : '✕ 未找到 Git Bash'}
        </span>
        {view.platform && <span className="git-bash-status-chip">{view.platform}</span>}
        {view.enabled === false && (
          <span className="git-bash-status-warn">当前环境无法执行 git_bash</span>
        )}
      </div>

      <dl className="git-bash-status-rows">
        {view.status && (
          <div className="git-bash-status-row">
            <dt>状态</dt>
            <dd>{view.status}</dd>
          </div>
        )}
        {view.path && (
          <div className="git-bash-status-row">
            <dt>bash.exe</dt>
            <dd data-mono="true" title={view.path}>
              {view.path}
            </dd>
          </div>
        )}
        <div className="git-bash-status-row">
          <dt>探测来源</dt>
          <dd>{view.source}</dd>
        </div>
      </dl>

      {view.checkedPaths.length > 0 && (
        <details className="git-bash-status-paths">
          <summary>探测路径（{view.checkedPaths.length}）</summary>
          <ul>
            {view.checkedPaths.map((candidate, index) => (
              <li key={`${candidate}-${index}`} title={candidate}>
                {candidate}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
