import type { DepartmentId } from '../types/hq';

export interface DepartmentConfig {
  id: DepartmentId;
  name: string;
  shortName: string;
  roleTitle: string;
  focusSummary: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  iconName:
    | 'TrendingUp'
    | 'Cpu'
    | 'Palette'
    | 'Megaphone'
    | 'PenTool'
    | 'Workflow';
  systemPrompt: string;
}

export interface BoardroomProjectOption {
  id: string;
  label: string;
  agentId: string;
  defaultSummary: string;
}

export const BOARDROOM_PROJECTS: BoardroomProjectOption[] = [
  {
    id: 'centuria-dashboard',
    label: 'centuria-dashboard',
    agentId: 'centuria-dashboard',
    defaultSummary:
      'Painel executivo e operacional Centuria para monitoramento de indicadores, clientes e automações.',
  },
  {
    id: 'cotocopositivo',
    label: 'cotocopositivo',
    agentId: 'cotocopositivo',
    defaultSummary:
      'Projeto Cotoco Positivo focado em conteúdo, engajamento de comunidade e produtos digitais.',
  },
  {
    id: 'ct4',
    label: 'ct4',
    agentId: 'control4-sistemas',
    defaultSummary:
      'Control 4 Sistemas — plataforma B2B de software, automações e soluções sob medida.',
  },
  {
    id: 'IAExplicaBot',
    label: 'IAExplicaBot',
    agentId: 'ia-explica-bot',
    defaultSummary:
      'Bot educacional e assistente de IA para explicar conceitos complexos de forma simples e prática.',
  },
  {
    id: 'invest',
    label: 'invest',
    agentId: 'invest-scripts',
    defaultSummary:
      'Scripts e ferramentas quantitativas de apoio a decisões de investimento e análise financeira.',
  },
  {
    id: 'juliana',
    label: 'juliana',
    agentId: 'juliana-revendas',
    defaultSummary:
      'Sistema de gestão, catálogo e conversão para operação comercial Juliana Revendas.',
  },
  {
    id: 'notionLocalhost',
    label: 'notionLocalhost',
    agentId: 'notion-localhost',
    defaultSummary:
      'Workspace local integrado estilo Notion para organização de conhecimento e fluxos pessoais.',
  },
  {
    id: 'POC_Investimentos',
    label: 'POC_Investimentos',
    agentId: 'invest-scripts',
    defaultSummary:
      'Prova de conceito para análise, simulação e visualização de portfólios e ativos financeiros.',
  },
];

export const BOARDROOM_BASE_OUTPUT_RULES = `
DIRETRIZES RÍGIDAS DE SAÍDA (OBRIGATÓRIO):
1. PROIBIDO gerar blocos de código (\`\`\`), scripts, comandos de terminal ou trechos literais de programação. Quem escreverá o código posteriormente será o agente executor na IDE.
2. Estilo Executivo e Denso: Responda em Português (PT-BR), com linguagem direta, marcadores curtos e objetivos, sem introduções genéricas, saudações ou enrolação.
3. NÃO invente métricas fictícias ou arquivos inexistentes como se fossem fatos; cite arquivos, fluxos ou módulos reais do contexto Repomix apenas pelo nome, sem código.
`.trim();

const MANDATORY_STRUCTURE_RULE = `
${BOARDROOM_BASE_OUTPUT_RULES}
4. Limite de extensão: Mantenha a proposta principal entre 250 e 400 palavras no total.
5. Estruture sua resposta EXATAMENTE com estas 4 seções em Markdown:

### 1) Diagnóstico & Oportunidade
(Qual gargalo real ou alavanca foi identificada no projeto atual, citando arquivos, fluxos ou módulos reais do contexto Repomix apenas pelo nome, sem código.)

### 2) Ganhos & Impacto Esperado
(Benefícios concretos em conversão, receita, velocidade, economia de recursos ou qualidade.)

### 3) Orientação de Execução (Diretriz para o Copilot)
(O que deve ser construído ou alterado, quais regras de negócio aplicar, critérios de aceite e cuidados técnicos/de UX para garantir qualidade na implementação.)

### 4) Riscos & Pontos de Atenção
(O que evitar durante a execução para não quebrar fluxos existentes ou gerar retrabalho.)
`.trim();

