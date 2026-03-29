import type { CanonicalRoleDescriptor } from '@openAwork/shared';
import type { DAGEvent } from './types.js';

export type MemberStatus = 'idle' | 'working' | 'done' | 'error';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  canonicalRole?: CanonicalRoleDescriptor;
  status: MemberStatus;
  currentTask?: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TeamTask {
  id: string;
  title: string;
  assignedTo?: string;
  status: TaskStatus;
  result?: string;
}

export interface TeamMessage {
  id: string;
  memberId: string;
  content: string;
  timestamp: number;
  type: 'update' | 'question' | 'result' | 'error';
}

export interface ActiveTeam {
  name: string;
  description: string;
  sessionId?: string;
  members: TeamMember[];
  tasks: TeamTask[];
  messages: TeamMessage[];
  createdAt: number;
}

export interface TeamStore {
  getTeam(sessionId: string): ActiveTeam | undefined;
  startTeam(sessionId: string, name: string, description: string): ActiveTeam;
  endTeam(sessionId: string): void;
  addMember(sessionId: string, member: TeamMember): void;
  updateMember(sessionId: string, memberId: string, patch: Partial<TeamMember>): void;
  addTask(sessionId: string, task: TeamTask): void;
  updateTask(sessionId: string, taskId: string, patch: Partial<TeamTask>): void;
  addMessage(sessionId: string, message: Omit<TeamMessage, 'id'>): void;
  handleDAGEvent(event: DAGEvent, sessionId: string): void;
  getHistory(): ActiveTeam[];
}

let _msgCounter = 0;
function nextMsgId(): string {
  return `msg-${Date.now()}-${++_msgCounter}`;
}

export class TeamStoreImpl implements TeamStore {
  private teams = new Map<string, ActiveTeam>();
  private history: ActiveTeam[] = [];

  getTeam(sessionId: string): ActiveTeam | undefined {
    return this.teams.get(sessionId);
  }

  startTeam(sessionId: string, name: string, description: string): ActiveTeam {
    const team: ActiveTeam = {
      name,
      description,
      sessionId,
      members: [],
      tasks: [],
      messages: [],
      createdAt: Date.now(),
    };
    this.teams.set(sessionId, team);
    return team;
  }

  endTeam(sessionId: string): void {
    const team = this.teams.get(sessionId);
    if (team) {
      this.history.push({
        ...team,
        members: [...team.members],
        tasks: [...team.tasks],
        messages: [...team.messages],
      });
      this.teams.delete(sessionId);
    }
  }

  addMember(sessionId: string, member: TeamMember): void {
    const team = this.teams.get(sessionId);
    if (!team) return;
    const exists = team.members.some((m) => m.id === member.id || m.name === member.name);
    if (!exists) {
      team.members.push({ ...member });
    }
  }

  updateMember(sessionId: string, memberId: string, patch: Partial<TeamMember>): void {
    const team = this.teams.get(sessionId);
    if (!team) return;
    const idx = team.members.findIndex((m) => m.id === memberId);
    if (idx !== -1) {
      team.members[idx] = { ...team.members[idx]!, ...patch };
    }
  }

  addTask(sessionId: string, task: TeamTask): void {
    const team = this.teams.get(sessionId);
    if (!team) return;
    const exists = team.tasks.some((t) => t.id === task.id);
    if (!exists) {
      team.tasks.push({ ...task });
    }
  }

  updateTask(sessionId: string, taskId: string, patch: Partial<TeamTask>): void {
    const team = this.teams.get(sessionId);
    if (!team) return;
    const idx = team.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return;
    if (team.tasks[idx]!.status === 'completed') return;
    team.tasks[idx] = { ...team.tasks[idx]!, ...patch };
  }

  addMessage(sessionId: string, message: Omit<TeamMessage, 'id'>): void {
    const team = this.teams.get(sessionId);
    if (!team) return;
    team.messages.push({ ...message, id: nextMsgId() });
  }

  handleDAGEvent(event: DAGEvent, sessionId: string): void {
    if (!this.teams.has(sessionId)) {
      this.startTeam(sessionId, 'Auto Team', 'Auto-created from DAG event');
    }

    switch (event.type) {
      case 'node_started': {
        this.addMember(sessionId, {
          id: event.nodeId,
          name: event.agentRoleId ?? event.nodeId,
          role: event.agentRoleId ?? 'agent',
          canonicalRole: event.canonicalRole,
          status: 'idle',
        });
        this.updateMember(sessionId, event.nodeId, {
          canonicalRole: event.canonicalRole,
          status: 'working',
          currentTask: event.nodeId,
        });
        this.addTask(sessionId, {
          id: event.nodeId,
          title: event.nodeId,
          assignedTo: event.nodeId,
          status: 'in_progress',
        });
        break;
      }

      case 'node_completed': {
        this.updateMember(sessionId, event.nodeId, { status: 'done' });
        const result =
          typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
        this.updateTask(sessionId, event.nodeId, { status: 'completed', result });
        this.addMessage(sessionId, {
          memberId: event.nodeId,
          content: `Node ${event.nodeId} completed`,
          timestamp: event.timestamp,
          type: 'result',
        });
        break;
      }

      case 'node_failed': {
        this.updateMember(sessionId, event.nodeId, { status: 'error' });
        this.updateTask(sessionId, event.nodeId, { status: 'failed' });
        this.addMessage(sessionId, {
          memberId: event.nodeId,
          content: `Node ${event.nodeId} failed: ${event.error}`,
          timestamp: event.timestamp,
          type: 'error',
        });
        break;
      }

      case 'dag_completed': {
        this.endTeam(sessionId);
        break;
      }

      case 'edge_activated': {
        this.addMessage(sessionId, {
          memberId: 'dag',
          content: `Edge ${event.edgeId} activated`,
          timestamp: event.timestamp,
          type: 'update',
        });
        break;
      }

      case 'human_approval_required': {
        this.addMessage(sessionId, {
          memberId: event.nodeId,
          content: `Human approval required: ${event.plan}`,
          timestamp: Date.now(),
          type: 'question',
        });
        break;
      }

      case 'risk_escalation': {
        this.addMessage(sessionId, {
          memberId: event.nodeId,
          content: `Risk escalation: ${event.riskDetail}. Suggested: ${event.suggestedAction}`,
          timestamp: Date.now(),
          type: 'error',
        });
        break;
      }
    }
  }

  getHistory(): ActiveTeam[] {
    return [...this.history];
  }
}
