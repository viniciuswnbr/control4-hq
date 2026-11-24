import type { Agent, ExecutionLog, Mission } from '../types/hq';

interface CommandCenterTabProps {
  agents: Agent[];
  missions: Mission[];
  logs: ExecutionLog[];
  quickInputs: Record<string, string>;
  onQuickInputChange: (agentId: string, value: string) => void;
  onQuickAddIdea: (agentId: string) => void;
  onPromoteToIDE: (missionId: string) => void;
  onCompleteMission: (missionId: string, agentId: string) => void;
  onDeleteMission: (missionId: string) => void;
  onAuditProject: (agentId: string) => void;
}

export function CommandCenterTab({
  agents,
  missions,
  logs,
  quickInputs,
  onQuickInputChange,
  onQuickAddIdea,
  onPromoteToIDE,
  onCompleteMission,
  onDeleteMission,
  onAuditProject,
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

          return (
            <div key={agent.id} className={cardClass}>
              <div className="card-header">
                <div>
                  <h3 className="card-title">{agent.project_name}</h3>
                  <div className="card-meta">
                    {agent.room} •{' '}
                    {agent.url && agent.url.startsWith('http') ? (
                      <a
                        href={agent.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#60a5fa', textDecoration: 'none' }}
                      >
                        ↗ Abrir App
                      </a>
                    ) : (
                      <span>📁 {folderName}</span>
                    )}
                  </div>
                </div>
                <span className={`status-badge st-${agent.status}`}>{statusLabel}</span>
              </div>

              <div className="stack-line">{agent.stack || 'Stack Padrão'}</div>

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
