import { describe, expect, it } from 'vitest';
import {
  collectSpeechRecognitionText,
  resolveSpeechRecognitionConstructor,
  resolveSpeechRecognitionErrorMessage,
} from './VoiceRecorder.js';

class MockSpeechRecognition extends EventTarget {
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onend = null;
  onerror = null;
  onresult = null;
  onstart = null;

  abort() {}

  start() {}

  stop() {}
}

describe('VoiceRecorder speech helpers', () => {
  it('prefers the standard SpeechRecognition constructor', () => {
    const StandardConstructor = MockSpeechRecognition;
    const WebkitConstructor = class extends MockSpeechRecognition {};

    expect(
      resolveSpeechRecognitionConstructor({
        SpeechRecognition: StandardConstructor,
        webkitSpeechRecognition: WebkitConstructor,
      }),
    ).toBe(StandardConstructor);
  });

  it('falls back to webkitSpeechRecognition when needed', () => {
    const WebkitConstructor = class extends MockSpeechRecognition {};

    expect(
      resolveSpeechRecognitionConstructor({
        webkitSpeechRecognition: WebkitConstructor,
      }),
    ).toBe(WebkitConstructor);
  });

  it('builds preview text from final and interim recognition chunks', () => {
    expect(
      collectSpeechRecognitionText([
        { isFinal: true, transcript: '你好' },
        { isFinal: false, transcript: 'OpenAWork' },
        { isFinal: true, transcript: '请记录这段语音' },
      ]),
    ).toEqual({
      finalTranscript: '你好 请记录这段语音',
      previewTranscript: '你好 请记录这段语音 OpenAWork',
    });
  });

  it('maps browser recognition errors to user-facing messages', () => {
    expect(resolveSpeechRecognitionErrorMessage('service-not-allowed')).toBe(
      '麦克风或语音识别权限被拒绝',
    );
    expect(resolveSpeechRecognitionErrorMessage('audio-capture')).toBe('未找到可用的麦克风设备');
    expect(resolveSpeechRecognitionErrorMessage('aborted')).toBeNull();
  });
});
