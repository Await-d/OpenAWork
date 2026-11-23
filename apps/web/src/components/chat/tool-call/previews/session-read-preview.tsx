import type {
  SessionReadEntry,
  SessionReadLine,
  SessionReadView,
} from '../shared/session-read-view.js';

/**
 * `session_read` 的紧凑日志视图。
 *
 * 40 条转录如果按卡片排版，视口会被迅速撑满；这里每条消息压成一行
 * （时间 + 角色 + 内容），工具调用降级成等宽小字——「快速定位某句话在哪儿」
 * 才是读转录的主要诉求。
 */
export function SessionReadPreview({ view }: { view: SessionReadView }) {
  return (
    <div className="session-read">
      {view.source && (
        <div className="session-read-source">
          <span className="session-read-source-tag">来源</span>
          {formatTranscriptSource(view.source)}
        </div>
      )}
      {view.hint && <div className="session-read-hint">{view.hint}</div>}
      <div className="session-read-log">
        {view.entries.map((entry, entryIndex) => (
          <SessionReadRows entry={entry} key={`${entry.index}-${entry.role}-${entryIndex}`} />
        ))}
      </div>
    </div>
  );
}

function SessionReadRows({ entry }: { entry: SessionReadEntry }) {
  const time = formatClockTime(entry.timestamp);
  const role = roleLabel(entry.role);
  const notice = entry.notice ? formatNotice(entry.notice) : '';

  return (
    <>
      {entry.lines.map((line, index) => (
        <div className="session-read-row" key={`${entry.index}-${index}`}>
          {/* 时间与角色只挂在消息的首行，后续行留空对齐 */}
          <span className="session-read-time">{index === 0 ? time : ''}</span>
          <span className="session-read-role" data-role={entry.role}>
            {index === 0 ? role : ''}
          </span>
          <span className="session-read-text">
            {/* 合成通知的来源标签（子代理 scout / 定时任务 周报汇总） */}
            {index === 0 && notice && <span className="session-read-origin">{notice}</span>}
            {renderLine(line)}
          </span>
        </div>
      ))}
    </>
  );
}

function renderLine(line: SessionReadLine) {
  if (line.kind === 'tool_call') {
    return (
      <code className="session-read-tool" data-kind="call">
        {line.toolName}
        {line.text.length > 0 ? ` ${line.text}` : ''}
      </code>
    );
  }
  if (line.kind === 'tool_result') {
    return (
      <code className="session-read-tool" data-kind="result">
        {line.text}
      </code>
    );
  }
  return <>{line.text}</>;
}

/**
 * 角色 → 中文标签。
 *
 * 前五个取值来自 `MessageRole`（`packages/shared/src/message-schema.ts`）
 * ——`'user' | 'assistant' | 'tool' | 'system' | 'synthetic'`，是闭集合，全部要译。
 * `'unknown'` 是解析器在 `[Message i/N]` 头缺角色时写的哨兵值，同样要译，
 * 否则界面上会直接冒出英文的 `unknown`。
 */
function roleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === 'user') return '用户';
  if (normalized === 'assistant') return '助手';
  if (normalized === 'tool') return '工具';
  if (normalized === 'system') return '系统';
  if (normalized === 'synthetic') return '通知';
  if (normalized === 'unknown') return '未知';
  return role;
}

/** 转录来源判别词（网关 `buildChannelSourceLine` 只产出 `channel`）。 */
const SOURCE_KINDS: Record<string, string> = { channel: '通道' };
/** 通道类型 → 中文。未登记的保留原值（与 `roleLabel` 同一约定）。 */
const CHANNEL_TYPES: Record<string, string> = {
  dingtalk: '钉钉',
  discord: 'Discord',
  feishu: '飞书',
  qq: 'QQ',
  slack: 'Slack',
  telegram: 'Telegram',
  wechat: '微信',
  wecom: '企业微信',
  weixin: '微信',
  whatsapp: 'WhatsApp',
};

/**
 * 转录来源行 → 可读文案。网关原样给出 `channel · wechat · wxid_abc`：
 * 第一段是来源判别词、第二段是通道类型，第三段起是通道会话 id（属数据，原样保留）。
 */
function formatTranscriptSource(value: string): string {
  const [kind, type, ...rest] = value.split(' · ');
  return [
    kind ? (SOURCE_KINDS[kind] ?? kind) : '',
    type ? (CHANNEL_TYPES[type] ?? type) : '',
    ...rest,
  ]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/** 通知来源判别词 → 中文（`SyntheticNoticeSource` 是闭集合：subagent / cron）。 */
const NOTICE_SOURCES: Record<string, string> = { cron: '定时任务', subagent: '子代理' };
/** 通知状态 → 中文（`SubagentNoticeState`）；`done` 网关不输出，留作防御。 */
const NOTICE_STATES: Record<string, string> = {
  cancelled: '已取消',
  done: '已完成',
  failed: '失败',
};

/**
 * 合成通知限定词 → 中文。网关形如 `subagent · scout · failed`：首段是来源判别词
 * （闭集合），中间是来源名（子代理名 / 定时任务名，属数据），末段可能是状态。
 * 首段按位置译、其余按取值查表——来源名恰好叫 `failed` 的概率忽略不计。
 */
function formatNotice(value: string): string {
  return value
    .split(' · ')
    .map((part, index) =>
      index === 0 ? (NOTICE_SOURCES[part] ?? part) : (NOTICE_STATES[part] ?? part),
    )
    .join(' · ');
}

/** ISO 时间 → `HH:mm:ss`；解析不出来就留空，不要显示 Invalid Date。 */
function formatClockTime(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
