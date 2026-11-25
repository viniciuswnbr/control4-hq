import projectsCatalog from '../data/projects.config.json';

export type ProjectType = 'cloud' | 'local';
export type ProjectMode = 'web' | 'script';

export interface ProjectConfig {
  slug: string;
  agent_ids: string[];
  nome: string;
  tipo: ProjectType;
  modo: ProjectMode;
  porta?: number | null;
  url_destino: string;
  diretorio_local: string;
  comando_start: string;
  instrucoes_fallback: string;
}

export const PROJECTS_CATALOG: ProjectConfig[] = projectsCatalog as ProjectConfig[];

export const BRIDGE_BASE_URL = 'http://127.0.0.1:7777';

export function resolveProjectConfig(agentId: string, projectName?: string): ProjectConfig | undefined {
  const byId = PROJECTS_CATALOG.find(
    (p) => p.slug === agentId || p.agent_ids.includes(agentId)
  );
  if (byId) return byId;

  if (projectName) {
    const normalized = projectName.toLowerCase();
    return PROJECTS_CATALOG.find(
      (p) => p.nome.toLowerCase() === normalized || p.slug.toLowerCase() === normalized
    );
  }
  return undefined;
}

export interface LaunchResult {
  status: 'active' | 'started' | 'error';
  slug: string;
  port?: number | null;
  url?: string;
  mode?: ProjectMode;
  message?: string;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkBridgeHealth(timeoutMs = 3000): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(`${BRIDGE_BASE_URL}/health`, { method: 'GET' }, timeoutMs);
    return resp.ok;
  } catch {
    return false;
  }
}

export async function launchLocalProject(slug: string): Promise<LaunchResult> {
  const resp = await fetchWithTimeout(
    `${BRIDGE_BASE_URL}/launch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    },
    15000
  );

  const data = (await resp.json()) as LaunchResult;
  if (!resp.ok) {
    throw new Error(data.message || `Falha ao iniciar ${slug} (HTTP ${resp.status})`);
  }
  return data;
}
