import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface MobileCompanionStageProps {
  input: string;
  sessionId: string;
  streaming: boolean;
  pendingPermissionCount: number;
  attachedCount: number;
  todoCount: number;
  sessionBusyState: 'running' | 'paused' | null;
  currentUserEmail: string;
  showVoice: boolean;
  queuedCount: number;
  rightOpen: boolean;
  agentId?: string;
}

interface CompanionReaction {
  badge: string;
  importance: 'ambient' | 'notice' | 'active';
  text: string;
}

const COMPANION_NAMES = ['雾灯', '回声', '稜镜', '潮汐', '灰羽', '柏舟', '松针', '折光'];
const COMPANION_GLYPHS = ['✦', '◐', '◒', '✷', '◍', '◇', '◈', '✧'];
const COMPANION_ARCHETYPES = ['低打扰观察员', '节奏记录者', '上下文伴读者', '边栏巡航员'];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickBySeed<T>(values: readonly T[], seed: number, offset = 0): T {
  return values[(seed + offset) % values.length] ?? values[0]!;
}

function deriveReaction(props: MobileCompanionStageProps): CompanionReaction {
  if (props.streaming) {
    return { badge: '跟随生成', importance: 'active', text: '主助手正在生成，我贴着边观察。' };
  }
  if (props.pendingPermissionCount > 0) {
    return {
      badge: '待确认',
      importance: 'notice',
      text: `还有 ${props.pendingPermissionCount} 项待确认。`,
    };
  }
  if (props.input.includes('/buddy')) {
    return { badge: '被点名', importance: 'active', text: '你叫到我了——我在。' };
  }
  if (props.sessionBusyState === 'running') {
    return { badge: '运行中', importance: 'notice', text: '会话还在运行，我先待在边缘。' };
  }
  return { badge: '安静陪跑', importance: 'ambient', text: '当前没有高优先级动作。' };
}

const OUTPUT_HISTORY_LIMIT = 3;

export function MobileCompanionStage(props: MobileCompanionStageProps) {
  const { input, sessionId, currentUserEmail } = props;
  const profile = useMemo(() => {
    const seed = hashString((currentUserEmail || sessionId || 'guest').trim().toLowerCase());
    return {
      name: pickBySeed(COMPANION_NAMES, seed),
      glyph: pickBySeed(COMPANION_GLYPHS, seed, 5),
      archetype: pickBySeed(COMPANION_ARCHETYPES, seed, 3),
    };
  }, [currentUserEmail, sessionId]);

  const reaction = useMemo(() => deriveReaction(props), [props]);

  const [outputHistory, setOutputHistory] = useState<{ badge: string; text: string }[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const buddyMentionActiveRef = useRef(false);

  useEffect(() => {
    const mentionsBuddy = input.includes('/buddy');
    if (mentionsBuddy && !buddyMentionActiveRef.current) {
      setPanelOpen(true);
    }
    buddyMentionActiveRef.current = mentionsBuddy;
  }, [input]);

  useEffect(() => {
    if (reaction.text) {
      setOutputHistory((prev) =>
        [{ badge: reaction.badge, text: reaction.text }, ...prev].slice(0, OUTPUT_HISTORY_LIMIT),
      );
    }
  }, [reaction.badge, reaction.text]);

  if (!panelOpen) {
    return (
      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => setPanelOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.floatingButtonGlyph}>{profile.glyph}</Text>
      </TouchableOpacity>
    );
  }

  const latestOutput = outputHistory[0];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name}>{profile.name}</Text>
        <TouchableOpacity onPress={() => setPanelOpen(false)} hitSlop={12}>
          <Text style={styles.closeButton}>✕</Text>
        </TouchableOpacity>
      </View>

      {latestOutput && (
        <View style={styles.outputBubble}>
          <Text style={styles.outputBadge}>{latestOutput.badge}</Text>
          <Text style={styles.outputText}>{latestOutput.text}</Text>
        </View>
      )}

      <View style={styles.tagRow}>
        <View style={styles.tag}>
          <Text style={styles.tagText}>{profile.archetype}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(91, 140, 255, 0.16)',
    marginHorizontal: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  name: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.08,
    color: '#5b8cff',
  },
  closeButton: {
    fontSize: 14,
    color: '#94a3b8',
    padding: 4,
  },
  outputBubble: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(91, 140, 255, 0.08)',
    marginBottom: 6,
  },
  outputBadge: {
    fontSize: 9,
    fontWeight: '600',
    color: '#5b8cff',
    textTransform: 'uppercase',
    letterSpacing: 0.1,
    marginBottom: 2,
  },
  outputText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: 'rgba(91, 140, 255, 0.04)',
  },
  tagText: {
    fontSize: 9,
    color: '#64748b',
  },
  floatingButton: {
    position: 'absolute',
    right: 12,
    bottom: 80,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(91, 140, 255, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(91, 140, 255, 0.24)',
  },
  floatingButtonGlyph: {
    fontSize: 16,
    color: '#5b8cff',
  },
});
