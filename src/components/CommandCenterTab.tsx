import { ExternalLink, HelpCircle, Loader2, Play } from 'lucide-react';
import { resolveProjectConfig, type ProjectConfig } from '../lib/projectLauncher';
import type { Agent, ExecutionLog, Mission } from '../types/hq';

export interface LaunchFeedback {
  state: 'idle' | 'starting' | 'active' | 'offline' | 'error';
  message?: string;
}

interface CommandCenterTabProps {
  agents: Agent[];
  missions: Mission[];
  logs: ExecutionLog[];
  quickInputs: Record<string, string>;
  launchFeedbacks: Record<string, LaunchFeedback>;
  onQuickInputChange: (agentId: string, value: string) => void;
  onQuickAddIdea: (agentId: string) => void;
  onPromoteToIDE: (missionId: string) => void;
  onCompleteMission: (missionId: string, agentId: string) => void;
  onDeleteMission: (missionId: string) => void;
  onAuditProject: (agentId: string) => void;
  onLaunchProject: (agent: Agent, config: ProjectConfig) => void;
  onOpenFallbackModal: (config: ProjectConfig, bridgeOffline?: boolean) => void;
}

export function CommandCenterTab({
  agents,
  missions,
  logs,
  quickInputs,
  launchFeedbacks,
  onQuickInputChange,
  onQuickAddIdea,
  onPromoteToIDE,
  onCompleteMission,
  onDeleteMission,
  onAuditProject,
  onLaunchProject,
  onOpenFallbackModal,
}: CommandCenterTabProps) {
  return (
    <div className="layout">
      <div className="projects-grid">
        {agents.map((agent) => {
          const projectMissions = missions.filter(
            (m) => m.agent_id === agent.id && !m.raw_idea.startsWith('[GENERATE_IDEAS]')
          );
          const activeItems = projectMissions.filter((m) =>
            ['DRAFTING', 'PENDING', 'IN_IDE'].includes(m.status)
          );
          const backlogItems = projectMissions.filter((m) => m.status === 'BACKLOG');

          const statusLabel =
            agent.status === 'WORKING'
              ? '⚡ Em Execução'
              : agent.status === 'ERROR'
                ? '🚨 Alerta'
                : 'Pronto';
          const cardClass =
            agent.status === 'WORKING'
              ? 'card working'
              : agent.status === 'ERROR'
                ? 'card error'
                : 'card';

          const folderName = agent.local_path
            ? agent.local_path.split('\\').pop() || agent.local_path
            : agent.id;

          const resolvedConfig: ProjectConfig = resolveProjectConfig(
            agent.id,
            agent.project_name
          ) || {
            slug: agent.id,
            agent_ids: [agent.id],
            nome: agent.project_name,
            tipo: agent.url && agent.url.startsWith('https://') ? 'cloud' : 'local',
            modo: agent.url && agent.url.startsWith('http') ? 'web' : 'script',
            url_destino: agent.url && agent.url.startsWith('http') ? agent.url : '',
            diretorio_local: agent.local_path || '',
            comando_start: 'python main.py',
            instrucoes_fallback: 'Abra o terminal na pasta local do projeto e inicie manualmente.',
          };

          const feedback = launchFeedbacks[agent.id] || { state: 'idle' };
          const isStarting = feedback.state === 'starting';

          return (
            <div key={agent.id} className={cardClass}>
              <div className="card-header">
                <div>
                  <h3 className="card-title">{agent.project_name}</h3>
                  <div className="card-meta">
                    {agent.room} •{' '}
                    {resolvedConfig.tipo === 'cloud' && resolvedConfig.url_destino ? (
                      <a
                        href={resolvedConfig.url_destino}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#60a5fa', textDecoration: 'none' }}
                      >
                        ☁️ Cloud
                      </a>
                    ) : resolvedConfig.porta ? (
                      <span>🖥️ Porta {resolvedConfig.porta}</span>
                    ) : (
                      <span>📁 {folderName}</span>
                    )}
                  </div>
                </div>
                <span className={`status-badge st-${agent.status}`}>{statusLabel}</span>
              </div>

              <div className="stack-line">{agent.stack || 'Stack Padrão'}</div>

              <div className="launch-row">
                <button
                  type="button"
                  className={`btn btn-sm btn-launch ${
                    resolvedConfig.tipo === 'cloud' ? 'btn-launch-cloud' : 'btn-launch-local'
                  }`}
                  disabled={isStarting}
                  onClick={() => onLaunchProject(agent, resolvedConfig)}
                >
                  {isStarting ? (
                    <Loader2 size={14} className="spin-icon" />
                  ) : resolvedConfig.tipo === 'cloud' ? (
                    <ExternalLink size={14} />
                  ) : (
                    <Play size={14} />
                  )}
                  {isStarting ? 'Iniciando...' : 'Abrir Sistema'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-help-icon"
                  title="Instruções manuais e comando de execução"
                  aria-label={`Instruções manuais para ${agent.project_name}`}
                  onClick={() => onOpenFallbackModal(resolvedConfig, false)}
                >
                  <HelpCircle size={14} />
                </button>
              </div>

              {feedback.state !== 'idle' && feedback.message && (
                <div className={`launch-feedback launch-${feedback.state}`}>
                  {feedback.message}
                </div>
              )}

              <div className="backlog-box">
                <div className="backlog-header">
                  <span>Fila de Melhorias ({backlogItems.length})</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ai"
                    onClick={() => onAuditProject(agent.id)}
                  >
                    ✨ Sugerir Melhorias
                  </button>
                </div>

                <div className="backlog-list">
                  {activeItems.map((m) => (
                    <div key={m.id} className="backlog-item active-ide">
                      <div className="backlog-text">
                        <strong>[NA IDE]</strong> {m.raw_idea}
                      </div>
                      <div className="item-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Marcar como concluído"
                          onClick={() => onCompleteMission(m.id, agent.id)}
                        >
                          ✓
                        </button>
                      </div>
                    </div>
                  ))}

                  {backlogItems.map((m) => (
                    <div key={m.id} className="backlog-item">
                      <div className="backlog-text">{m.raw_idea}</div>
                      <div className="item-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-exec"
                          title="Enviar agora para Antigravity IDE"
                          onClick={() => onPromoteToIDE(m.id)}
                        >
                          ▶ IDE
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Remover ideia"
                          onClick={() => onDeleteMission(m.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}

                  {activeItems.length === 0 && backlogItems.length === 0 && (
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: '#6b7280',
                        padding: '8px',
                        textAlign: 'center',
                      }}
                    >
                      Nenhuma melhoria pendente. Adicione abaixo ou clique em Sugerir.
                    </div>
                  )}
                </div>
              </div>

              <div className="quick-add">
                <input
                  type="text"
                  value={quickInputs[agent.id] || ''}
                  onChange={(e) => onQuickInputChange(agent.id, e.target.value)}
                  placeholder="+ Anotar ideia de melhoria..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onQuickAddIdea(agent.id);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onQuickAddIdea(agent.id)}
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <aside className="sidebar">
        <h2>📡 Telemetria & War Room</h2>
        <div className="log-list">
          {logs.map((l) => {
            const time = new Date(l.created_at).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            return (
              <div key={l.id} className={`log-item ${l.level}`}>
                <div className="log-time">
                  {time} • <strong>{l.agent_id || 'SISTEMA'}</strong>
                </div>
                <div>{l.message}</div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
