import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Edit3,
  History,
  Loader2,
  Megaphone,
  Palette,
  PenTool,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import {
  BOARDROOM_PROJECTS,
  EXECUTIVE_DEPARTMENTS,
  getDepartmentById,
  type DepartmentConfig,
} from '../data/departments';
import {
  runBoardroomPeerReview,
  runBoardroomPropose,
} from '../lib/boardroomAi';
import { supabase } from '../lib/supabase';
import type {
  Agent,
  BoardroomSession,
  DepartmentId,
  PeerReviewItem,
  ProjectContext,
} from '../types/hq';

function formatContextDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '--/-- --:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface BoardroomTabProps {
  agents: Agent[];
  onMissionCreated?: () => void;
}

function DepartmentIcon({
  iconName,
  size = 18,
}: {
  iconName: DepartmentConfig['iconName'];
  size?: number;
}) {
  switch (iconName) {
    case 'TrendingUp':
      return <TrendingUp size={size} />;
    case 'Cpu':
      return <Cpu size={size} />;
    case 'Palette':
      return <Palette size={size} />;
    case 'Megaphone':
      return <Megaphone size={size} />;
    case 'PenTool':
      return <PenTool size={size} />;
    case 'Workflow':
      return <Workflow size={size} />;
  }
}

function compileFinalSpec(
  projectId: string,
  leadDept: DepartmentConfig,
  focusContext: string,
  proposalText: string,
  reviews: PeerReviewItem[]
): string {
  const lines: string[] = [
    `# Especificação Executiva Aprovada — ${projectId}`,
    `**Diretoria Líder:** ${leadDept.name} (${leadDept.roleTitle})`,
  ];

  if (focusContext.trim()) {
    lines.push(`**Direcionamento:** ${focusContext.trim()}`);
  }

  lines.push('', '## Proposta Principal (Validada)', proposalText.trim());

  if (reviews.length > 0) {
    lines.push('', '## Pareceres Cruzados Incorporados');
    for (const review of reviews) {
      const dept = getDepartmentById(review.department);
      lines.push('', `### ${dept.name}`, review.content.trim());
    }
  }

  return lines.join('\n');
}

