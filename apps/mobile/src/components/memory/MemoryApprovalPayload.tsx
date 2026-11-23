import { Text, View } from 'react-native';
import type { MemoryProposal } from '@openAwork/web-client';

export function MemoryApprovalPayload({ proposal }: { proposal: MemoryProposal }) {
  return (
    <View>
      <Text selectable>目标条目：{proposal.targetMemoryId ?? '新增条目'}</Text>
      <Text selectable>预期目标版本：{proposal.expectedRevision ?? '未指定'}</Text>
      <Text>完整待批准载荷（包含启用状态、角色层级等实际提交字段）：</Text>
      <Text selectable accessibilityLabel="完整待批准载荷">
        {JSON.stringify(proposal.payload, null, 2)}
      </Text>
    </View>
  );
}
