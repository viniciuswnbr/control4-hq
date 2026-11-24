import { useCallback, useEffect, useState } from 'react';
import { Building2, LayoutDashboard } from 'lucide-react';
import { supabase } from './lib/supabase';
import { BoardroomTab } from './components/BoardroomTab';
import { CommandCenterTab } from './components/CommandCenterTab';
import type { Agent, ExecutionLog, Mission, MissionStatus, TaskType } from './types/hq';

type ActiveTab = 'command-center' | 'boardroom';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('command-center');
  const [connStatus, setConnStatus] = useState<string>('● Conectando...');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});

  // Modais
  const [showMissionModal, setShowMissionModal] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [auditAgent, setAuditAgent] = useState<Agent | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSuggestions, setAuditSuggestions] = useState<string[]>([]);

  // Form Nova Missão
  const [modalAgentId, setModalAgentId] = useState('');
  const [modalTaskType, setModalTaskType] = useState<TaskType>('FEATURE');
  const [modalRawIdea, setModalRawIdea] = useState('');

  // Form Chave Gemini
  const [geminiKeyInput, setGeminiKeyInput] = useState('');

  const loadAgents = useCallback(async () => {
    const { data } = await supabase
      .from('agents')
      .select('*')
      .order('room')
      .order('project_name');
    if (data) {
      const typed = data as Agent[];
      setAgents(typed);
      setModalAgentId((prev) => prev || typed[0]?.id || '');
    }
  }, []);

  const loadMissions = useCallback(async () => {
    const { data } = await supabase
      .from('missions')
      .select('*')
      .in('status', ['BACKLOG', 'DRAFTING', 'PENDING', 'IN_IDE'])
      .order('created_at', { ascending: false });
    if (data) {
      setMissions(data as Mission[]);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    const { data } = await supabase
      .from('execution_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25);
    if (data) {
      setLogs(data as ExecutionLog[]);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadAgents(), loadMissions(), loadLogs()]).then(() => {
      setConnStatus('● Online (Realtime)');
    });

    const channel = supabase
      .channel('hq-command-center')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents' },
        () => {
          void loadAgents();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'missions' },
        () => {
          void loadMissions();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'execution_logs' },
        (payload) => {
          setLogs((prev) => [payload.new as ExecutionLog, ...prev].slice(0, 30));
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadAgents, loadMissions, loadLogs]);

  const handleQuickAddIdea = async (agentId: string) => {
    const text = (quickInputs[agentId] || '').trim();
    if (!text) return;
    setQuickInputs((prev) => ({ ...prev, [agentId]: '' }));
    await supabase.from('missions').insert({
      agent_id: agentId,
      task_type: 'FEATURE',
      raw_idea: text,
      status: 'BACKLOG',
    });
    await loadMissions();
  };

  const handlePromoteToIDE = async (missionId: string) => {
    await supabase
      .from('missions')
      .update({ status: 'PENDING' })
      .eq('id', missionId);
    await loadMissions();
  };

  const handleCompleteMission = async (missionId: string, agentId: string) => {
    await supabase
      .from('missions')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      })
      .eq('id', missionId);
    await supabase
      .from('agents')
      .update({
        status: 'LOUNGE',
        current_task_summary: 'Concluído via Command Center',
      })
      .eq('id', agentId);
    await Promise.all([loadAgents(), loadMissions()]);
  };

  const handleDeleteMission = async (missionId: string) => {
    await supabase.from('missions').delete().eq('id', missionId);
    await loadMissions();
  };

  const handleSaveMission = async (targetStatus: MissionStatus) => {
    const trimmed = modalRawIdea.trim();
    if (!trimmed) {
      window.alert('Descreva a ideia ou melhoria.');
      return;
    }
    await supabase.from('missions').insert({
      agent_id: modalAgentId || agents[0]?.id,
      task_type: modalTaskType,
      raw_idea: trimmed,
      status: targetStatus,
    });
    setModalRawIdea('');
    setShowMissionModal(false);
    await loadMissions();
  };

  const handleOpenKeyModal = () => {
    setGeminiKeyInput(localStorage.getItem('HQ_GEMINI_KEY') || '');
    setShowKeyModal(true);
  };

  const handleSaveBrowserKey = () => {
    const val = geminiKeyInput.trim();
    if (val) localStorage.setItem('HQ_GEMINI_KEY', val);
    setShowKeyModal(false);
  };

  const handleAuditProject = async (agentId: string) => {
    const key = localStorage.getItem('HQ_GEMINI_KEY');
    if (!key) {
      handleOpenKeyModal();
      return;
    }

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    setAuditAgent(agent);
    setAuditLoading(true);
    setAuditError(null);
    setAuditSuggestions([]);

    const prompt = `Você é um Arquiteto de Software e Produto Sênior.
Analise o projeto abaixo e sugira exatamente 3 melhorias práticas, de alto impacto e implementação rápida.
Projeto: ${agent.project_name}
Stack: ${agent.stack || 'Padrão'}
Regras: ${agent.agent_context || 'Nenhuma regra extra'}

Responda APENAS com um array JSON válido de 3 strings curtas e diretas (sem markdown, sem crases). Exemplo:
["Melhoria 1", "Melhoria 2", "Melhoria 3"]`;

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      const data = await resp.json();
      const rawText = String(
        data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      )
        .replace(/```json|```/g, '')
        .trim();
      const parsed = JSON.parse(rawText) as string[];
      setAuditSuggestions(parsed);
    } catch {
      setAuditError(
        'Erro ao gerar sugestões. Verifique sua chave Gemini em "🔑 API Auditor".'
      );
    } finally {
      setAuditLoading(false);
    }
  };

  const handleAcceptSuggestion = async (suggestion: string) => {
    if (!auditAgent) return;
    await supabase.from('missions').insert({
      agent_id: auditAgent.id,
      task_type: 'FEATURE',
      raw_idea: suggestion,
      status: 'BACKLOG',
    });
    setAuditAgent(null);
    await loadMissions();
  };

  const workingCount = agents.filter((a) => a.status === 'WORKING').length;
  const backlogCount = missions.filter((m) => m.status === 'BACKLOG').length;

  return (
    <div className="container">
      <header>
        <div className="brand">
          <h1>CONTROL 4 HQ</h1>
          <span className="pill pill-online">{connStatus}</span>
        </div>

        <div className="stats-bar">
          <span>
            Projetos: <strong>{agents.length || 7}</strong>
          </span>
          <span>
            Em Execução: <strong>{workingCount}</strong>
          </span>
          <span>
            Melhorias no Backlog: <strong>{backlogCount}</strong>
          </span>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleOpenKeyModal}
          >
            🔑 API Auditor
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowMissionModal(true)}
          >
            + Nova Ideia / Missão
          </button>
        </div>
      </header>

      <nav className="main-nav" aria-label="Navegação Principal">
        <button
          type="button"
          className={`nav-tab ${activeTab === 'command-center' ? 'active' : ''}`}
          onClick={() => setActiveTab('command-center')}
        >
          <LayoutDashboard size={16} />
          Command Center
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === 'boardroom' ? 'active' : ''}`}
          onClick={() => setActiveTab('boardroom')}
        >
          <Building2 size={16} />
          Conselho Executivo
        </button>
      </nav>

      {activeTab === 'command-center' ? (
        <CommandCenterTab
          agents={agents}
          missions={missions}
          logs={logs}
          quickInputs={quickInputs}
          onQuickInputChange={(agentId, value) =>
            setQuickInputs((prev) => ({ ...prev, [agentId]: value }))
          }
          onQuickAddIdea={(agentId) => void handleQuickAddIdea(agentId)}
          onPromoteToIDE={(missionId) => void handlePromoteToIDE(missionId)}
          onCompleteMission={(missionId, agentId) =>
            void handleCompleteMission(missionId, agentId)
          }
          onDeleteMission={(missionId) => void handleDeleteMission(missionId)}
          onAuditProject={(agentId) => void handleAuditProject(agentId)}
        />
      ) : (
        <BoardroomTab
          agents={agents}
          onMissionCreated={() => void loadMissions()}
        />
      )}

      {/* Modal Nova Missão / Ideia */}
      {showMissionModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMissionModal(false);
          }}
        >
          <div className="modal">
            <h3>Registrar Ideia ou Disparar para IDE</h3>
            <label>Projeto Alvo</label>
            <select
              value={modalAgentId}
              onChange={(e) => setModalAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.project_name} ({a.room})
                </option>
              ))}
            </select>

            <label>Categoria</label>
            <select
              value={modalTaskType}
              onChange={(e) => setModalTaskType(e.target.value as TaskType)}
            >
              <option value="FEATURE">🚀 Nova Feature / Melhoria</option>
              <option value="BUGFIX">🚨 Correção de Bug</option>
              <option value="REFACTOR">♻️ Refatoração / Arquitetura</option>
              <option value="BOT">🤖 Nova Automação / Script</option>
            </select>

            <label>Descrição da Melhoria ou Tarefa</label>
            <textarea
              rows={4}
              value={modalRawIdea}
              onChange={(e) => setModalRawIdea(e.target.value)}
              placeholder="Descreva o que deseja melhorar ou construir..."
            />

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowMissionModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleSaveMission('BACKLOG')}
              >
                💾 Salvar no Backlog
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleSaveMission('PENDING')}
              >
                ⚡ Executar Agora na IDE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Auditor de Melhorias (IA) */}
      {auditAgent && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAuditAgent(null);
          }}
        >
          <div className="modal">
            <h3>✨ Sugestões para {auditAgent.project_name}</h3>
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--muted)',
                marginTop: 0,
              }}
            >
              Sugestões geradas com base na stack e nas regras de negócio do
              projeto:
            </p>

            {auditLoading && (
              <p style={{ color: '#9ca3af' }}>
                Analisando stack e regras de negócio...
              </p>
            )}
            {auditError && <p style={{ color: '#f87171' }}>{auditError}</p>}

            {!auditLoading &&
              !auditError &&
              auditSuggestions.map((s, idx) => (
                <div key={idx} className="suggestion-card">
                  <span>{s}</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleAcceptSuggestion(s)}
                  >
                    + Backlog
                  </button>
                </div>
              ))}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setAuditAgent(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chave Gemini */}
      {showKeyModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowKeyModal(false);
          }}
        >
          <div className="modal">
            <h3>🔑 Configurar Chave Gemini (Para Auditoria de Ideias)</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              Salva apenas localmente no seu navegador (localStorage) para gerar
              sugestões de melhorias nos cards.
            </p>
            <input
              type="password"
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              placeholder="Cole sua GEMINI_API_KEY (AIzaSy...)"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowKeyModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleSaveBrowserKey}
              >
                Salvar Chave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
