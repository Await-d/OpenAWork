import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated } from 'react-native';
import { SubagentDetailModal } from './SubagentDetailModal';
import type { SubagentDetail } from './SubagentDetailModal';

export type ActivityKind = 'tool' | 'skill' | 'subagent';
export type ActivityStatus = 'running' | 'done' | 'error';

export interface AgentActivity {
  id: string;
  kind: ActivityKind;
  name: string;
  status: ActivityStatus;
  input?: string;
  output?: string;
  subagentDetail?: Omit<SubagentDetail, 'id' | 'kind' | 'name' | 'status' | 'input' | 'output'>;
}

interface AgentActivityPanelProps {
  activities: AgentActivity[];
}

const KIND_ICON: Record<ActivityKind, string> = {
  tool: '⚙',
  skill: '✦',
  subagent: '◈',
};

const KIND_LABEL: Record<ActivityKind, string> = {
  tool: '工具',
  skill: 'Skill',
  subagent: '子代理',
};

const KIND_COLOR: Record<ActivityKind, string> = {
  tool: '#10b981',
  skill: '#8b5cf6',
  subagent: '#3b82f6',
};

const STATUS_ICON: Record<ActivityStatus, string> = {
  running: '⋯',
  done: '✓',
  error: '✗',
};

const STATUS_COLOR: Record<ActivityStatus, string> = {
  running: '#fbbf24',
  done: '#34d399',
  error: '#f87171',
};

function RunningDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 350, useNativeDriver: true }),
          Animated.delay(700 - delay),
        ]),
      ).start();
    animate(dot1, 0);
    animate(dot2, 200);
    animate(dot3, 400);
    return () => {
      dot1.stopAnimation();
      dot2.stopAnimation();
      dot3.stopAnimation();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {(
        [
          ['d1', dot1],
          ['d2', dot2],
          ['d3', dot3],
        ] as [string, Animated.Value][]
      ).map(([key, dot]) => (
        <Animated.View
          key={key}
          style={[
            dotStyle.dot,
            {
              opacity: dot,
              transform: [
                { scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const dotStyle = StyleSheet.create({
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#fbbf24',
  },
});

function PulsingBorder({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    ).start();
    return () => anim.stopAnimation();
  }, [anim]);

  const borderColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [`${color}30`, `${color}cc`],
  });

  return (
    <Animated.View
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
        { borderRadius: 10, borderWidth: 1.5, borderColor },
      ]}
      pointerEvents="none"
    />
  );
}

function ActivityRow({
  activity,
  onOpenSubagent,
}: {
  activity: AgentActivity;
  onOpenSubagent: (a: AgentActivity) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const kindColor = KIND_COLOR[activity.kind];
  const statusColor = STATUS_COLOR[activity.status];
  const isSubagent = activity.kind === 'subagent';
  const isRunning = activity.status === 'running';

  const handlePress = () => {
    if (isSubagent) {
      onOpenSubagent(activity);
    } else {
      setExpanded((v) => !v);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.row, isRunning && isSubagent && styles.rowRunning]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {isRunning && isSubagent ? <PulsingBorder color={kindColor} /> : null}
      <View
        style={[
          styles.kindBadge,
          { backgroundColor: `${kindColor}20`, borderColor: `${kindColor}40` },
          isRunning && { borderColor: kindColor },
        ]}
      >
        <Text style={[styles.kindIcon, { color: kindColor }]}>{KIND_ICON[activity.kind]}</Text>
        <Text style={[styles.kindLabel, { color: kindColor }]}>{KIND_LABEL[activity.kind]}</Text>
      </View>

      <View style={styles.rowContent}>
        <Text style={styles.activityName} numberOfLines={expanded ? undefined : 1}>
          {activity.name}
        </Text>
        {!isSubagent && expanded && activity.input ? (
          <Text style={styles.activityDetail} numberOfLines={6}>
            {activity.input}
          </Text>
        ) : null}
        {!isSubagent && expanded && activity.output ? (
          <Text style={[styles.activityDetail, { color: '#e2e8f0' }]} numberOfLines={6}>
            {activity.output}
          </Text>
        ) : null}
        {isSubagent ? <Text style={styles.subagentHint}>点击查看执行详情</Text> : null}
      </View>

      <View style={styles.rightCol}>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
          {isRunning ? (
            <RunningDots />
          ) : (
            <Text style={[styles.statusIcon, { color: statusColor }]}>
              {STATUS_ICON[activity.status]}
            </Text>
          )}
        </View>
        {isSubagent ? <Text style={styles.chevron}>›</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export function AgentActivityPanel({ activities }: AgentActivityPanelProps) {
  const [activeSubagent, setActiveSubagent] = useState<AgentActivity | null>(null);

  if (activities.length === 0) return null;

  const detailForModal =
    activeSubagent !== null
      ? ({
          ...activeSubagent,
          messages: activeSubagent.subagentDetail?.messages ?? [],
          prompt: activeSubagent.subagentDetail?.prompt,
          model: activeSubagent.subagentDetail?.model,
          tokenCount: activeSubagent.subagentDetail?.tokenCount,
          startedAt: activeSubagent.subagentDetail?.startedAt,
          finishedAt: activeSubagent.subagentDetail?.finishedAt,
        } as SubagentDetail)
      : null;

  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerIcon}>◈</Text>
          <Text style={styles.headerTitle}>Agent 活动</Text>
          <Text style={styles.headerCount}>{activities.length}</Text>
        </View>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {activities.map((a) => (
            <ActivityRow key={a.id} activity={a} onOpenSubagent={setActiveSubagent} />
          ))}
        </ScrollView>
      </View>

      <SubagentDetailModal detail={detailForModal} onClose={() => setActiveSubagent(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f1f3d',
    borderTopWidth: 1,
    borderTopColor: '#1e3a5f',
    maxHeight: 200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    gap: 6,
  },
  headerIcon: { color: '#3b82f6', fontSize: 13 },
  headerTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '600', flex: 1 },
  headerCount: {
    color: '#3b82f6',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  list: { flex: 1 },
  rowRunning: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#0f2040',
    gap: 8,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 3,
    minWidth: 64,
    justifyContent: 'center',
  },
  kindIcon: { fontSize: 11 },
  kindLabel: { fontSize: 10, fontWeight: '700' },
  rowContent: { flex: 1, minWidth: 0 },
  activityName: { color: '#e2e8f0', fontSize: 13, fontWeight: '500' },
  subagentHint: { color: '#3b82f6', fontSize: 11, marginTop: 2 },
  activityDetail: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
    lineHeight: 16,
  },
  rightCol: { alignItems: 'center', gap: 2 },
  statusBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIcon: { fontSize: 13, fontWeight: '700' },
  chevron: { color: '#3b82f6', fontSize: 18, fontWeight: '600', lineHeight: 20 },
});
