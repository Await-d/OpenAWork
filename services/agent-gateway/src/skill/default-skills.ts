import { sqliteAll, sqliteRun } from '../db.js';

interface UserRow {
  id: string;
}

interface DefaultInstalledSkill {
  manifest: DefaultSkillManifest;
  sourceId: string;
}

interface DefaultSkillManifest {
  apiVersion: 'agent-skill/v1';
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author?: string;
  capabilities: string[];
  permissions: Array<{
    type: 'network' | 'filesystem' | 'clipboard' | 'env' | 'notifications' | 'camera' | 'location';
    scope: string;
    required: boolean;
  }>;
}

const AGENTDOCS_SOURCE_ID = 'github:Await-d/agentdocs-orchestrator';

const DEFAULT_INSTALLED_SKILLS: DefaultInstalledSkill[] = [
  {
    sourceId: AGENTDOCS_SOURCE_ID,
    manifest: {
      apiVersion: 'agent-skill/v1',
      id: 'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
      name: 'agentdocs-orchestrator',
      displayName: 'Agentdocs Orchestrator',
      version: '1.0.0',
      description:
        '与 agentdocs 知识管理集成的高级任务编排系统。将复杂请求拆解为原子任务、自动创建工作流规划文档、管理多 agent 并行执行、并同步任务状态。',
      author: 'Await-d',
      capabilities: ['orchestration', 'planning', 'documentation'],
      permissions: [],
    },
  },
  {
    sourceId: AGENTDOCS_SOURCE_ID,
    manifest: {
      apiVersion: 'agent-skill/v1',
      id: 'github:Await-d/agentdocs-orchestrator/schema-architect',
      name: 'schema-architect',
      displayName: 'Schema Architect',
      version: '1.0.0',
      description: '从任何关系描述设计数据库表结构，含完整的索引策略分析。',
      author: 'Await-d',
      capabilities: ['database', 'schema-design', 'analysis'],
      permissions: [],
    },
  },
];

export function ensureDefaultInstalledSkills(userId: string): void {
  const now = Date.now();
  for (const skill of DEFAULT_INSTALLED_SKILLS) {
    sqliteRun(
      `INSERT INTO installed_skills (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', 1, ?, ?)
       ON CONFLICT(skill_id, user_id) DO UPDATE SET
         source_id = excluded.source_id,
         manifest_json = excluded.manifest_json,
         granted_permissions_json = excluded.granted_permissions_json,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
      [skill.manifest.id, userId, skill.sourceId, JSON.stringify(skill.manifest), now, now],
    );
  }
}

export function ensureDefaultInstalledSkillsForAllUsers(): void {
  const users = sqliteAll<UserRow>('SELECT id FROM users');
  for (const user of users) {
    ensureDefaultInstalledSkills(user.id);
  }
}
