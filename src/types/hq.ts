export type AgentStatus = 'LOUNGE' | 'WORKING' | 'ERROR';

export interface Agent {
  id: string;
  project_name: string;
  room: string;
  stack: string | null;
  url: string | null;
  local_path: string;
  agent_context: string | null;
  status: AgentStatus;
  current_task_summary: string | null;
  updated_at?: string;
}

export type MissionStatus =
  | 'BACKLOG'
  | 'DRAFTING'
  | 'PENDING'
  | 'IN_IDE'
  | 'COMPLETED';

export type TaskType = 'FEATURE' | 'BUGFIX' | 'REFACTOR' | 'BOT';

export interface Mission {
  id: string;
  agent_id: string;
  task_type: TaskType;
  raw_idea: string;
  status: MissionStatus;
  generated_spec?: string | null;
  spec_filename?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export interface ExecutionLog {
  id: string;
  agent_id: string | null;
  source?: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type StrategicIdeaStatus = 'pending' | 'implemented' | 'discarded';

export interface StrategicIdea {
  id: string;
  project_id: string;
  category: string;
  prompt_template: string;
  idea_text?: string;
  title?: string;
  description?: string;
  content?: string;
  status: StrategicIdeaStatus;
  created_at?: string;
}
