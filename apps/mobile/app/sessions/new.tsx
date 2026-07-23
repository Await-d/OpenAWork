import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/auth';
import { createSessionsClient } from '@openAwork/web-client';
import { upsertSession } from '../../src/db/session-store';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ui';

const TEMPLATES = [
  {
    id: 'blank',
    icon: 'document-outline' as const,
    title: '空白会话',
    desc: '从零开始自由对话',
    color: colors.accent,
  },
  {
    id: 'code',
    icon: 'code-slash-outline' as const,
    title: '编程协作',
    desc: '代码审查、Debug、架构讨论',
    color: colors.aux,
  },
  {
    id: 'image',
    icon: 'image-outline' as const,
    title: '图片创作',
    desc: 'AI 生成图片、编辑、变体',
    color: colors.contrast,
  },
  {
    id: 'research',
    icon: 'search-outline' as const,
    title: '研究分析',
    desc: '资料整理、数据分析、报告',
    color: colors.success,
  },
] as const;

/** S13: 新会话创建页 */
export default function NewSessionScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [title, setTitle] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!accessToken) {
      Alert.alert('错误', '请先登录');
      return;
    }
    setCreating(true);
    try {
      const session = await createSessionsClient(gatewayUrl).create(accessToken, {
        title: title.trim() || '新对话',
      });
      if (session.id) {
        await upsertSession({
          id: session.id,
          title: title.trim() || '新对话',
          messages_json: '[]',
          draft: '',
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        router.replace(`/chat/${session.id}`);
      }
    } catch {
      Alert.alert('创建失败', '请检查网络连接后重试');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ScreenHeader title="新会话" style={styles.headerInScroll} />

        <Text style={styles.title}>开始新对话</Text>
        <Text style={styles.subtitle}>选择一个模板快速开始，或直接创建空白会话。</Text>

        {/* Title input */}
        <Text style={styles.fieldLabel}>会话标题（可选）</Text>
        <TextInput
          style={styles.input}
          placeholder="给这次对话起个名字…"
          placeholderTextColor={colors.textSubtle}
          value={title}
          onChangeText={setTitle}
          autoCapitalize="none"
        />

        {/* Templates */}
        <Text style={styles.sectionTitle}>选择模板</Text>
        <View style={styles.templateGrid}>
          {TEMPLATES.map((t) => {
            const isActive = selectedTemplate === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.templateCard, isActive && styles.templateCardActive]}
                onPress={() => setSelectedTemplate(t.id)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.templateIconWrap,
                    { backgroundColor: isActive ? t.color + '1A' : colors.surface2 },
                  ]}
                >
                  <Ionicons name={t.icon} size={22} color={isActive ? t.color : colors.textMuted} />
                </View>
                <Text style={styles.templateTitle}>{t.title}</Text>
                <Text style={styles.templateDesc}>{t.desc}</Text>
                {isActive && (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={12} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Create button */}
        <TouchableOpacity
          style={[styles.createBtn, creating && { opacity: 0.5 }]}
          onPress={() => void handleCreate()}
          disabled={creating}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.white} />
          <Text style={styles.createBtnText}>{creating ? '创建中…' : '创建会话'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingBottom: 32 },
  headerInScroll: { paddingHorizontal: 4, marginBottom: 8 },

  title: {
    ...textPresets.title,
    color: colors.textStrong,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    marginBottom: 24,
    paddingHorizontal: 16,
  },

  fieldLabel: {
    ...textPresets.label,
    color: colors.textMuted,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  input: {
    marginHorizontal: 16,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    color: colors.textStrong,
    fontSize: 15,
    marginBottom: 24,
  },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    marginBottom: 12,
    paddingHorizontal: 16,
  },

  templateGrid: { gap: 10, marginBottom: 24, paddingHorizontal: 16 },
  templateCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    gap: 4,
  },
  templateCardActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentMuted,
  },
  templateIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  templateTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  templateDesc: { ...textPresets.cardDescription, color: colors.textMuted },
  checkBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  createBtn: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  createBtnText: { ...textPresets.body, color: colors.white, fontWeight: '700', fontSize: 15 },
});