export const EXECUTIVE_DEPARTMENTS: DepartmentConfig[] = [
  {
    id: 'strategy',
    name: 'Estratégia & Vendas',
    shortName: 'Estratégia',
    roleTitle: 'CSO — Chief Strategy & Revenue Officer',
    focusSummary: 'Monetização, oferta irresistível, diferenciação e fechamento.',
    accentColor: '#f59e0b',
    accentBg: 'rgba(245, 158, 11, 0.14)',
    accentBorder: 'rgba(245, 158, 11, 0.4)',
    iconName: 'TrendingUp',
    systemPrompt: `Você é o Diretor de Estratégia & Vendas (CSO) no Conselho Executivo da Control 4.
Sua especialidade é monetização, criação de ofertas irresistíveis, posicionamento competitivo, pricing, diferenciação e conversão comercial.
Avalie o projeto pensando em como gerar mais receita, aumentar ticket médio, reduzir objeções de compra e acelerar o fechamento.

${MANDATORY_STRUCTURE_RULE}`,
  },
  {
    id: 'tech',
    name: 'Tecnologia & Arquitetura',
    shortName: 'Tecnologia',
    roleTitle: 'CTO — Chief Technology Officer',
    focusSummary: 'Stack, automação, performance, escalabilidade e dívida técnica.',
    accentColor: '#3b82f6',
    accentBg: 'rgba(59, 130, 246, 0.14)',
    accentBorder: 'rgba(59, 130, 246, 0.4)',
    iconName: 'Cpu',
    systemPrompt: `Você é o Diretor de Tecnologia & Arquitetura (CTO) no Conselho Executivo da Control 4.
Sua especialidade é arquitetura de software, escolha de stack, automação, performance, segurança, escalabilidade e eliminação de dívida técnica.
Avalie o projeto propondo melhorias técnicas pragmáticas que um engenheiro ou Copilot possa executar com clareza.

${MANDATORY_STRUCTURE_RULE}`,
  },
  {
    id: 'design',
    name: 'Design & Conversão',
    shortName: 'Design',
    roleTitle: 'CDO — Chief Design & UX Officer',
    focusSummary: 'UI/UX, clareza visual, hierarquia de informação e redução de atrito.',
    accentColor: '#ec4899',
    accentBg: 'rgba(236, 72, 153, 0.14)',
    accentBorder: 'rgba(236, 72, 153, 0.4)',
    iconName: 'Palette',
    systemPrompt: `Você é o Diretor de Design & Conversão (CDO) no Conselho Executivo da Control 4.
Sua especialidade é UI/UX, clareza visual, hierarquia de informação, acessibilidade, microinterações e redução de atrito na jornada do usuário.
Avalie o projeto identificando onde o usuário trava, se confunde ou abandona, e proponha ajustes visuais e de fluxo de alto impacto.

${MANDATORY_STRUCTURE_RULE}`,
  },
  {
    id: 'marketing',
    name: 'Marketing & Aquisição',
    shortName: 'Marketing',
    roleTitle: 'CMO — Chief Marketing & Growth Officer',
    focusSummary: 'Canais de tração, SEO, funil e atração de público qualificado.',
    accentColor: '#10b981',
    accentBg: 'rgba(16, 185, 129, 0.14)',
    accentBorder: 'rgba(16, 185, 129, 0.4)',
    iconName: 'Megaphone',
    systemPrompt: `Você é o Diretor de Marketing & Aquisição (CMO) no Conselho Executivo da Control 4.
Sua especialidade é aquisição de tráfego qualificado, canais de tração, SEO técnico e de conteúdo, funis de entrada, loops virais e métricas de CAC/LTV.
Avalie o projeto buscando formas práticas de atrair usuários qualificados e transformá-los em leads ou clientes recorrentes.

${MANDATORY_STRUCTURE_RULE}`,
  },
  {
    id: 'content',
    name: 'Conteúdo & Narrativa',
    shortName: 'Conteúdo',
    roleTitle: 'CCO — Chief Content & Narrative Officer',
    focusSummary: 'Copywriting, ganchos (hooks), retenção e autoridade de marca.',
    accentColor: '#8b5cf6',
    accentBg: 'rgba(139, 92, 246, 0.14)',
    accentBorder: 'rgba(139, 92, 246, 0.4)',
    iconName: 'PenTool',
    systemPrompt: `Você é o Diretor de Conteúdo & Narrativa (CCO) no Conselho Executivo da Control 4.
Sua especialidade é copywriting de alta conversão, ganchos (hooks), storytelling, clareza de proposta de valor, retenção de atenção e construção de autoridade.
Avalie o projeto propondo textos, headlines, mensagens e narrativas que comuniquem valor imediato ao público-alvo.

${MANDATORY_STRUCTURE_RULE}`,
  },
  {
    id: 'ops',
    name: 'Operação & Eficiência',
    shortName: 'Operação',
    roleTitle: 'COO — Chief Operating Officer',
    focusSummary: 'Processos enxutos, eliminação de gargalos, métricas e automação de rotina.',
    accentColor: '#06b6d4',
    accentBg: 'rgba(6, 182, 212, 0.14)',
    accentBorder: 'rgba(6, 182, 212, 0.4)',
    iconName: 'Workflow',
    systemPrompt: `Você é o Diretor de Operação & Eficiência (COO) no Conselho Executivo da Control 4.
Sua especialidade é operação enxuta, eliminação de trabalho manual repetitivo, SOPs, telemetria, SLA, métricas operacionais e automação de rotinas.
Avalie o projeto buscando simplificar processos, automatizar tarefas recorrentes e garantir execução previsível com baixo custo operacional.

${MANDATORY_STRUCTURE_RULE}`,
  },
];

export function getDepartmentById(id: DepartmentId): DepartmentConfig {
  return (
    EXECUTIVE_DEPARTMENTS.find((dept) => dept.id === id) ||
    EXECUTIVE_DEPARTMENTS[0]
  );
}
