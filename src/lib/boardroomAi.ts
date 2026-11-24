import { getDepartmentById } from '../data/departments';
import type { DepartmentId } from '../types/hq';

export const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash',
] as const;

const RETRYABLE_STATUS_CODES = new Set([503, 429, 404]);

function getGeminiEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export interface ProposeInput {
  projectId: string;
  department: DepartmentId;
  focusContext: string;
  projectSummary: string;
}

export interface ProposeResult {
  text: string;
  model: string;
}

export interface PeerReviewInput {
  projectId: string;
  leadDepartment: DepartmentId;
  currentProposal: string;
  reviewingDepartments: DepartmentId[];
  projectSummary?: string;
}

export interface PeerReviewResult {
  department: DepartmentId;
  content: string;
  model: string;
}

interface GeminiCallResult {
  text: string;
  model: string;
}

export function getBoardroomGeminiKey(): string {
  const envKey = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();
  if (envKey) return envKey;
  if (typeof window !== 'undefined') {
    return (window.localStorage.getItem('HQ_GEMINI_KEY') || '').trim();
  }
  return '';
}

async function callGeminiFlash(
  systemInstruction: string,
  userPrompt: string,
  temperature = 0.55
): Promise<GeminiCallResult> {
  const apiKey = getBoardroomGeminiKey();
  if (!apiKey) {
    throw new Error(
      'Chave Gemini não encontrada. Configure VITE_GEMINI_API_KEY na Vercel/.env ou adicione em "🔑 API Auditor".'
    );
  }

  let lastError: Error | null = null;

  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    const isLastAttempt = i === GEMINI_MODELS.length - 1;

    const response = await fetch(
      `${getGeminiEndpoint(model)}?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    if (!response.ok) {
      const errorMsg =
        payload?.error?.message ||
        `Erro HTTP ${response.status} na API Gemini (${model}).`;
      if (RETRYABLE_STATUS_CODES.has(response.status) && !isLastAttempt) {
        lastError = new Error(errorMsg);
        continue;
      }
      throw new Error(errorMsg);
    }

    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new Error(`A API Gemini (${model}) retornou uma resposta vazia.`);
    }

    return { text, model };
  }

  throw lastError ?? new Error('Falha ao consultar os modelos Gemini.');
}

export async function runBoardroomPropose(
  input: ProposeInput
): Promise<ProposeResult> {
  const dept = getDepartmentById(input.department);
  const focusBlock = input.focusContext.trim()
    ? input.focusContext.trim()
    : 'Nenhum direcionamento específico informado. Foque na alavanca de maior retorno imediato para este projeto.';

  const userPrompt = `PROJETO ALVO: ${input.projectId}

CONTEXTO DO PROJETO:
${input.projectSummary}

DIRECIONAMENTO DA REUNIÃO:
${focusBlock}

Elabore sua proposta executiva completa seguindo rigorosamente as 4 seções obrigatórias.`;

  return callGeminiFlash(dept.systemPrompt, userPrompt, 0.55);
}

export async function runBoardroomPeerReview(
  input: PeerReviewInput
): Promise<PeerReviewResult[]> {
  const leadDept = getDepartmentById(input.leadDepartment);

  const tasks = input.reviewingDepartments.map(async (reviewDeptId) => {
    const reviewer = getDepartmentById(reviewDeptId);

    const systemInstruction = `Você é o ${reviewer.roleTitle} (${reviewer.name}) participando de uma reunião do Conselho Executivo da Control 4.
Seu foco exclusivo é: ${reviewer.focusSummary}
Você está revisando uma proposta já validada/editada pelo usuário, originalmente liderada pela diretoria de ${leadDept.name}.
Seja objetivo, construtivo, direto e sem repetir o que já está bom. Responda em Português (PT-BR) usando exatamente estes 3 tópicos curtos em Markdown:
- **Complemento da Área:** (como sua área potencializa a proposta)
- **Risco / Ponto Cego:** (o que pode falhar ou foi ignorado sob sua ótica)
- **Ajuste Recomendado:** (1 ação prática para incorporar na especificação técnica final)`;

    const userPrompt = `PROJETO ALVO: ${input.projectId}
${input.projectSummary ? `CONTEXTO DO PROJETO: ${input.projectSummary}\n` : ''}
PROPOSTA ATUAL (${leadDept.name}):
"""
${input.currentProposal}
"""

Emita seu parecer executivo cruzado.`;

    const { text: content, model } = await callGeminiFlash(
      systemInstruction,
      userPrompt,
      0.45
    );
    return {
      department: reviewDeptId,
      content,
      model,
    };
  });

  return Promise.all(tasks);
}
