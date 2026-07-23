import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  Linking,
} from 'react-native';
let ExpoSpeechRecognitionModule: {
  isRecognitionAvailable: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  start: (opts: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
} | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let useSpeechRecognitionEvent: (event: string, callback: (event: any) => void) => void = () => {
  /* noop */
};

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
} catch {
  // expo-speech-recognition native module not available (e.g. Expo Go)
}
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';

interface MobileVoiceRecorderProps {
  onTranscript: (text: string) => void;
  onClose: () => void;
}

const BAR_DEFS: { key: string; maxH: number }[] = [
  { key: 'b0', maxH: 3 },
  { key: 'b1', maxH: 6 },
  { key: 'b2', maxH: 10 },
  { key: 'b3', maxH: 7 },
  { key: 'b4', maxH: 4 },
  { key: 'b5', maxH: 8 },
  { key: 'b6', maxH: 5 },
  { key: 'b7', maxH: 9 },
  { key: 'b8', maxH: 6 },
  { key: 'b9', maxH: 4 },
];

function WaveBar({ recording, maxH, delay }: { recording: boolean; maxH: number; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 300 + delay, useNativeDriver: false }),
          Animated.timing(anim, { toValue: 0, duration: 300 + delay, useNativeDriver: false }),
        ]),
      ).start();
    } else {
      anim.stopAnimation();
      Animated.timing(anim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    }
    return () => {
      anim.stopAnimation();
    };
  }, [recording, anim, delay]);

  const height = anim.interpolate({ inputRange: [0, 1], outputRange: [4, maxH * 2] });

  return (
    <Animated.View
      style={[
        waveStyle.bar,
        { height, backgroundColor: recording ? colors.accent : colors.lineDefault },
      ]}
    />
  );
}

const waveStyle = StyleSheet.create({
  bar: { width: 4, borderRadius: 2 },
});

function resolveSpeechLocale(): string {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return locale?.replace('_', '-') || 'zh-CN';
}

export function MobileVoiceRecorder({ onTranscript, onClose }: MobileVoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalTranscriptRef = useRef('');
  const cancelledRef = useRef(false);

  const fmt = useCallback(
    (s: number) =>
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
    [],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useSpeechRecognitionEvent('start', () => {
    cancelledRef.current = false;
    setStarting(false);
    setRecording(true);
    setSeconds(0);
    clearTimer();
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  });

  useSpeechRecognitionEvent('end', () => {
    setStarting(false);
    setRecording(false);
    clearTimer();
    if (cancelledRef.current) {
      return;
    }
    const text = finalTranscriptRef.current.trim() || transcript.trim();
    if (!text) {
      setError('没有识别到有效语音，请重试');
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    const next = event.results[0]?.transcript?.trim() ?? '';
    setTranscript(next);
    if (event.isFinal && next) {
      finalTranscriptRef.current = next;
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setStarting(false);
    setRecording(false);
    clearTimer();
    if (event.error === 'aborted' && cancelledRef.current) {
      return;
    }
    setError(event.message || '语音识别失败');
  });

  const startRecording = useCallback(async () => {
    if (recording || starting) {
      return;
    }
    setStarting(true);
    setError(null);
    setPermissionBlocked(false);
    setTranscript('');
    finalTranscriptRef.current = '';
    cancelledRef.current = false;

    try {
      if (!ExpoSpeechRecognitionModule) {
        setError('语音识别不可用（需要 dev-client 构建）');
        return;
      }
      const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        setError('当前设备不可用语音识别服务');
        return;
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setPermissionBlocked(!permission.canAskAgain);
        setError(
          permission.canAskAgain
            ? '未授予麦克风或语音识别权限'
            : '语音识别权限已被永久拒绝，请前往系统设置开启',
        );
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: resolveSpeechLocale(),
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: Platform.OS === 'ios',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动语音识别失败');
      setStarting(false);
    }
  }, [recording, starting]);

  const stopRecording = useCallback(() => {
    ExpoSpeechRecognitionModule?.stop();
  }, []);

  const useTranscript = useCallback(() => {
    const text = (finalTranscriptRef.current.trim() || transcript.trim()).trim();
    if (!text) {
      setError('没有可用的识别文本');
      return;
    }
    onTranscript(text);
    onClose();
  }, [onClose, onTranscript, transcript]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    setStarting(false);
    setTranscript('');
    finalTranscriptRef.current = '';
    clearTimer();
    ExpoSpeechRecognitionModule?.abort();
    onClose();
  }, [clearTimer, onClose]);

  useEffect(() => {
    return () => {
      clearTimer();
      ExpoSpeechRecognitionModule?.abort();
    };
  }, [clearTimer]);

  return (
    <View style={styles.container}>
      <View style={styles.waveRow}>
        {BAR_DEFS.map((b, i) => (
          <WaveBar key={b.key} recording={recording || starting} maxH={b.maxH} delay={i * 60} />
        ))}
      </View>
      <Text style={styles.timer}>{fmt(seconds)}</Text>
      <Text style={styles.hint}>
        {starting
          ? '正在启动语音识别…'
          : recording
            ? '正在识别语音…'
            : transcript.trim()
              ? '识别完成，确认后将文本填入输入框'
              : '点击开始语音输入'}
      </Text>
      <View style={styles.transcriptBox}>
        <Text style={styles.transcriptText}>{transcript || '识别结果会实时显示在这里'}</Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {permissionBlocked ? (
        <TouchableOpacity style={styles.settingsBtn} onPress={() => void Linking.openSettings()}>
          <Text style={styles.settingsBtnText}>去系统设置开启权限</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.cancelBtn} onPress={cancelRecording}>
          <Text style={styles.cancelText}>取消</Text>
        </TouchableOpacity>
        {!recording && !starting && transcript.trim() ? (
          <TouchableOpacity style={styles.useBtn} onPress={useTranscript}>
            <Text style={styles.useBtnText}>使用文本</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.recordBtn, (recording || starting) && styles.recordBtnActive]}
          disabled={starting}
          onPress={recording ? stopRecording : () => void startRecording()}
        >
          <Text style={styles.recordBtnText}>{recording || starting ? '■' : '●'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
    padding: 16,
    alignItems: 'center',
    gap: 12,
  },
  waveRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30 },
  timer: { color: colors.textStrong, fontSize: 28, fontWeight: '200', letterSpacing: 2 },
  hint: { color: colors.textMuted, fontSize: 12 },
  transcriptBox: {
    width: '100%',
    minHeight: 72,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.bgBase,
    padding: 12,
  },
  transcriptText: {
    color: colors.textStrong,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 4 },
  cancelBtn: { padding: 10 },
  cancelText: { color: colors.textMuted, fontSize: 14 },
  settingsBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.warningMuted,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  settingsBtnText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  useBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.success,
  },
  useBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  recordBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { backgroundColor: colors.danger },
  recordBtnText: { color: colors.white, fontSize: 20, fontWeight: '700' },
});
