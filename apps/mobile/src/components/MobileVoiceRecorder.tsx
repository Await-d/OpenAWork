import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';

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
      style={[waveStyle.bar, { height, backgroundColor: recording ? '#6366f1' : '#334155' }]}
    />
  );
}

const waveStyle = StyleSheet.create({
  bar: { width: 4, borderRadius: 2 },
});

export function MobileVoiceRecorder({ onTranscript, onClose }: MobileVoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fmt = useCallback(
    (s: number) =>
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
    [],
  );

  const startRecording = useCallback(() => {
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onTranscript('[语音输入]');
  }, [onTranscript]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.waveRow}>
        {BAR_DEFS.map((b, i) => (
          <WaveBar key={b.key} recording={recording} maxH={b.maxH} delay={i * 60} />
        ))}
      </View>
      <Text style={styles.timer}>{fmt(seconds)}</Text>
      <Text style={styles.hint}>{recording ? '点击停止并使用语音' : '点击开始录音'}</Text>
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>取消</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.recordBtn, recording && styles.recordBtnActive]}
          onPress={recording ? stopRecording : startRecording}
        >
          <Text style={styles.recordBtnText}>{recording ? '■' : '●'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    padding: 16,
    alignItems: 'center',
    gap: 12,
  },
  waveRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30 },
  timer: { color: '#f8fafc', fontSize: 28, fontWeight: '200', letterSpacing: 2 },
  hint: { color: '#64748b', fontSize: 12 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 4 },
  cancelBtn: { padding: 10 },
  cancelText: { color: '#94a3b8', fontSize: 14 },
  recordBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { backgroundColor: '#ef4444' },
  recordBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
