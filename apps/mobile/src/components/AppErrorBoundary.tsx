/**
 * 根级渲染错误边界（React Native）。
 *
 * 没有它时，渲染异常会一路冒泡到 expo-router 根：用户看到白屏/红屏，重启 App 才可能
 * 恢复，而这次崩溃**没有任何记录**——事后无法排查。
 *
 * 边界只捕获**渲染期**错误（构造函数、渲染、生命周期、子组件事件处理器抛错）；异步
 * 回调里的抛错不在 React 捕获范围内，那部分由 `monitoring/error-recorder` 的全局处理器
 * 负责。两者分工明确，不重复记录同一次崩溃。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { recordMobileError } from '../monitoring/error-recorder';
import { colors, fontFamily, fontWeight, radii, spacing, textPresets } from '../theme';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  retryKey: number;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 先记录再考虑 UI：记录器是最后一道防线，不能因为后续渲染出错而丢现场。
    try {
      recordMobileError(
        error,
        errorInfo.componentStack ? { componentStack: errorInfo.componentStack.slice(0, 2_000) } : undefined,
        'react-boundary',
      );
    } catch {
      // 记录失败不再抛出，否则会用第二个错误覆盖真正的崩溃现场。
    }
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private handleRetry = (): void => {
    this.setState((prev) => ({
      error: null,
      componentStack: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  override render(): ReactNode {
    const { error, componentStack, retryKey } = this.state;

    if (!error) {
      // retryKey 作为 key：重试时整棵子树重新挂载，避免复用已损坏的组件状态。
      return <View key={retryKey} style={styles.fill}>{this.props.children}</View>;
    }

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>界面渲染出错</Text>
          <Text style={styles.desc}>
            错误详情已记录。重试通常可以恢复当前页面；若反复失败，请把下方诊断信息反馈给维护者。
          </Text>

          <Pressable
            onPress={this.handleRetry}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="重试"
          >
            <Text style={styles.primaryButtonText}>重试</Text>
          </Pressable>

          <Text style={styles.detailsLabel}>错误详情</Text>
          <View style={styles.detailsBox}>
            <Text style={styles.mono}>{`${error.name}: ${error.message}`}</Text>
            {error.stack ? <Text style={styles.monoDim}>{error.stack}</Text> : null}
            {componentStack ? <Text style={styles.monoDim}>{componentStack}</Text> : null}
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bgBase },
  scroll: { padding: spacing[4], paddingTop: spacing[8], gap: spacing[3] },
  title: { ...textPresets.title, color: colors.textStrong },
  desc: { ...textPresets.body, color: colors.textMuted },
  primaryButton: {
    marginTop: spacing[1],
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 按压态：交互元素必须有明确反馈，否则用户无法确认点击是否生效。
  primaryButtonPressed: { opacity: 0.82 },
  primaryButtonText: {
    fontFamily: fontFamily.body,
    fontSize: textPresets.body.fontSize,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  detailsLabel: { ...textPresets.label, color: colors.textMuted, marginTop: spacing[1] },
  detailsBox: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineDefault,
    padding: spacing[3],
    gap: spacing[2],
  },
  mono: { ...textPresets.code, color: colors.textDefault },
  monoDim: { ...textPresets.code, color: colors.textMuted },
});