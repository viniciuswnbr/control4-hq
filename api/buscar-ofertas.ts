interface ProdutoInput {
  id: string;
  nome: string;
  preco_referencia: number;
}

interface ProdutoResult {
  id: string;
  menor_preco_encontrado: number | null;
  mercado_vencedor: string | null;
  link_oferta: string | null;
  super_oferta: boolean;
  atualizado_em: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const STOP_WORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'sem',
  'para',
  'em',
  'e',
  'ou',
  'tipo',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractKeywords(query: string): string[] {
  return normalizeText(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function matchesProductTitle(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const normalizedTitle = normalizeText(title);
  // O primeiro termo (geralmente o produto principal, ex: "cafe", "arroz", "leite") precisa aparecer
  if (!normalizedTitle.includes(keywords[0])) {
    return false;
  }
  if (keywords.length === 1) return true;
  const extraMatches = keywords
    .slice(1)
    .filter((kw) => normalizedTitle.includes(kw)).length;
  return extraMatches >= 0;
}

function scoreTitleMatch(title: string, keywords: string[]): number {
  const normalizedTitle = normalizeText(title);
  return keywords.reduce(
    (acc, kw) => (normalizedTitle.includes(kw) ? acc + 1 : acc),
    0
  );
}

function parseBRL(raw: string): number | null {
  const cleaned = raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/[^\d,.]/g, '')
    .trim();
  if (!cleaned) return null;

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8500),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function buscarCarrefour(
  termo: string
): Promise<{ preco: number; link: string } | null> {
  const url = `https://mercado.carrefour.com.br/busca/${encodeURIComponent(termo)}`;
  const html = await fetchHtml(url);
  if (!html) return null;

  const keywords = extractKeywords(termo);
  const pattern =
    /<h2[^>]*>([^<]+)<\/h2>[\s\S]{0,1200}?text-price-default[^>]*>([^<]+)</gi;

  const candidates: Array<{ preco: number; score: number }> = [];
  for (const match of html.matchAll(pattern)) {
    const title = match[1] ?? '';
    const rawPrice = match[2] ?? '';
    if (!matchesProductTitle(title, keywords)) continue;
    const preco = parseBRL(rawPrice);
    if (preco !== null) {
      candidates.push({ preco, score: scoreTitleMatch(title, keywords) });
    }
  }

  if (candidates.length === 0) return null;

  // Prioriza quem casou mais palavras-chave; em empate, o menor preço
  const maxScore = Math.max(...candidates.map((c) => c.score));
  const best = candidates
    .filter((c) => c.score === maxScore)
    .sort((a, b) => a.preco - b.preco)[0];

  return { preco: best.preco, link: url };
}

async function buscarTauste(
  termo: string
): Promise<{ preco: number; link: string } | null> {
  const url = `https://tauste.com.br/taubate/catalogsearch/result/?q=${encodeURIComponent(
    termo
  ).replace(/%20/g, '+')}`;
  const html = await fetchHtml(url);
  if (!html) return null;

  const keywords = extractKeywords(termo);
  const pattern =
    /<strong class="product-item-name">\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/strong>[\s\S]{0,1500}?class="price"[^>]*>([^<]+)</gi;

  const candidates: Array<{ preco: number; score: number }> = [];
  for (const match of html.matchAll(pattern)) {
    const title = (match[1] ?? '').replace(/\s+/g, ' ').trim();
    const rawPrice = match[2] ?? '';
    if (!matchesProductTitle(title, keywords)) continue;
    const preco = parseBRL(rawPrice);
    if (preco !== null) {
      candidates.push({ preco, score: scoreTitleMatch(title, keywords) });
    }
  }

  if (candidates.length === 0) return null;

  const maxScore = Math.max(...candidates.map((c) => c.score));
  const best = candidates
    .filter((c) => c.score === maxScore)
    .sort((a, b) => a.preco - b.preco)[0];

  return { preco: best.preco, link: url };
}

async function buscarProduto(prod: ProdutoInput): Promise<ProdutoResult> {
  const [carrefour, tauste] = await Promise.all([
    buscarCarrefour(prod.nome),
    buscarTauste(prod.nome),
  ]);

  const candidatos: Array<{ preco: number; mercado: string; link: string }> =
    [];
  if (carrefour) {
    candidatos.push({
      preco: carrefour.preco,
      mercado: 'Carrefour',
      link: carrefour.link,
    });
  }
  if (tauste) {
    candidatos.push({
      preco: tauste.preco,
      mercado: 'Tauste',
      link: tauste.link,
    });
  }

  const nowIso = new Date().toISOString();
  if (candidatos.length === 0) {
    return {
      id: prod.id,
      menor_preco_encontrado: null,
      mercado_vencedor: null,
      link_oferta: null,
      super_oferta: false,
      atualizado_em: nowIso,
    };
  }

  const vencedor = candidatos.sort((a, b) => a.preco - b.preco)[0];
  const ref = Number(prod.preco_referencia || 0);
  const desconto = ref > 0 ? ((ref - vencedor.preco) / ref) * 100 : 0;

  return {
    id: prod.id,
    menor_preco_encontrado: vencedor.preco,
    mercado_vencedor: vencedor.mercado,
    link_oferta: vencedor.link,
    super_oferta: desconto >= 50,
    atualizado_em: nowIso,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const produtos: ProdutoInput[] = Array.isArray(body.produtos)
    ? body.produtos
    : [];

  if (produtos.length === 0) {
    res.status(200).json({ results: [], elapsedMs: 0 });
    return;
  }

  const startedAt = Date.now();
  // Limita a 20 itens por chamada para caber com folga no timeout gratuito da Vercel
  const slice = produtos.slice(0, 20);
  const results = await Promise.all(slice.map((prod) => buscarProduto(prod)));

  res.status(200).json({
    results,
    elapsedMs: Date.now() - startedAt,
  });
}
