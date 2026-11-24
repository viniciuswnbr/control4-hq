export interface StrategicPromptItem {
  id: string;
  template: string;
}

export interface StrategicCategory {
  id: string;
  title: string;
  focus: string;
  description: string;
  prompts: StrategicPromptItem[];
}

export interface ProjectOption {
  id: string;
  label: string;
  agentId: string;
}

export const STRATEGIC_PROJECTS: ProjectOption[] = [
  { id: 'centuria-dashboard', label: 'centuria-dashboard', agentId: 'centuria-dashboard' },
  { id: 'cotocopositivo', label: 'cotocopositivo', agentId: 'cotocopositivo' },
  { id: 'ct4', label: 'ct4', agentId: 'control4-sistemas' },
  { id: 'IAExplicaBot', label: 'IAExplicaBot', agentId: 'ia-explica-bot' },
  { id: 'invest', label: 'invest', agentId: 'invest-scripts' },
  { id: 'juliana', label: 'juliana', agentId: 'juliana-revendas' },
  { id: 'notionLocalhost', label: 'notionLocalhost', agentId: 'notion-localhost' },
  { id: 'POC_Investimentos', label: 'POC_Investimentos', agentId: 'invest-scripts' },
];

export const STRATEGIC_CATEGORIES: StrategicCategory[] = [
  {
    id: 'improve-optimize',
    title: 'Para melhorar e otimizar',
    focus: 'Foco em qualidade',
    description: 'Identifique falhas ocultas, gargalos operacionais, quick wins e objeções críticas.',
    prompts: [
      {
        id: 'blind-spots',
        template: 'Liste 10 pontos cegos ou falhas ocultas no projeto {PROJETO}...',
      },
      {
        id: 'bottlenecks',
        template: 'Liste 10 gargalos ou etapas desnecessárias no projeto {PROJETO}...',
      },
      {
        id: 'quick-wins',
        template: 'Liste 10 melhorias de alto impacto e baixo esforço (quick wins) para o projeto {PROJETO}...',
      },
      {
        id: 'objections',
        template: 'Liste 10 objeções que um crítico ou cliente faria sobre o projeto {PROJETO}...',
      },
    ],
  },
  {
    id: 'create-expand',
    title: 'Para criar e expandir',
    focus: 'Foco em inovação',
    description: 'Explore ideias não convencionais, metáforas, tendências futuras e novas combinações.',
    prompts: [
      {
        id: 'out-of-box',
        template: 'Liste 10 ideias fora da caixa e não convencionais para o projeto {PROJETO}...',
      },
      {
        id: 'analogies',
        template: 'Liste 10 analogias ou metáforas para explicar o valor do projeto {PROJETO}...',
      },
      {
        id: 'future-trends',
        template: 'Liste 10 tendências futuras que podem afetar o projeto {PROJETO}...',
      },
      {
        id: 'combinations',
        template: 'Liste 10 formas de combinar o projeto {PROJETO} com outras ferramentas ou modelos de negócio...',
      },
    ],
  },
  {
    id: 'execute-structure',
    title: 'Para executar e estruturar',
    focus: 'Foco em ação',
    description: 'Estruture roadmaps cronológicos, KPIs, ferramentas open-source e validações.',
    prompts: [
      {
        id: 'chronological-steps',
        template: 'Liste 10 passos cronológicos para sair do zero até o próximo nível no projeto {PROJETO}...',
      },
      {
        id: 'kpis',
        template: 'Liste 10 métricas ou indicadores de sucesso (KPIs) para avaliar o projeto {PROJETO}...',
      },
      {
        id: 'opensource-tools',
        template: 'Liste 10 ferramentas, recursos ou templates open-source para acelerar o projeto {PROJETO}...',
      },
      {
        id: 'validation-questions',
        template: 'Liste 10 perguntas essenciais de validação antes de avançar no projeto {PROJETO}...',
      },
    ],
  },
  {
    id: 'communicate-persuade',
    title: 'Para comunicação e persuasão',
    focus: 'Foco em público',
    description: 'Mapeie dores ocultas, hooks de atenção e variações de tom para o público.',
    prompts: [
      {
        id: 'hidden-pains',
        template: 'Liste 10 dores ou desejos ocultos do público-alvo do projeto {PROJETO}...',
      },
      {
        id: 'hooks',
        template: 'Liste 10 ganchos (hooks) ou títulos chamativos para divulgar o projeto {PROJETO}...',
      },
      {
        id: 'communication-tones',
        template: 'Liste 10 formas diferentes de comunicar a proposta do projeto {PROJETO}, variando o tom (do técnico ao bem-humorado)...',
      },
    ],
  },
];