export function BoardroomTab({ agents, onMissionCreated }: BoardroomTabProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    BOARDROOM_PROJECTS[0].id
  );
  const [focusContext, setFocusContext] = useState<string>('');

  const [activeSession, setActiveSession] = useState<BoardroomSession | null>(
    null
  );
  const [proposalDraft, setProposalDraft] = useState<string>('');
  const [peerReviews, setPeerReviews] = useState<PeerReviewItem[]>([]);
  const [selectedReviewDepts, setSelectedReviewDepts] = useState<
    DepartmentId[]
  >([]);

  const [approvedHistory, setApprovedHistory] = useState<BoardroomSession[]>(
    []
  );
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null
  );

  // Inline edit state for individual peer reviews
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editingReviewText, setEditingReviewText] = useState<string>('');

  // Loading & feedback states
  const [loadingSession, setLoadingSession] = useState<boolean>(false);
  const [generatingDept, setGeneratingDept] = useState<DepartmentId | null>(
    null
  );
  const [savingProposal, setSavingProposal] = useState<boolean>(false);
  const [generatingReviews, setGeneratingReviews] = useState<boolean>(false);
  const [approvingMission, setApprovingMission] = useState<boolean>(false);
  const [discardingDraft, setDiscardingDraft] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  // Repomix real code context state
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(
    null
  );
  const [loadingContext, setLoadingContext] = useState<boolean>(false);
  const [syncingRepomix, setSyncingRepomix] = useState<boolean>(false);

  const selectedProject = useMemo(
    () =>
      BOARDROOM_PROJECTS.find((p) => p.id === selectedProjectId) ||
      BOARDROOM_PROJECTS[0],
    [selectedProjectId]
  );

  const projectSummary = useMemo(() => {
    const matchedAgent = agents.find((a) => a.id === selectedProject.agentId);
    if (!matchedAgent) {
      return selectedProject.defaultSummary;
    }
    const parts = [
      `Nome: ${matchedAgent.project_name} (${matchedAgent.room})`,
      `Stack: ${matchedAgent.stack || 'Não especificada'}`,
      `Contexto: ${matchedAgent.agent_context || selectedProject.defaultSummary}`,
    ];
    if (matchedAgent.url) {
      parts.push(`URL: ${matchedAgent.url}`);
    }
    return parts.join(' | ');
  }, [agents, selectedProject]);

  const remainingDepartments = useMemo(() => {
    if (!activeSession) return [];
    return EXECUTIVE_DEPARTMENTS.filter(
      (dept) => dept.id !== activeSession.lead_department
    );
  }, [activeSession]);

  const hasUnsavedProposalChanges = useMemo(() => {
    if (!activeSession) return false;
    return proposalDraft !== activeSession.proposal_text;
  }, [activeSession, proposalDraft]);

  const loadBoardroomData = useCallback(async () => {
    setLoadingSession(true);
    setErrorMessage(null);

    const [draftRes, approvedRes] = await Promise.all([
      supabase
        .from('hq_boardroom_sessions')
        .select('*')
        .eq('project_id', selectedProjectId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('hq_boardroom_sessions')
        .select('*')
        .eq('project_id', selectedProjectId)
        .eq('status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(15),
    ]);

    if (draftRes.error) {
      setErrorMessage(
        `Erro ao carregar sessão do Conselho: ${draftRes.error.message}`
      );
      setActiveSession(null);
      setProposalDraft('');
      setPeerReviews([]);
    } else {
      const draft = (draftRes.data?.[0] as BoardroomSession | undefined) || null;
      setActiveSession(draft);
      setProposalDraft(draft?.proposal_text || '');
      setPeerReviews(Array.isArray(draft?.peer_reviews) ? draft.peer_reviews : []);
      if (draft?.focus_context) {
        setFocusContext(draft.focus_context);
      }
      if (draft) {
        const others = EXECUTIVE_DEPARTMENTS.filter(
          (d) => d.id !== draft.lead_department
        ).map((d) => d.id);
        setSelectedReviewDepts(others);
      } else {
        setSelectedReviewDepts([]);
      }
    }

    if (!approvedRes.error && approvedRes.data) {
      setApprovedHistory(approvedRes.data as BoardroomSession[]);
    }

    setLoadingSession(false);
  }, [selectedProjectId]);

  const loadProjectContext = useCallback(async (): Promise<ProjectContext | null> => {
    setLoadingContext(true);
    const { data, error } = await supabase
      .from('hq_project_contexts')
      .select('project_id, repo_summary, token_count, updated_at')
      .eq('project_id', selectedProjectId)
      .maybeSingle();

    setLoadingContext(false);
    if (!error && data) {
      const ctx = data as ProjectContext;
      setProjectContext(ctx);
      return ctx;
    }
    setProjectContext(null);
    return null;
  }, [selectedProjectId]);

  useEffect(() => {
    void loadBoardroomData();
    void loadProjectContext();
  }, [loadBoardroomData, loadProjectContext]);

  const fetchFreshRepoSummary = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('hq_project_contexts')
      .select('repo_summary')
      .eq('project_id', selectedProjectId)
      .maybeSingle();
    const fresh = (data as { repo_summary?: string } | null)?.repo_summary;
    return fresh || projectContext?.repo_summary || null;
  };

  const handleSyncRepomix = async () => {
    if (syncingRepomix) return;
    setErrorMessage(null);
    setStatusFeedback(null);
    setSyncingRepomix(true);

    const previousUpdatedAt = projectContext?.updated_at || null;

    const { error } = await supabase.from('missions').insert({
      agent_id: selectedProject.agentId,
      task_type: 'FEATURE',
      raw_idea: `[SYNC_REPOMIX] ${selectedProjectId}`,
      status: 'PENDING',
    });

    if (error) {
      setSyncingRepomix(false);
      setErrorMessage(`Falha ao solicitar indexação Repomix: ${error.message}`);
      return;
    }

    setStatusFeedback(
      `Indexação Repomix solicitada para ${selectedProjectId}. Aguardando shev-bridge.py...`
    );

    let attempts = 0;
    const pollTimer = window.setInterval(async () => {
      attempts += 1;
      const updated = await loadProjectContext();
      if (
        (updated && updated.updated_at !== previousUpdatedAt) ||
        attempts >= 12
      ) {
        window.clearInterval(pollTimer);
        setSyncingRepomix(false);
        if (updated && updated.updated_at !== previousUpdatedAt) {
          setStatusFeedback(
            `Contexto Repomix de ${selectedProjectId} atualizado (~${updated.token_count.toLocaleString('pt-BR')} tokens).`
          );
        }
      }
    }, 3000);
  };

  const handleSummonDepartment = async (deptId: DepartmentId) => {
    setErrorMessage(null);
    setStatusFeedback(null);
    setGeneratingDept(deptId);

    try {
      const repoSummary = await fetchFreshRepoSummary();
      const { text: proposal, model: usedModel } = await runBoardroomPropose({
        projectId: selectedProjectId,
        department: deptId,
        focusContext,
        projectSummary,
        repoSummary,
      });

      const now = new Date().toISOString();

      if (activeSession) {
        const { data, error } = await supabase
          .from('hq_boardroom_sessions')
          .update({
            lead_department: deptId,
            focus_context: focusContext.trim() || null,
            proposal_text: proposal,
            peer_reviews: [],
            updated_at: now,
          })
          .eq('id', activeSession.id)
          .select()
          .single();

        if (error) throw new Error(error.message);
        const updated = data as BoardroomSession;
        setActiveSession(updated);
        setProposalDraft(updated.proposal_text);
        setPeerReviews([]);
      } else {
        const { data, error } = await supabase
          .from('hq_boardroom_sessions')
          .insert({
            project_id: selectedProjectId,
            lead_department: deptId,
            focus_context: focusContext.trim() || null,
            proposal_text: proposal,
            peer_reviews: [],
            status: 'draft',
            updated_at: now,
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        const created = data as BoardroomSession;
        setActiveSession(created);
        setProposalDraft(created.proposal_text);
        setPeerReviews([]);
      }

      const others = EXECUTIVE_DEPARTMENTS.filter((d) => d.id !== deptId).map(
        (d) => d.id
      );
      setSelectedReviewDepts(others);
      setStatusFeedback(
        `Proposta de ${getDepartmentById(deptId).name} gerada e salva como rascunho. • Gerado via ${usedModel}`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Falha ao gerar proposta do departamento.'
      );
    } finally {
      setGeneratingDept(null);
    }
  };

  const handleSaveProposalEdits = async (): Promise<boolean> => {
    if (!activeSession) return false;
    setSavingProposal(true);
    setErrorMessage(null);

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('hq_boardroom_sessions')
      .update({
        proposal_text: proposalDraft,
        focus_context: focusContext.trim() || null,
        updated_at: now,
      })
      .eq('id', activeSession.id)
      .select()
      .single();

    setSavingProposal(false);

    if (error) {
      setErrorMessage(`Erro ao salvar ajustes: ${error.message}`);
      return false;
    }

    setActiveSession(data as BoardroomSession);
    setStatusFeedback('Ajustes do dossiê salvos no Supabase.');
    return true;
  };

  const toggleReviewDepartment = (deptId: DepartmentId) => {
    setSelectedReviewDepts((prev) =>
      prev.includes(deptId)
        ? prev.filter((id) => id !== deptId)
        : [...prev, deptId]
    );
  };

  const handleRequestPeerReviews = async () => {
    if (!activeSession) return;
    if (selectedReviewDepts.length === 0) {
      setErrorMessage(
        'Selecione pelo menos uma área para emitir parecer cruzado.'
      );
      return;
    }

    setErrorMessage(null);
    setStatusFeedback(null);
    setGeneratingReviews(true);

    try {
      if (hasUnsavedProposalChanges) {
        const saved = await handleSaveProposalEdits();
        if (!saved) {
          setGeneratingReviews(false);
          return;
        }
      }

      const repoSummary = await fetchFreshRepoSummary();
      const results = await runBoardroomPeerReview({
        projectId: selectedProjectId,
        leadDepartment: activeSession.lead_department,
        currentProposal: proposalDraft,
        reviewingDepartments: selectedReviewDepts,
        projectSummary,
        repoSummary,
      });

      const now = new Date().toISOString();
      const newReviewItems: PeerReviewItem[] = results.map((res) => ({
        id: `${res.department}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        department: res.department,
        content: res.content,
        created_at: now,
      }));

      // Replace existing reviews for the re-requested departments while keeping untouched ones
      const mergedReviews = [
        ...peerReviews.filter(
          (existing) => !selectedReviewDepts.includes(existing.department)
        ),
        ...newReviewItems,
      ];

      const { data, error } = await supabase
        .from('hq_boardroom_sessions')
        .update({
          peer_reviews: mergedReviews,
          updated_at: now,
        })
        .eq('id', activeSession.id)
        .select()
        .single();

      if (error) throw new Error(error.message);

      setActiveSession(data as BoardroomSession);
      setPeerReviews(mergedReviews);
      const usedModels = Array.from(new Set(results.map((r) => r.model))).join(
        ', '
      );
      setStatusFeedback(
        `${newReviewItems.length} parecer(es) cruzado(s) gerado(s) com sucesso. • Gerado via ${usedModels}`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Erro ao solicitar pareceres das outras áreas.'
      );
    } finally {
      setGeneratingReviews(false);
    }
  };

  const persistPeerReviews = async (updatedReviews: PeerReviewItem[]) => {
    if (!activeSession) return;
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('hq_boardroom_sessions')
      .update({
        peer_reviews: updatedReviews,
        updated_at: now,
      })
      .eq('id', activeSession.id)
      .select()
      .single();

    if (error) {
      setErrorMessage(`Erro ao atualizar pareceres: ${error.message}`);
      return;
    }

    setActiveSession(data as BoardroomSession);
    setPeerReviews(updatedReviews);
  };

  const handleStartEditReview = (review: PeerReviewItem) => {
    setEditingReviewId(review.id);
    setEditingReviewText(review.content);
  };

  const handleSaveEditReview = async (reviewId: string) => {
    const updated = peerReviews.map((item) =>
      item.id === reviewId ? { ...item, content: editingReviewText } : item
    );
    await persistPeerReviews(updated);
    setEditingReviewId(null);
    setEditingReviewText('');
    setStatusFeedback('Parecer atualizado.');
  };

  const handleDeleteReview = async (reviewId: string) => {
    const updated = peerReviews.filter((item) => item.id !== reviewId);
    await persistPeerReviews(updated);
    setStatusFeedback('Parecer removido da pauta.');
  };

  const handleApproveAndDispatch = async () => {
    if (!activeSession) return;
    if (!proposalDraft.trim()) {
      setErrorMessage('A proposta principal não pode estar vazia.');
      return;
    }

    setApprovingMission(true);
    setErrorMessage(null);

    try {
      const leadDept = getDepartmentById(activeSession.lead_department);
      const finalSpec = compileFinalSpec(
        selectedProjectId,
        leadDept,
        focusContext,
        proposalDraft,
        peerReviews
      );

      const missionTitle = `[Boardroom • ${leadDept.shortName}] ${
        focusContext.trim()
          ? focusContext.trim().slice(0, 120)
          : `Decisão Executiva para ${selectedProjectId}`
      }`;

      const { error: missionError } = await supabase.from('missions').insert({
        agent_id: selectedProject.agentId,
        task_type: 'FEATURE',
        raw_idea: `${missionTitle}\n\n${finalSpec}`,
        generated_spec: finalSpec,
        status: 'PENDING',
      });

      if (missionError) {
        throw new Error(
          `Falha ao enviar missão para o Copilot: ${missionError.message}`
        );
      }

      const now = new Date().toISOString();
      const baseSessionUpdate = {
        proposal_text: proposalDraft,
        peer_reviews: peerReviews,
        status: 'approved' as const,
        updated_at: now,
      };

      let { error: sessionError } = await supabase
        .from('hq_boardroom_sessions')
        .update({
          ...baseSessionUpdate,
          final_spec: finalSpec,
        })
        .eq('id', activeSession.id);

      // Fallback caso a coluna final_spec ainda não exista no schema do Supabase
      if (sessionError?.message?.includes('final_spec')) {
        const retryRes = await supabase
          .from('hq_boardroom_sessions')
          .update(baseSessionUpdate)
          .eq('id', activeSession.id);
        sessionError = retryRes.error;
      }

      if (sessionError) {
        throw new Error(
          `Missão enviada, mas houve erro ao aprovar sessão: ${sessionError.message}`
        );
      }

      setActiveSession(null);
      setProposalDraft('');
      setPeerReviews([]);
      setSelectedReviewDepts([]);
      setFocusContext('');
      setStatusFeedback(
        `Decisão aprovada e disparada para a fila PENDING do Copilot (${selectedProject.agentId}).`
      );

      onMissionCreated?.();
      await loadBoardroomData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Erro ao aprovar e disparar missão.'
      );
    } finally {
      setApprovingMission(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!activeSession) return;
    setDiscardingDraft(true);
    setErrorMessage(null);

    const { error } = await supabase
      .from('hq_boardroom_sessions')
      .delete()
      .eq('id', activeSession.id);

    setDiscardingDraft(false);

    if (error) {
      setErrorMessage(`Erro ao descartar rascunho: ${error.message}`);
      return;
    }

    setActiveSession(null);
    setProposalDraft('');
    setPeerReviews([]);
    setSelectedReviewDepts([]);
    setStatusFeedback('Rascunho descartado. Mesa limpa para nova convocação.');
  };

  const leadDeptConfig = activeSession
    ? getDepartmentById(activeSession.lead_department)
    : null;

  return (
    <div className="boardroom-root">
      {/* 1. Barra Superior & Convocação */}
      <section className="boardroom-topbar">
        <div className="boardroom-topbar-header">
          <div className="boardroom-title-block">
            <h2>
              <Building2 size={20} /> Conselho Executivo (Boardroom)
            </h2>
            <p>
              Convoque uma diretoria para diagnosticar o projeto, edite a
              proposta contra alucinações, colha pareceres cruzados e dispare a
              especificação final para o Copilot.
            </p>
          </div>

          <div className="boardroom-project-controls">
            <div className="boardroom-project-picker">
              <label htmlFor="boardroom-project-select">Projeto Alvo:</label>
              <select
                id="boardroom-project-select"
                className="project-select"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setFocusContext('');
                  setStatusFeedback(null);
                  setErrorMessage(null);
                }}
              >
                {BOARDROOM_PROJECTS.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="repomix-context-bar">
              {loadingContext ? (
                <span className="repomix-badge repomix-badge-empty">
                  <Loader2 size={12} className="spin" /> Verificando snapshot...
                </span>
              ) : projectContext ? (
                <>
                  <span className="repomix-badge repomix-badge-active">
                    Contexto Real Ativo (~
                    {projectContext.token_count.toLocaleString('pt-BR')} tokens •
                    Atualizado em {formatContextDate(projectContext.updated_at)})
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost repomix-sync-btn"
                    disabled={syncingRepomix}
                    onClick={() => void handleSyncRepomix()}
                  >
                    <RefreshCw
                      size={12}
                      className={syncingRepomix ? 'spin' : undefined}
                    />
                    {syncingRepomix
                      ? 'Atualizando...'
                      : 'Atualizar Código (Repomix)'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="repomix-badge repomix-badge-empty repomix-badge-clickable"
                  disabled={syncingRepomix}
                  onClick={() => void handleSyncRepomix()}
                >
                  {syncingRepomix ? (
                    <>
                      <Loader2 size={12} className="spin" /> Indexando via
                      Repomix...
                    </>
                  ) : (
                    'Sem snapshot de código (Clique para indexar via Repomix)'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="boardroom-focus-row">
          <input
            type="text"
            className="boardroom-focus-input"
            value={focusContext}
            onChange={(e) => setFocusContext(e.target.value)}
            placeholder="Direcionamento ou problema específico para esta reunião... (opcional)"
          />
        </div>

        <div className="departments-grid">
          {EXECUTIVE_DEPARTMENTS.map((dept) => {
            const isLead = activeSession?.lead_department === dept.id;
            const isGeneratingThis = generatingDept === dept.id;

            return (
              <button
                key={dept.id}
                type="button"
                className={`dept-card ${isLead ? 'is-lead' : ''}`}
                style={{
                  borderColor: isLead ? dept.accentColor : undefined,
                  background: isLead ? dept.accentBg : undefined,
                }}
                disabled={generatingDept !== null}
                onClick={() => void handleSummonDepartment(dept.id)}
              >
                <div className="dept-card-top">
                  <span
                    className="dept-icon-badge"
                    style={{
                      color: dept.accentColor,
                      background: dept.accentBg,
                      borderColor: dept.accentBorder,
                    }}
                  >
                    {isGeneratingThis ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <DepartmentIcon iconName={dept.iconName} size={16} />
                    )}
                  </span>
                  <span className="dept-card-name">{dept.name}</span>
                  {isLead && (
                    <span
                      className="dept-lead-pill"
                      style={{
                        color: dept.accentColor,
                        borderColor: dept.accentBorder,
                      }}
                    >
                      Líder
                    </span>
                  )}
                </div>
                <p className="dept-card-desc">{dept.focusSummary}</p>
              </button>
            );
          })}
        </div>
      </section>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}
      {(generatingDept !== null || generatingReviews) && (
        <div className="status-banner">
          <Loader2 size={15} className="spin" />
          <span>
            {generatingDept !== null
              ? `Consultando ${getDepartmentById(generatingDept).name} via Gemini (com fallback automático)...`
              : 'Consultando diretorias para parecer cruzado via Gemini...'}
          </span>
        </div>
      )}
      {statusFeedback && (
        <div className="status-banner">
          <Sparkles size={15} />
          <span>{statusFeedback}</span>
        </div>
      )}

      {/* 2. Área Central — Dossiê Editável & Pareceres Cruzados */}
      {loadingSession ? (
        <div className="empty-state">
          <Loader2 size={20} className="spin" /> Carregando sessão do Conselho...
        </div>
      ) : !activeSession ? (
        <div className="empty-state boardroom-empty">
          <Users size={26} style={{ opacity: 0.65, marginBottom: 8 }} />
          <div>
            <strong>Nenhuma reunião em rascunho para {selectedProjectId}.</strong>
          </div>
          <div style={{ marginTop: 4 }}>
            Clique em uma das 6 cadeiras executivas acima para gerar a proposta
            inicial via Gemini 3.8 Flash.
          </div>
        </div>
      ) : (
        <div className="boardroom-workspace">
          <section className="dossier-panel">
            <div className="dossier-header">
              <div className="dossier-title-group">
                {leadDeptConfig && (
                  <span
                    className="dept-icon-badge"
                    style={{
                      color: leadDeptConfig.accentColor,
                      background: leadDeptConfig.accentBg,
                      borderColor: leadDeptConfig.accentBorder,
                    }}
                  >
                    <DepartmentIcon
                      iconName={leadDeptConfig.iconName}
                      size={18}
                    />
                  </span>
                )}
                <div>
                  <h3>
                    Dossiê da Diretoria Líder:{' '}
                    <span style={{ color: leadDeptConfig?.accentColor }}>
                      {leadDeptConfig?.name}
                    </span>
                  </h3>
                  <span className="dossier-subtitle">
                    Revise e edite livremente o texto abaixo para eliminar
                    alucinações antes de solicitar pareceres ou aprovar.
                  </span>
                </div>
              </div>

              <div className="dossier-actions">
                {hasUnsavedProposalChanges && (
                  <span className="unsaved-pill">
                    <AlertCircle size={13} /> Alterações não salvas
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleSaveProposalEdits()}
                  disabled={savingProposal || !hasUnsavedProposalChanges}
                >
                  {savingProposal ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  Salvar Ajustes
                </button>
              </div>
            </div>

            <textarea
              className="dossier-editor"
              rows={15}
              value={proposalDraft}
              onChange={(e) => setProposalDraft(e.target.value)}
              placeholder="Conteúdo da proposta executiva..."
            />

            {/* Solicitar Parecer das Outras Áreas */}
            <div className="peer-request-bar">
              <div className="peer-request-info">
                <strong>Solicitar Parecer das Outras Áreas:</strong>
                <div className="peer-chips">
                  {remainingDepartments.map((dept) => {
                    const checked = selectedReviewDepts.includes(dept.id);
                    return (
                      <button
                        key={dept.id}
                        type="button"
                        className={`peer-chip ${checked ? 'selected' : ''}`}
                        style={
                          checked
                            ? {
                                borderColor: dept.accentColor,
                                background: dept.accentBg,
                                color: '#fff',
                              }
                            : undefined
                        }
                        onClick={() => toggleReviewDepartment(dept.id)}
                      >
                        <DepartmentIcon iconName={dept.iconName} size={13} />
                        {dept.shortName}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      setSelectedReviewDepts(
                        selectedReviewDepts.length === remainingDepartments.length
                          ? []
                          : remainingDepartments.map((d) => d.id)
                      )
                    }
                  >
                    {selectedReviewDepts.length === remainingDepartments.length
                      ? 'Limpar'
                      : 'Todas as 5'}
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ai"
                disabled={
                  generatingReviews || selectedReviewDepts.length === 0
                }
                onClick={() => void handleRequestPeerReviews()}
              >
                {generatingReviews ? (
                  <>
                    <Loader2 size={15} className="spin" /> Consultando
                    Diretorias...
                  </>
                ) : (
                  <>
                    <Users size={15} /> Solicitar Parecer (
                    {selectedReviewDepts.length})
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Painel de Pareceres Cruzados */}
          {peerReviews.length > 0 && (
            <section className="peer-reviews-section">
              <div className="peer-reviews-header">
                <h3>Pareceres Cruzados ({peerReviews.length})</h3>
                <span>
                  Edite ou remova pareceres individuais antes de compilar a
                  missão final.
                </span>
              </div>

              <div className="peer-reviews-grid">
                {peerReviews.map((review) => {
                  const dept = getDepartmentById(review.department);
                  const isEditing = editingReviewId === review.id;

                  return (
                    <article
                      key={review.id}
                      className="peer-review-card"
                      style={{ borderTopColor: dept.accentColor }}
                    >
                      <div className="peer-review-card-header">
                        <div className="peer-review-dept">
                          <span
                            className="dept-icon-badge"
                            style={{
                              color: dept.accentColor,
                              background: dept.accentBg,
                              borderColor: dept.accentBorder,
                            }}
                          >
                            <DepartmentIcon
                              iconName={dept.iconName}
                              size={14}
                            />
                          </span>
                          <div>
                            <strong>{dept.name}</strong>
                            <div className="peer-review-role">
                              {dept.roleTitle}
                            </div>
                          </div>
                        </div>

                        <div className="peer-review-actions">
                          {!isEditing && (
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              title="Editar parecer"
                              onClick={() => handleStartEditReview(review)}
                            >
                              <Edit3 size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-danger-ghost"
                            title="Excluir parecer"
                            onClick={() => void handleDeleteReview(review.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="peer-review-edit-box">
                          <textarea
                            rows={6}
                            value={editingReviewText}
                            onChange={(e) =>
                              setEditingReviewText(e.target.value)
                            }
                          />
                          <div className="peer-review-edit-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => setEditingReviewId(null)}
                            >
                              <X size={13} /> Cancelar
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-exec"
                              onClick={() =>
                                void handleSaveEditReview(review.id)
                              }
                            >
                              <Check size={13} /> Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="peer-review-content">
                          {review.content}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* 3. Barra de Decisão & Disparo para o Copilot */}
          <section className="decision-bar">
            <div className="decision-summary">
              <strong>Pronto para Execução?</strong>
              <span>
                Compila o dossiê editado + {peerReviews.length} parecer(es) e
                envia para <code>missions</code> ({selectedProject.agentId}) com{' '}
                <code>status = PENDING</code>.
              </span>
            </div>

            <div className="decision-actions">
              <button
                type="button"
                className="btn btn-danger-ghost"
                disabled={discardingDraft || approvingMission}
                onClick={() => void handleDiscardDraft()}
              >
                {discardingDraft ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Trash2 size={15} />
                )}
                Descartar Rascunho
              </button>

              <button
                type="button"
                className="btn btn-exec"
                disabled={approvingMission || discardingDraft}
                onClick={() => void handleApproveAndDispatch()}
              >
                {approvingMission ? (
                  <>
                    <Loader2 size={15} className="spin" /> Disparando...
                  </>
                ) : (
                  <>
                    <Rocket size={15} /> Aprovar & Disparar para Copilot
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Histórico Colapsável de Decisões Aprovadas */}
      <section className="boardroom-history">
        <button
          type="button"
          className="history-toggle"
          onClick={() => setHistoryOpen((prev) => !prev)}
        >
          <span className="history-toggle-left">
            {historyOpen ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
            <History size={16} />
            Histórico de Decisões Aprovadas — {selectedProjectId} (
            {approvedHistory.length})
          </span>
          <span className="history-toggle-hint">
            {historyOpen ? 'Ocultar' : 'Expandir'}
          </span>
        </button>

        {historyOpen && (
          <div className="history-list">
            {approvedHistory.length === 0 ? (
              <div className="empty-state">
                Nenhuma decisão aprovada registrada para {selectedProjectId}.
              </div>
            ) : (
              approvedHistory.map((item) => {
                const dept = getDepartmentById(item.lead_department);
                const isExpanded = expandedHistoryId === item.id;
                const dateLabel = new Date(
                  item.updated_at || item.created_at
                ).toLocaleString('pt-BR');

                return (
                  <div key={item.id} className="history-item">
                    <button
                      type="button"
                      className="history-item-header"
                      onClick={() =>
                        setExpandedHistoryId(isExpanded ? null : item.id)
                      }
                    >
                      <div className="history-item-meta">
                        <span
                          className="dept-lead-pill"
                          style={{
                            color: dept.accentColor,
                            borderColor: dept.accentBorder,
                          }}
                        >
                          {dept.name}
                        </span>
                        <span className="history-item-focus">
                          {item.focus_context ||
                            'Sessão executiva sem direcionamento específico'}
                        </span>
                      </div>
                      <span className="history-item-date">{dateLabel}</span>
                    </button>

                    {isExpanded && (
                      <pre className="history-item-spec">
                        {item.final_spec || item.proposal_text}
                      </pre>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}
