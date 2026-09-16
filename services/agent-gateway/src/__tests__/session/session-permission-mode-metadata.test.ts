/**
 * 会话权限阶梯（permissionMode / yoloMode）在 session metadata 写路径上的规范化回归。
 *
 * - `permissionMode` 是规范键；布尔 `yoloMode` 是它的派生投影（向后兼容）。
 * - 两者都缺席时必须保持缺席，不得凭空写入 `ask`。
 */
import { describe, expect, it } from 'vitest';
import {
  mergeSessionMetadataForUpdate,
  normalizePersistedSessionMetadata,
  validateSessionMetadataPatch,
} from '../../session/session-workspace-metadata.js';

describe('会话权限档位 metadata', () => {
  describe('PATCH 校验（strict schema）', () => {
    it('接受新档位 permissionMode: auto-edit', () => {
      const result = validateSessionMetadataPatch({ permissionMode: 'auto-edit' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['permissionMode']).toBe('auto-edit');
      }
    });

    it('继续接受旧字段 yoloMode: true', () => {
      const result = validateSessionMetadataPatch({ yoloMode: true });
      expect(result.success).toBe(true);
    });

    it('拒绝非法 permissionMode', () => {
      const result = validateSessionMetadataPatch({ permissionMode: 'bogus' });
      expect(result.success).toBe(false);
    });
  });

  describe('mergeSessionMetadataForUpdate 规范化', () => {
    it('写入旧布尔 {yoloMode:true} 时补齐 permissionMode: yolo', () => {
      const { metadata } = mergeSessionMetadataForUpdate({}, { yoloMode: true });
      expect(metadata['permissionMode']).toBe('yolo');
      expect(metadata['yoloMode']).toBe(true);
    });

    it('写入 {permissionMode:auto-edit} 时把 yoloMode 投影为 false', () => {
      const { metadata } = mergeSessionMetadataForUpdate({}, { permissionMode: 'auto-edit' });
      expect(metadata['permissionMode']).toBe('auto-edit');
      expect(metadata['yoloMode']).toBe(false);
    });

    it('空 patch 不凭空写入任何档位键', () => {
      const { metadata } = mergeSessionMetadataForUpdate({}, {});
      expect('permissionMode' in metadata).toBe(false);
      expect('yoloMode' in metadata).toBe(false);
    });

    it('已持久化 {yoloMode:true} 的会话在任意写入后补齐规范键', () => {
      const { metadata } = mergeSessionMetadataForUpdate({ yoloMode: true }, { modelId: 'm1' });
      expect(metadata['permissionMode']).toBe('yolo');
      expect(metadata['yoloMode']).toBe(true);
      expect(metadata['modelId']).toBe('m1');
    });

    it('规范键优先于旧布尔：{permissionMode:ask} 覆盖既有 yoloMode:true', () => {
      const { metadata } = mergeSessionMetadataForUpdate(
        { yoloMode: true },
        { permissionMode: 'ask' },
      );
      expect(metadata['permissionMode']).toBe('ask');
      expect(metadata['yoloMode']).toBe(false);
    });

    it('同一 patch 内规范键优先于旧布尔：{permissionMode:ask, yoloMode:true} 以 ask 为准', () => {
      const { metadata } = mergeSessionMetadataForUpdate(
        { permissionMode: 'yolo' },
        { permissionMode: 'ask', yoloMode: true },
      );
      expect(metadata['permissionMode']).toBe('ask');
      expect(metadata['yoloMode']).toBe(false);
    });

    it('旧客户端布尔可关闭 YOLO：{permissionMode:yolo} + patch {yoloMode:false} 降级为 ask', () => {
      const { metadata } = mergeSessionMetadataForUpdate(
        { permissionMode: 'yolo' },
        { yoloMode: false },
      );
      expect(metadata['permissionMode']).toBe('ask');
      expect(metadata['yoloMode']).toBe(false);
    });

    it('旧客户端布尔保持 YOLO：{permissionMode:yolo} + patch {yoloMode:true} 仍为 yolo', () => {
      const { metadata } = mergeSessionMetadataForUpdate(
        { permissionMode: 'yolo' },
        { yoloMode: true },
      );
      expect(metadata['permissionMode']).toBe('yolo');
      expect(metadata['yoloMode']).toBe(true);
    });

    it('旧客户端布尔可提升档位：{permissionMode:auto-edit} + patch {yoloMode:true} 升级为 yolo', () => {
      const { metadata } = mergeSessionMetadataForUpdate(
        { permissionMode: 'auto-edit' },
        { yoloMode: true },
      );
      expect(metadata['permissionMode']).toBe('yolo');
      expect(metadata['yoloMode']).toBe(true);
    });

    it('patch 未携带档位键时沿用合并结果：{permissionMode:yolo} + patch {dialogueMode:coding} 仍为 yolo', () => {
      const { metadata } = mergeSessionMetadataForUpdate(
        { permissionMode: 'yolo' },
        { dialogueMode: 'coding' },
      );
      expect(metadata['permissionMode']).toBe('yolo');
      expect(metadata['yoloMode']).toBe(true);
    });
  });

  describe('持久化读路径', () => {
    it('normalizePersistedSessionMetadata 不改写权限字段（历史布尔会话保持原样）', () => {
      const metadata = normalizePersistedSessionMetadata({ yoloMode: true });
      expect(metadata).toEqual({ yoloMode: true });
      expect('permissionMode' in metadata).toBe(false);
    });
  });
});
