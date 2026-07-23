import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated } from 'react-native';
import { SubagentDetailModal } from './SubagentDetailModal';
import type { SubagentDetail } from './SubagentDetailModal';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

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
  tool: colors.success,
  skill: colors.contrast,
  subagent: colors.aux,
};

const STATUS_ICON: Record<ActivityStatus, string> = {
  running: '⋯',
  done: '✓',
  error: '✗',
};

const STATUS_COLOR: Record<ActivityStatus, string> = {
  running: colors.warning,
  done: colors.success,
  error: colors.danger,
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
    backgroundColor: colors.warning,
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
        { borderRadius: 12, borderWidth: 1.5, borderColor },
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
          { backgroundColor: `${kindColor}1A`, borderColor: `${kindColor}52` },
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
          <Text style={[styles.activityDetail, { color: colors.textDefault }]} numberOfLines={6}>
            {activity.output}
          </Text>
        ) : null}
        {isSubagent ? <Text style={styles.subagentHint}>点击查看执行详情</Text> : null}
      </View>

      <View style={styles.rightCol}>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1A` }]}>
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
          <View style={styles.headerIconWrap}>
            <Text style={styles.headerIcon}>◈</Text>
          </View>
          <Text style={styles.headerTitle}>Agent 活动</Text>
          <View style={styles.headerCountWrap}>
            <Text style={styles.headerCount}>{activities.length}</Text>
          </View>
          <Text style={styles.headerAction}>展开</Text>
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
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.auxMuted,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.auxBorder,
    maxHeight: 200,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSubtle,
    gap: 9,
  },
  headerIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: { color: colors.aux, fontSize: 12, fontWeight: '700' },
  headerTitle: {
    ...textPresets.label,
    color: colors.textStrong,
    flex: 1,
    fontWeight: '700',
  },
  headerCountWrap: {
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.auxBorder,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  headerCount: {
    color: colors.aux,
    fontSize: 11,
    fontWeight: '700',
  },
  headerAction: {
    ...textPresets.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  list: { flex: 1 },
  rowRunning: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineSubtle,
    gap: 8,
    backgroundColor: colors.surface1,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
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
  activityName: { color: colors.textStrong, fontSize: 13, fontWeight: '600' },
  subagentHint: { color: colors.aux, fontSize: 11, marginTop: 2, fontWeight: '600' },
  activityDetail: {
    color: colors.textMuted,
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
  chevron: { color: colors.aux, fontSize: 18, fontWeight: '600', lineHeight: 20 },
});
