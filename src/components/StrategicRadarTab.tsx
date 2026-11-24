import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Radar, Sparkles, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  STRATEGIC_CATEGORIES,
  STRATEGIC_PROJECTS,
  type StrategicCategory,
  type StrategicPromptItem,
} from '../data/strategicPrompts';
import type { StrategicIdea } from '../types/hq';

interface StrategicRadarTabProps {
  onMissionCreated?: () => void;
}

function getIdeaLabel(idea: StrategicIdea): string {
  return (
    idea.idea_text ||
    idea.title ||
    idea.description ||
    idea.content ||
    '(Ideia sem descrição)'
  );
}

export function StrategicRadarTab({ onMissionCreated }: StrategicRadarTabProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    STRATEGIC_PROJECTS[0].id
  );
  const [selectedCategory, setSelectedCategory] = useState<StrategicCategory>(
    STRATEGIC_CATEGORIES[0]
  );
  const [selectedPrompt, setSelectedPrompt] = useState<StrategicPromptItem>(
    STRATEGIC_CATEGORIES[0].prompts[0]
  );

  const [ideas, setIdeas] = useState<StrategicIdea[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const selectedProject = useMemo(
    () =>
      STRATEGIC_PROJECTS.find((p) => p.id === selectedProjectId) ||
      STRATEGIC_PROJECTS[0],
    [selectedProjectId]
  );

  const fetchPendingIdeas = useCallback(async () => {
    setLoadingIdeas(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from('hq_strategic_ideas')
      .select('*')
      .eq('project_id', selectedProjectId)
      .eq('prompt_template', selectedPrompt.template)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMessage(
        `Erro ao carregar ideias de hq_strategic_ideas: ${error.message}`
      );
      setIdeas([]);
    } else {
      setIdeas((data as StrategicIdea[]) || []);
    }
    setLoadingIdeas(false);
  }, [selectedProjectId, selectedPrompt.template]);

  useEffect(() => {
    void fetchPendingIdeas();
  }, [fetchPendingIdeas]);

  useEffect(() => {
    const channel = supabase
      .channel(`strategic-radar-${selectedProjectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hq_strategic_ideas' },
        () => {
          void fetchPendingIdeas();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchPendingIdeas, selectedProjectId]);

  useEffect(() => {
    if (!isGenerating) return;
    const interval = window.setInterval(() => {
      void fetchPendingIdeas();
    }, 3000);
    const timeout = window.setTimeout(() => {
      setIsGenerating(false);
    }, 45000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [isGenerating, fetchPendingIdeas]);

  const handleSelectPrompt = (
    category: StrategicCategory,
    prompt: StrategicPromptItem
  ) => {
    setSelectedCategory(category);
    setSelectedPrompt(prompt);
    setStatusFeedback(null);
  };

  const handleGenerateNewIdeas = async () => {
    setErrorMessage(null);
    setStatusFeedback('Gerando 10 novas ideias...');
    setIsGenerating(true);

    const payload = {
      project_id: selectedProjectId,
      category: selectedCategory.title,
      prompt_template: selectedPrompt.template,
    };

    const { error } = await supabase.from('missions').insert({
      agent_id: selectedProject.agentId,
      task_type: 'FEATURE',
      raw_idea: `[GENERATE_IDEAS] ${JSON.stringify(payload)}`,
      status: 'PENDING',
    });

    if (error) {
      setIsGenerating(false);
      setStatusFeedback(null);
      setErrorMessage(
        `Falha ao enfileirar geração de ideias: ${error.message}`
      );
      return;
    }

    onMissionCreated?.();
  };

  const handleImplementIdea = async (idea: StrategicIdea) => {
    const ideaText = getIdeaLabel(idea);
    // Remoção otimista imediata da lista de pendentes
    setIdeas((prev) => prev.filter((item) => item.id !== idea.id));
    setErrorMessage(null);

    const { error: updateError } = await supabase
      .from('hq_strategic_ideas')
      .update({ status: 'implemented' })
      .eq('id', idea.id);

    if (updateError) {
      setErrorMessage(
        `Erro ao atualizar ideia para implemented: ${updateError.message}`
      );
      void fetchPendingIdeas();
      return;
    }

    const missionInstruction = `[Radar Estratégico • ${selectedProjectId}] ${ideaText}`;
    const { error: missionError } = await supabase.from('missions').insert({
      agent_id: selectedProject.agentId,
      task_type: 'FEATURE',
      raw_idea: missionInstruction,
      status: 'PENDING',
    });

    if (missionError) {
      setErrorMessage(
        `Ideia marcada como implementada, mas houve erro ao criar missão: ${missionError.message}`
      );
      return;
    }

    setStatusFeedback(
      `Missão criada para ${selectedProjectId} e enviada para a fila da IDE.`
    );
    onMissionCreated?.();
  };

  const handleDiscardIdea = async (ideaId: string) => {
    setIdeas((prev) => prev.filter((item) => item.id !== ideaId));
    setErrorMessage(null);

    const { error } = await supabase
      .from('hq_strategic_ideas')
      .update({ status: 'discarded' })
      .eq('id', ideaId);

    if (error) {
      setErrorMessage(`Erro ao descartar ideia: ${error.message}`);
      void fetchPendingIdeas();
    }
  };

  const resolvedPromptPreview = selectedPrompt.template.replace(
    '{PROJETO}',
    selectedProjectId
  );

  return (
    <div>
      <div className="radar-toolbar">
        <div className="radar-toolbar-left">
          <h2>
            <Radar size={19} /> Radar Estratégico
          </h2>
          <p>
            Selecione um projeto e um gatilho estratégico para gerar e priorizar
            ideias acionáveis diretamente na fila do agente local.
          </p>
        </div>

        <div className="radar-controls">
          <label
            htmlFor="radar-project-select"
            style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}
          >
            Projeto Alvo:
          </label>
          <select
            id="radar-project-select"
            className="project-select"
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setIsGenerating(false);
              setStatusFeedback(null);
            }}
          >
            {STRATEGIC_PROJECTS.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-ai"
            onClick={() => void handleGenerateNewIdeas()}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 size={15} className="spin" />
                Gerando 10 novas ideias...
              </>
            ) : (
              <>
                <Sparkles size={15} />
                Listar Novas
              </>
            )}
          </button>
        </div>
      </div>

      <div className="radar-layout">
        <div className="categories-grid">
          {STRATEGIC_CATEGORIES.map((category) => (
            <section key={category.id} className="category-card">
              <div className="category-header">
                <h3 className="category-title">{category.title}</h3>
                <span className="category-focus">{category.focus}</span>
              </div>
              <p className="category-desc">{category.description}</p>
              <div className="prompts-list">
                {category.prompts.map((prompt) => {
                  const isSelected = selectedPrompt.id === prompt.id;
                  const formatted = prompt.template.replace(
                    '{PROJETO}',
                    selectedProjectId
                  );
                  return (
                    <button
                      key={prompt.id}
                      type="button"
                      className={`prompt-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectPrompt(category, prompt)}
                    >
                      {formatted}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="ideas-panel">
          <div className="ideas-panel-header">
            <div>
              <h3 className="ideas-panel-title">{resolvedPromptPreview}</h3>
              <div className="ideas-panel-meta">
                {selectedCategory.title} • Projeto:{' '}
                <strong>{selectedProjectId}</strong> • Pendentes:{' '}
                <strong>{ideas.length}</strong>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ai"
              onClick={() => void handleGenerateNewIdeas()}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Listar Novas
            </button>
          </div>

          {isGenerating && (
            <div className="status-banner">
              <Loader2 size={15} className="spin" />
              <span>
                Gerando 10 novas ideias... O shev-bridge.py está processando com IA
                e salvará os itens aqui automaticamente.
              </span>
            </div>
          )}

          {!isGenerating && statusFeedback && (
            <div className="status-banner">
              <span>{statusFeedback}</span>
            </div>
          )}

          {errorMessage && <div className="error-banner">{errorMessage}</div>}

          <div className="ideas-list">
            {loadingIdeas && ideas.length === 0 ? (
              <div className="empty-state">Carregando ideias pendentes...</div>
            ) : ideas.length === 0 ? (
              <div className="empty-state">
                Nenhuma ideia pendente para este gatilho em{' '}
                <strong>{selectedProjectId}</strong>.
                <br />
                Clique em <strong>Listar Novas</strong> para gerar 10 sugestões.
              </div>
            ) : (
              ideas.map((idea) => (
                <div key={idea.id} className="idea-card">
                  <div className="idea-card-text">{getIdeaLabel(idea)}</div>
                  <div className="idea-card-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-ghost"
                      onClick={() => void handleDiscardIdea(idea.id)}
                      title="Descartar ideia"
                    >
                      <Trash2 size={13} />
                      Descartar
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-exec"
                      onClick={() => void handleImplementIdea(idea)}
                    >
                      <Play size={13} />
                      Implementar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
