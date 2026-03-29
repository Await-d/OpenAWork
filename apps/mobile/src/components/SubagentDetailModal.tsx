import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import type { AgentActivity } from './AgentActivityPanel';

export interface SubagentMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  isError?: boolean;
}

export interface SubagentDetail extends AgentActivity {
  messages: SubagentMessage[];
  prompt?: string;
  model?: string;
  tokenCount?: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface SubagentIntervention {
  subagentId: string;
  message: string;
  action: 'inject' | 'interrupt' | 'redirect';
}

interface SubagentDetailModalProps {
  detail: SubagentDetail | null;
  onClose: () => void;
  onIntervene?: (intervention: SubagentIntervention) => Promise<void>;
}

const ROLE_COLOR: Record<SubagentMessage['role'], string> = {
  user: '#6366f1',
  assistant: '#10b981',
  tool: '#f59e0b',
};

const ROLE_LABEL: Record<SubagentMessage['role'], string> = {
  user: '输入',
  assistant: '输出',
  tool: '工具',
};

const ROLE_ICON: Record<SubagentMessage['role'], string> = {
  user: '→',
  assistant: '◈',
  tool: '⚙',
};

function SubagentMsgRow({ msg }: { msg: SubagentMessage }) {
  const color = ROLE_COLOR[msg.role];
  return (
    <View style={[msgStyles.row, msg.isError && msgStyles.rowError]}>
      <View
        style={[msgStyles.roleBadge, { backgroundColor: `${color}20`, borderColor: `${color}44` }]}
      >
        <Text style={[msgStyles.roleIcon, { color }]}>{ROLE_ICON[msg.role]}</Text>
        <Text style={[msgStyles.roleLabel, { color }]}>{msg.toolName ?? ROLE_LABEL[msg.role]}</Text>
      </View>
      <Text
        style={[
          msgStyles.content,
          msg.role === 'tool' && msgStyles.contentMono,
          msg.isError && msgStyles.contentError,
        ]}
        selectable
      >
        {msg.content}
      </Text>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={metaStyles.row}>
      <Text style={metaStyles.label}>{label}</Text>
      <Text style={metaStyles.value}>{value}</Text>
    </View>
  );
}

const INTERVENTION_ACTIONS: {
  key: SubagentIntervention['action'];
  label: string;
  color: string;
  icon: string;
  desc: string;
}[] = [
  {
    key: 'inject',
    label: '注入消息',
    color: '#6366f1',
    icon: '↓',
    desc: '向子代理注入一条用户消息，不中断执行',
  },
  {
    key: 'redirect',
    label: '重定向',
    color: '#f59e0b',
    icon: '⇄',
    desc: '修改子代理当前的执行目标',
  },
  {
    key: 'interrupt',
    label: '中断执行',
    color: '#ef4444',
    icon: '■',
    desc: '立即停止该子代理的运行',
  },
];

export function SubagentDetailModal({ detail, onClose, onIntervene }: SubagentDetailModalProps) {
  const [tab, setTab] = useState<'messages' | 'meta' | 'intervene'>('messages');
  const [selectedAction, setSelectedAction] = useState<SubagentIntervention['action']>('inject');
  const [interventionMsg, setInterventionMsg] = useState('');
  const [sending, setSending] = useState(false);

  if (!detail) return null;

  const duration =
    detail.startedAt && detail.finishedAt
      ? `${((detail.finishedAt - detail.startedAt) / 1000).toFixed(1)}s`
      : null;

  const statusColor =
    detail.status === 'done' ? '#34d399' : detail.status === 'error' ? '#f87171' : '#fbbf24';
  const statusLabel =
    detail.status === 'done' ? '已完成' : detail.status === 'error' ? '执行出错' : '执行中';

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.titleBar}>
          <View style={styles.titleLeft}>
            <Text style={styles.titleIcon}>◈</Text>
            <View>
              <Text style={styles.titleName}>{detail.name}</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                {duration ? <Text style={styles.durationText}> · {duration}</Text> : null}
              </View>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, tab === 'messages' && styles.tabActive]}
            onPress={() => setTab('messages')}
          >
            <Text style={[styles.tabText, tab === 'messages' && styles.tabTextActive]}>
              执行记录
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'meta' && styles.tabActive]}
            onPress={() => setTab('meta')}
          >
            <Text style={[styles.tabText, tab === 'meta' && styles.tabTextActive]}>详细信息</Text>
          </TouchableOpacity>
          {onIntervene ? (
            <TouchableOpacity
              style={[styles.tab, tab === 'intervene' && styles.tabActive]}
              onPress={() => setTab('intervene')}
            >
              <View style={styles.interveneTabLabel}>
                <Text style={[styles.tabText, tab === 'intervene' && styles.tabTextActive]}>
                  干预
                </Text>
                {detail.status === 'running' ? <View style={styles.interveneActiveDot} /> : null}
              </View>
            </TouchableOpacity>
          ) : null}
        </View>

        {tab === 'messages' ? (
          detail.messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>暂无执行记录</Text>
            </View>
          ) : (
            <FlatList
              data={detail.messages}
              keyExtractor={(m) => m.id}
              style={styles.msgList}
              contentContainerStyle={styles.msgListContent}
              renderItem={({ item }) => <SubagentMsgRow msg={item} />}
            />
          )
        ) : tab === 'intervene' ? (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={60}
          >
            <ScrollView
              style={styles.metaScroll}
              contentContainerStyle={[styles.metaContent, { gap: 14 }]}
            >
              <View style={ivStyles.section}>
                <Text style={ivStyles.sectionTitle}>选择干预方式</Text>
                {INTERVENTION_ACTIONS.map((action) => (
                  <TouchableOpacity
                    key={action.key}
                    style={[
                      ivStyles.actionCard,
                      selectedAction === action.key && {
                        borderColor: action.color,
                        backgroundColor: `${action.color}12`,
                      },
                    ]}
                    onPress={() => setSelectedAction(action.key)}
                  >
                    <View style={[ivStyles.actionIcon, { backgroundColor: `${action.color}20` }]}>
                      <Text style={[ivStyles.actionIconText, { color: action.color }]}>
                        {action.icon}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          ivStyles.actionLabel,
                          selectedAction === action.key && { color: action.color },
                        ]}
                      >
                        {action.label}
                      </Text>
                      <Text style={ivStyles.actionDesc}>{action.desc}</Text>
                    </View>
                    {selectedAction === action.key ? (
                      <Text style={[ivStyles.checkmark, { color: action.color }]}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
              {selectedAction !== 'interrupt' ? (
                <View style={ivStyles.section}>
                  <Text style={ivStyles.sectionTitle}>干预内容</Text>
                  <TextInput
                    style={ivStyles.input}
                    value={interventionMsg}
                    onChangeText={setInterventionMsg}
                    placeholder={
                      selectedAction === 'inject' ? '输入要注入的消息…' : '输入新的执行目标…'
                    }
                    placeholderTextColor="#475569"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              ) : (
                <View style={[ivStyles.section, { borderColor: '#ef444444' }]}>
                  <Text style={[ivStyles.sectionTitle, { color: '#ef4444' }]}>⚠ 中断确认</Text>
                  <Text style={ivStyles.warningText}>
                    中断执行将立即停止该子代理，已产生的输出不会被回滚。此操作不可撤销。
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[
                  ivStyles.submitBtn,
                  {
                    backgroundColor:
                      INTERVENTION_ACTIONS.find((a) => a.key === selectedAction)?.color ??
                      '#6366f1',
                  },
                  (sending || (selectedAction !== 'interrupt' && !interventionMsg.trim())) &&
                    ivStyles.submitBtnDisabled,
                ]}
                disabled={sending || (selectedAction !== 'interrupt' && !interventionMsg.trim())}
                onPress={() => {
                  if (!onIntervene) return;
                  setSending(true);
                  void onIntervene({
                    subagentId: detail.id,
                    message: interventionMsg.trim(),
                    action: selectedAction,
                  })
                    .then(() => {
                      setInterventionMsg('');
                      if (selectedAction === 'interrupt') onClose();
                    })
                    .catch(() => Alert.alert('干预失败', '请稍后重试'))
                    .finally(() => setSending(false));
                }}
              >
                <Text style={ivStyles.submitText}>
                  {sending
                    ? '发送中…'
                    : INTERVENTION_ACTIONS.find((a) => a.key === selectedAction)?.label}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <ScrollView style={styles.metaScroll} contentContainerStyle={styles.metaContent}>
            {detail.prompt ? (
              <View style={metaStyles.section}>
                <Text style={metaStyles.sectionTitle}>任务提示</Text>
                <Text style={metaStyles.prompt} selectable>
                  {detail.prompt}
                </Text>
              </View>
            ) : null}
            <View style={metaStyles.section}>
              <Text style={metaStyles.sectionTitle}>执行参数</Text>
              {detail.model ? <MetaRow label="模型" value={detail.model} /> : null}
              {detail.tokenCount != null ? (
                <MetaRow label="Token 用量" value={detail.tokenCount.toLocaleString()} />
              ) : null}
              {detail.startedAt ? (
                <MetaRow label="开始时间" value={new Date(detail.startedAt).toLocaleTimeString()} />
              ) : null}
              {duration ? <MetaRow label="耗时" value={duration} /> : null}
            </View>
            {(detail.input ?? detail.output) ? (
              <View style={metaStyles.section}>
                <Text style={metaStyles.sectionTitle}>输入 / 输出</Text>
                {detail.input ? (
                  <Text style={metaStyles.mono} selectable>
                    {detail.input}
                  </Text>
                ) : null}
                {detail.output ? (
                  <Text style={[metaStyles.mono, { color: '#e2e8f0', marginTop: 8 }]} selectable>
                    {detail.output}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const SURFACE = '#0f1f3d';
const CARD = '#1a2d4a';
const BORDER = '#1e3a5f';
const TEXT = '#e2e8f0';
const MUTED = '#64748b';
const ACCENT = '#3b82f6';

const ivStyles = StyleSheet.create({
  section: {
    backgroundColor: CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#0f172a',
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconText: { fontSize: 16, fontWeight: '700' },
  actionLabel: { color: TEXT, fontSize: 13, fontWeight: '600' },
  actionDesc: { color: MUTED, fontSize: 11, marginTop: 1, lineHeight: 15 },
  checkmark: { fontSize: 16, fontWeight: '700' },
  input: {
    backgroundColor: '#0f172a',
    color: TEXT,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    fontSize: 14,
    minHeight: 90,
    lineHeight: 20,
  },
  warningText: { color: '#fca5a5', fontSize: 13, lineHeight: 19 },
  submitBtn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: BORDER,
    maxHeight: '88%',
    paddingBottom: 28,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  titleLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  titleIcon: { color: ACCENT, fontSize: 22 },
  titleName: { color: TEXT, fontSize: 15, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },
  durationText: { color: MUTED, fontSize: 12 },
  closeBtn: { padding: 8 },
  closeBtnText: { color: MUTED, fontSize: 16 },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    gap: 4,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: { borderBottomColor: ACCENT },
  tabText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: ACCENT },
  interveneTabLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  interveneActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf24' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { color: MUTED, fontSize: 14 },
  msgList: { flex: 1 },
  msgListContent: { padding: 12, gap: 8 },
  metaScroll: { flex: 1 },
  metaContent: { padding: 16, gap: 12 },
});

const msgStyles = StyleSheet.create({
  row: {
    backgroundColor: CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    gap: 6,
  },
  rowError: { borderColor: '#f8717144' },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  roleIcon: { fontSize: 11 },
  roleLabel: { fontSize: 10, fontWeight: '700' },
  content: { color: MUTED, fontSize: 13, lineHeight: 19 },
  contentMono: { fontFamily: 'monospace', fontSize: 11 },
  contentError: { color: '#fca5a5' },
});

const metaStyles = StyleSheet.create({
  section: {
    backgroundColor: CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: MUTED, fontSize: 13 },
  value: { color: TEXT, fontSize: 13, fontWeight: '600' },
  prompt: { color: MUTED, fontSize: 13, lineHeight: 20 },
  mono: { color: MUTED, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
});
