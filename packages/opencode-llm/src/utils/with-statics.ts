/**
 * 给 Effect Schema 附加静态成员（`make` / `is` / 构造辅助等）。
 *
 * 对齐 opencode 参考库 `@opencode/schema/schema` 的 `withStatics`：本仓不引入该
 * 内部包（决策 D-6），以等价的泛型透传实现替代，调用点形状与上游保持一致，
 * 便于后续逐行对照与增量同步。
 *
 * 实现上刻意不用 `Object.assign`：Effect 4 的 Schema 对象把 `make` / `is`
 * 挂在原型上并以只读 getter 暴露，`Object.assign` 走赋值语义会直接抛
 * `Cannot set property make of #<Object> which has only a getter`。这里按
 * own enumerable 键逐个 `defineProperty`，在自己的属性上落地同名数据属性，
 * 既绕开原型 getter，也保持与 `Object.assign` 相同的可写 / 可枚举 / 可配置语义。
 */
export const withStatics = <SchemaType extends object, Statics extends object>(
  schema: SchemaType,
  statics: Statics,
): SchemaType & Statics => {
  for (const key of Reflect.ownKeys(statics)) {
    const descriptor = Object.getOwnPropertyDescriptor(statics, key);
    if (descriptor === undefined || !descriptor.enumerable) continue;
    Object.defineProperty(schema, key, {
      value: Reflect.get(statics, key),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return schema as SchemaType & Statics;
};
