/**
 * 顶栏标签自动入视的测试工具。
 *
 * jsdom 不做布局（`getBoundingClientRect` 恒为 0）、也没有真实滚动容器
 * （`scrollLeft` 恒为 0），所以「容器可视区 / 标签位置」与「滚动写入」都要替换成
 * 可控替身才能断言。工具集中在这里，hook 单测与 `TitlebarTabStrip` 集成测试共用。
 */
export interface RectSpec {
  readonly left: number;
  readonly right: number;
}

export function toDomRect({ left, right }: RectSpec): DOMRect {
  return {
    bottom: 28,
    height: 28,
    left,
    right,
    top: 0,
    width: right - left,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * 按 role / `data-tab-id` 喂回假矩形：`role="tablist"` 的元素即滚动容器，
 * 其余元素按 `data-tab-id` 查表，未登记的返回零尺寸。
 *
 * `getScrollLeft` 用来让内容矩形随滚动左移——真实布局里容器滚动多少、标签就移动多少，
 * 少了这一层，重复测量会一直算出「仍然溢出」并反复累加。
 */
export function installTabScrollLayout(
  container: RectSpec,
  tabs: Readonly<Record<string, RectSpec>>,
  getScrollLeft: () => number = () => 0,
): () => void {
  const original = Element.prototype.getBoundingClientRect;

  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this instanceof HTMLElement) {
      if (this.getAttribute('role') === 'tablist') {
        return toDomRect(container);
      }

      const tabId = this.getAttribute('data-tab-id');
      const tabRect = tabId ? tabs[tabId] : undefined;
      if (tabRect) {
        const offset = getScrollLeft();
        return toDomRect({ left: tabRect.left - offset, right: tabRect.right - offset });
      }
    }

    return toDomRect({ left: 0, right: 0 });
  };

  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/**
 * 把 `Element.prototype.scrollLeft` 换成可读写的单值计数器（jsdom 里真实值为恒 0）。
 * 只适合「同一时刻只测一个滚动容器」的用例——所有元素共享这份计数。
 *
 * `history` 记录每一次写入，用来断言「没有来回抖动」（例如先滚到目标再被拉回 0）。
 */
export function installTrackedScrollLeft(): {
  read: () => number;
  history: () => readonly number[];
  restore: () => void;
} {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
  const writes: number[] = [];
  let value = 0;

  Object.defineProperty(Element.prototype, 'scrollLeft', {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = next;
      writes.push(next);
    },
  });

  return {
    read: () => value,
    history: () => [...writes],
    restore: () => {
      if (descriptor) {
        Object.defineProperty(Element.prototype, 'scrollLeft', descriptor);
      }
    },
  };
}
