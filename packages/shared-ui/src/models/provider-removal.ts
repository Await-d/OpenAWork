/** 可移除判据:custom 永不被后端重新播种;内置平台需同 type 仍有其它实例才不会被补回。 */
export function canRemoveProvider(
  providers: ReadonlyArray<{ id: string; type: string }>,
  providerId: string,
): boolean {
  const target = providers.find((provider) => provider.id === providerId);
  if (!target) {
    return false;
  }
  if (target.type === 'custom') {
    return true;
  }
  return providers.filter((provider) => provider.type === target.type).length > 1;
}
