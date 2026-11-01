export const RUN_EVENT_MAX_BYTES = 1024 * 1024;
export const RUN_EVENT_PAGE_MAX_BYTES = 2 * 1024 * 1024;

export class RunEventSizeError extends Error {
  constructor() {
    super('实时事件超过传输预算，原始数据已保留，请通过会话历史或工具结果查看。');
    this.name = 'RunEventSizeError';
  }
}

/** 在 stringify 之前检查 JSON 的保守上界；遍历、深度与字符串扫描都有硬预算。 */
export function assertRunEventSize(value: unknown): void {
  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set<object>();
  const addString = (text: string) => {
    if (text.length > RUN_EVENT_MAX_BYTES) throw new RunEventSizeError();
    bytes += 2;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      bytes +=
        code < 32 || code === 34 || code === 92 || (code >= 0xd800 && code <= 0xdfff)
          ? 6
          : code < 128
            ? 1
            : code < 2048
              ? 2
              : 3;
      if (bytes > RUN_EVENT_MAX_BYTES) throw new RunEventSizeError();
    }
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 32768 || depth > 64 || bytes > RUN_EVENT_MAX_BYTES) throw new RunEventSizeError();
    if (typeof item === 'string') {
      addString(item);
      return;
    }
    if (item === null || typeof item !== 'object') {
      bytes += 32;
      return;
    }
    if (Array.isArray(item) && item.length > 32768) throw new RunEventSizeError();
    if (ancestors.has(item)) throw new RunEventSizeError();
    const prototype: unknown = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
      throw new RunEventSizeError();
    if (Object.getOwnPropertyDescriptor(item, 'toJSON')) throw new RunEventSizeError();
    ancestors.add(item);
    bytes += 2;
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        bytes += 2;
        if (property && !('value' in property)) throw new RunEventSizeError();
        visit(property?.value, depth + 1);
      }
    } else {
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        addString(key);
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!property || !('value' in property)) throw new RunEventSizeError();
        bytes += 2;
        visit(property.value, depth + 1);
      }
    }
    ancestors.delete(item);
    if (bytes > RUN_EVENT_MAX_BYTES) throw new RunEventSizeError();
  };
  visit(value, 0);
}
