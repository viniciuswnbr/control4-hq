import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Flame,
  Loader2,
  MapPin,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import './RadarOfertas.css';

interface RadarExecucao {
  id: string;
  status: string;
  tipo?: string | null;
  produto_id?: string | null;
  criado_em?: string | null;
  created_at?: string | null;
  atualizado_em?: string | null;
  finalizado_em?: string | null;
}

interface RadarProduto {
  id: string;
  nome?: string | null;
  produto?: string | null;
  nome_produto?: string | null;
  preco_referencia: number;
  menor_preco_encontrado?: number | null;
  super_oferta?: boolean | null;
  monitorado?: boolean | null;
  pre_lista?: boolean | null;
  mercado_vencedor?: string | null;
  mercado?: string | null;
  supermercado?: string | null;
  loja?: string | null;
  link_oferta?: string | null;
  atualizado_em?: string | null;
}

interface DeliveryShortcut {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  brandClass: string;
}

interface SugestaoProduto {
  nome: string;
  preco: number;
}

const SUGESTOES_PRODUTOS: SugestaoProduto[] = [
  { nome: 'Café Pilão 500g', preco: 22.0 },
  { nome: 'Arroz 5kg', preco: 28.0 },
  { nome: 'Feijão Carioca 1kg', preco: 8.5 },
  { nome: 'Leite Integral 1L', preco: 5.5 },
  { nome: 'Azeite Extra Virgem 500ml', preco: 42.0 },
  { nome: 'Óleo de Soja 900ml', preco: 7.5 },
  { nome: 'Açúcar Refinado 1kg', preco: 5.0 },
  { nome: 'Sabão em Pó 1,6kg', preco: 24.0 },
  { nome: 'Papel Higiênico 12 rolos', preco: 22.0 },
  { nome: 'Peito de Frango 1kg', preco: 22.0 },
];

const STALE_EXECUCAO_MS = 5 * 60 * 1000;
const COOLDOWN_8H_MS = 8 * 60 * 60 * 1000;

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getProdutoNome(item: RadarProduto): string {
  return item.nome || item.produto || item.nome_produto || 'Produto';
}

function getDescontoPercent(item: RadarProduto): number | null {
  const ref = Number(item.preco_referencia || 0);
  const menor =
    item.menor_preco_encontrado !== null && item.menor_preco_encontrado !== undefined
      ? Number(item.menor_preco_encontrado)
      : null;
  if (menor === null || ref <= 0) return null;
  return ((ref - menor) / ref) * 100;
}

function isProdutoMonitorado(item: RadarProduto): boolean {
  return item.monitorado !== false;
}

function formatRemainingTime(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

const DELIVERY_SHORTCUTS: DeliveryShortcut[] = [
  {
    id: 'ifood',
    title: 'iFood (Até R$ 10)',
    subtitle: 'Filtrar entrega grátis no app',
    href: 'https://www.ifood.com.br/busca?q=promocao%2010%20reais',
    brandClass: 'brand-ifood',
  },
  {
    id: '99food',
    title: '99Food (Ofertas)',
    subtitle: 'Cupons e frete grátis',
    href: 'https://99app.com/99food/',
    brandClass: 'brand-99food',
  },
  {
    id: 'rappi',
    title: 'Rappi (Até R$ 10)',
    subtitle: 'Restaurantes e express',
    href: 'https://www.rappi.com.br/search?query=ate%2010%20reais',
    brandClass: 'brand-rappi',
  },
  {
    id: 'aiqfome',
    title: 'AiQFome Taubaté',
    subtitle: 'Entrega grátis local',
    href: 'https://aiqfome.com/SP/taubate',
    brandClass: 'brand-aiqfome',
  },
];

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatBRL(value: number): string {
  return brlFormatter.format(value);
}

function getExecucaoTimestamp(exec: RadarExecucao): string {
  return exec.atualizado_em || exec.criado_em || exec.created_at || '';
}

function sortProdutos(items: RadarProduto[]): RadarProduto[] {
  return [...items].sort((a, b) => {
    const superDiff = Number(Boolean(b.super_oferta)) - Number(Boolean(a.super_oferta));
    if (superDiff !== 0) return superDiff;
    const dateA = a.atualizado_em ? new Date(a.atualizado_em).getTime() : 0;
    const dateB = b.atualizado_em ? new Date(b.atualizado_em).getTime() : 0;
    return dateB - dateA;
  });
}

export function RadarOfertas() {
  const [produtos, setProdutos] = useState<RadarProduto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(true);
  const [execucaoStatus, setExecucaoStatus] = useState<string | null>(null);
  const [ultimoConcluidoEm, setUltimoConcluidoEm] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [activeTab, setActiveTab] = useState<'monitorados' | 'pausados'>('monitorados');
  const [togglingMonitorId, setTogglingMonitorId] = useState<string | null>(null);
  const [updatingIndividualId, setUpdatingIndividualId] = useState<string | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [successMessage, setSuccessMessage] = useState(
    'Busca concluída! Ofertas atualizadas com sucesso.'
  );
  const [submittingSearch, setSubmittingSearch] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [addingSugestao, setAddingSugestao] = useState<string | null>(null);

  const loadProdutos = useCallback(async () => {
    const { data, error } = await supabase
      .from('radar_produtos')
      .select('*')
      .order('super_oferta', { ascending: false })
      .order('atualizado_em', { ascending: false });

    if (error) {
      setErrorMsg('Não foi possível carregar os produtos monitorados.');
    } else if (data) {
      setProdutos(sortProdutos(data as RadarProduto[]));
    }
    setLoadingProdutos(false);
  }, []);

  const loadLatestExecucao = useCallback(async () => {
    const [activeRes, lastGeralRes] = await Promise.all([
      supabase.from('radar_execucoes').select('*'),
      supabase
        .from('radar_execucoes')
        .select('finalizado_em')
        .eq('tipo', 'geral')
        .eq('status', 'concluido')
        .not('finalizado_em', 'is', null)
        .order('finalizado_em', { ascending: false })
        .limit(1),
    ]);

    if (lastGeralRes.data && lastGeralRes.data.length > 0) {
      setUltimoConcluidoEm(lastGeralRes.data[0].finalizado_em ?? null);
    } else {
      setUltimoConcluidoEm(null);
    }

    const data = activeRes.data;
    if (data && data.length > 0) {
      const sorted = [...(data as RadarExecucao[])].sort((a, b) =>
        getExecucaoTimestamp(b).localeCompare(getExecucaoTimestamp(a))
      );
      const latest = sorted[0];
      const ts = getExecucaoTimestamp(latest);
      const ageMs = ts ? Date.now() - new Date(ts).getTime() : 0;
      const isFresh = Number.isFinite(ageMs) && ageMs < STALE_EXECUCAO_MS;

      if (
        isFresh &&
        latest?.tipo !== 'individual' &&
        (latest?.status === 'pendente' || latest?.status === 'rodando')
      ) {
        setExecucaoStatus(latest.status);
      } else {
        setExecucaoStatus(null);
      }
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    const previousBg = document.body.style.background;
    const previousPadding = document.body.style.padding;
    const previousColor = document.body.style.color;

    document.title = 'Radar de Ofertas — Spazio Trevile';
    document.body.style.background = '#f4f6f9';
    document.body.style.padding = '0';
    document.body.style.color = '#0f172a';

    return () => {
      document.title = previousTitle;
      document.body.style.background = previousBg;
      document.body.style.padding = previousPadding;
      document.body.style.color = previousColor;
    };
  }, []);

  useEffect(() => {
    void Promise.all([loadProdutos(), loadLatestExecucao()]);

    const channel = supabase
      .channel('radar-ofertas-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'radar_execucoes' },
        (payload) => {
          const row = payload.new as RadarExecucao | undefined;
          if (!row?.status) return;

          if (row.tipo === 'individual') {
            if (row.status === 'concluido') {
              setUpdatingIndividualId(null);
              setSuccessMessage('Preço individual atualizado com sucesso!');
              setShowSuccessBanner(true);
              void loadProdutos();
            } else if (row.status === 'erro') {
              setUpdatingIndividualId(null);
              setErrorMsg('Erro ao atualizar preço individual.');
            }
            return;
          }

          if (row.status === 'pendente' || row.status === 'rodando') {
            setExecucaoStatus(row.status);
            setShowSuccessBanner(false);
          } else if (row.status === 'concluido') {
            setExecucaoStatus(null);
            if (row.finalizado_em) {
              setUltimoConcluidoEm(row.finalizado_em);
              setNowMs(Date.now());
            }
            setSuccessMessage('Busca concluída! Ofertas atualizadas com sucesso.');
            setShowSuccessBanner(true);
            void loadProdutos();
          } else if (row.status === 'bloqueado_8h') {
            setExecucaoStatus(null);
            void loadLatestExecucao();
          } else {
            setExecucaoStatus(null);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'radar_produtos' },
        () => {
          void loadProdutos();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadProdutos, loadLatestExecucao]);

  const cooldownRemainingMs = useMemo(() => {
    if (!ultimoConcluidoEm) return 0;
    const finishedAt = new Date(ultimoConcluidoEm).getTime();
    if (!Number.isFinite(finishedAt)) return 0;
    const remaining = COOLDOWN_8H_MS - (nowMs - finishedAt);
    return remaining > 0 ? remaining : 0;
  }, [ultimoConcluidoEm, nowMs]);

  const isCooldownLocked = cooldownRemainingMs > 0;

  const produtosMonitorados = useMemo(
    () => produtos.filter((item) => isProdutoMonitorado(item)),
    [produtos]
  );

  const produtosPausados = useMemo(
    () => produtos.filter((item) => !isProdutoMonitorado(item)),
    [produtos]
  );

  const top10PreLista = useMemo(() => {
    return produtos
      .map((item) => ({
        item,
        desconto: getDescontoPercent(item),
      }))
      .filter((entry): entry is { item: RadarProduto; desconto: number } => entry.desconto !== null)
      .sort((a, b) => b.desconto - a.desconto)
      .slice(0, 10);
  }, [produtos]);

  const handleBuscarPromocoes = async () => {
    setErrorMsg(null);
    setShowSuccessBanner(false);

    if (isCooldownLocked) {
      setErrorMsg(
        `Busca geral em intervalo mínimo de 8h. Próxima busca em ${formatRemainingTime(
          cooldownRemainingMs
        )}.`
      );
      return;
    }

    if (produtosMonitorados.length === 0) {
      setErrorMsg('Ative ou adicione pelo menos 1 produto monitorado antes de buscar.');
      return;
    }

    setSubmittingSearch(true);

    const { error } = await supabase
      .from('radar_execucoes')
      .insert({ tipo: 'geral', status: 'pendente' });

    setSubmittingSearch(false);

    if (error) {
      setErrorMsg(`Erro ao iniciar busca de promoções: ${error.message}`);
      return;
    }

    setSuccessMessage('Busca concluída! Ofertas atualizadas com sucesso.');
    setExecucaoStatus('pendente');
  };

  const handleToggleMonitorado = async (item: RadarProduto) => {
    setErrorMsg(null);
    const nextValue = !isProdutoMonitorado(item);
    setTogglingMonitorId(item.id);
    setProdutos((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, monitorado: nextValue } : p))
    );

    const { error } = await supabase
      .from('radar_produtos')
      .update({ monitorado: nextValue })
      .eq('id', item.id);

    setTogglingMonitorId(null);

    if (error) {
      setErrorMsg('Não foi possível alterar o status de monitoramento.');
      void loadProdutos();
    }
  };

  const handleAtualizarIndividual = async (item: RadarProduto) => {
    setErrorMsg(null);
    setShowSuccessBanner(false);
    setUpdatingIndividualId(item.id);

    const { error } = await supabase.from('radar_execucoes').insert({
      tipo: 'individual',
      produto_id: item.id,
      status: 'pendente',
    });

    if (error) {
      setUpdatingIndividualId(null);
      setErrorMsg(`Erro ao solicitar atualização individual: ${error.message}`);
    }
  };

  const handleAddSugestao = async (sugestao: SugestaoProduto) => {
    setErrorMsg(null);
    setAddingSugestao(sugestao.nome);

    const { data, error } = await supabase
      .from('radar_produtos')
      .insert({
        nome: sugestao.nome,
        preco_referencia: sugestao.preco,
        monitorado: true,
      })
      .select()
      .single();

    setAddingSugestao(null);

    if (error) {
      setErrorMsg('Não foi possível adicionar o item sugerido.');
      return;
    }

    if (data) {
      setProdutos((prev) => sortProdutos([data as RadarProduto, ...prev]));
    }
  };

  const handleAddProduto = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const nomeLimpo = novoNome.trim();
    const precoNumerico = Number(novoPreco.replace(',', '.'));

    if (!nomeLimpo) {
      setErrorMsg('Informe o nome do produto.');
      return;
    }
    if (!Number.isFinite(precoNumerico) || precoNumerico <= 0) {
      setErrorMsg('Informe um preço normal válido (ex: 22.00).');
      return;
    }

    setAddingItem(true);
    const { data, error } = await supabase
      .from('radar_produtos')
      .insert({
        nome: nomeLimpo,
        preco_referencia: precoNumerico,
        monitorado: true,
      })
      .select()
      .single();

    setAddingItem(false);

    if (error) {
      setErrorMsg('Não foi possível adicionar o item à lista.');
      return;
    }

    if (data) {
      setProdutos((prev) => sortProdutos([data as RadarProduto, ...prev]));
    }
    setNovoNome('');
    setNovoPreco('');
  };

  const handleDeleteProduto = async (id: string) => {
    setErrorMsg(null);
    setProdutos((prev) => prev.filter((item) => item.id !== id));

    const { error } = await supabase.from('radar_produtos').delete().eq('id', id);
    if (error) {
      setErrorMsg('Não foi possível remover o item.');
      void loadProdutos();
    }
  };

  const isBuscando = execucaoStatus === 'pendente' || execucaoStatus === 'rodando';
  const nomesNaLista = new Set(produtos.map((p) => normalizeKey(getProdutoNome(p))));
  const produtosDaAba =
    activeTab === 'monitorados' ? produtosMonitorados : produtosPausados;

  useEffect(() => {
    if (execucaoStatus !== 'pendente') return;
    const timer = window.setTimeout(() => {
      setExecucaoStatus(null);
      setErrorMsg(
        'O worker local não respondeu em 25s. Verifique se o radar_worker.py está ativo.'
      );
    }, 25000);
    return () => window.clearTimeout(timer);
  }, [execucaoStatus]);

  return (
    <main className="radar-root">
      <div className="radar-container">
        {/* 1. Cabeçalho & Botão de Ação Imediata */}
        <section className="radar-header-card">
          <span className="radar-location-pill">
            <MapPin size={14} />
            Spazio Trevile • Taubaté/SP
          </span>

          <h1 className="radar-title">
            Radar de Ofertas — Spazio Trevile (Taubaté/SP)
          </h1>

          <button
            type="button"
            className="radar-primary-btn"
            onClick={handleBuscarPromocoes}
            disabled={submittingSearch || isBuscando || isCooldownLocked}
          >
            {submittingSearch || isBuscando ? (
              <>
                <Loader2 size={20} className="radar-spinner" />
                Buscando Promoções...
              </>
            ) : isCooldownLocked ? (
              `⏳ Próxima busca geral em ${formatRemainingTime(cooldownRemainingMs)}`
            ) : (
              '🔍 Buscar Promoções Agora'
            )}
          </button>

          {(submittingSearch || isBuscando) && (
            <div className="radar-status-banner radar-status-running" role="status">
              <Loader2 size={18} className="radar-spinner" />
              <span>Buscando ofertas no Tauste, Carrefour, Shibata e Nagumo...</span>
            </div>
          )}

          {showSuccessBanner && !submittingSearch && !isBuscando && (
            <div className="radar-status-banner radar-status-success" role="status">
              <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMsg && (
            <div className="radar-status-banner radar-status-error" role="alert">
              <span>{errorMsg}</span>
            </div>
          )}
        </section>

        {/* 2. Atalhos Rápidos: Delivery Até R$ 10 + Frete Grátis */}
        <section className="radar-section">
          <div className="radar-section-header">
            <h2 className="radar-section-title">
              Delivery Até R$ 10 + Frete Grátis
            </h2>
            <span className="radar-section-badge">1 Clique</span>
          </div>

          <div className="radar-delivery-grid">
            {DELIVERY_SHORTCUTS.map((item) => (
              <a
                key={item.id}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`radar-delivery-card ${item.brandClass}`}
              >
                <div className="radar-delivery-top">
                  <span className="radar-delivery-name">{item.title}</span>
                  <ExternalLink size={16} style={{ flexShrink: 0, opacity: 0.85 }} />
                </div>
                <span className="radar-delivery-sub">{item.subtitle}</span>
              </a>
            ))}
          </div>
        </section>

        {/* 3. Lista de Mercado Monitorada (Tauste, Carrefour, Shibata & Nagumo) */}
        <section className="radar-section">
          <div className="radar-section-header">
            <h2 className="radar-section-title">
              Lista Monitorada (Tauste, Carrefour, Shibata &amp; Nagumo)
            </h2>
            <span className="radar-section-badge">Meta: &gt;50% OFF</span>
          </div>

          {/* Pré-Lista Inteligente: Top 10 Melhores Ofertas */}
          <div className="radar-prelist-card">
            <div className="radar-prelist-header">
              <div className="radar-prelist-title-wrap">
                <Flame size={17} className="radar-prelist-flame" />
                <h3 className="radar-prelist-title">
                  🔥 Top 10 Melhores Ofertas (Pré-Lista)
                </h3>
              </div>
              <span className="radar-suggestions-hint">
                Maior % de desconto
              </span>
            </div>

            {top10PreLista.length === 0 ? (
              <p className="radar-prelist-empty">
                Rode uma busca para preencher automaticamente os 10 itens com maior desconto.
              </p>
            ) : (
              <div className="radar-prelist-items">
                {top10PreLista.map(({ item, desconto }, idx) => {
                  const monitorado = isProdutoMonitorado(item);
                  const nome = getProdutoNome(item);
                  const mercado =
                    item.mercado_vencedor ||
                    item.mercado ||
                    item.supermercado ||
                    item.loja ||
                    null;

                  return (
                    <div key={item.id} className="radar-prelist-row">
                      <div className="radar-prelist-info">
                        <span className="radar-prelist-rank">#{idx + 1}</span>
                        <div className="radar-prelist-meta">
                          <span className="radar-prelist-name">{nome}</span>
                          <span className="radar-prelist-sub">
                            {item.menor_preco_encontrado != null
                              ? formatBRL(Number(item.menor_preco_encontrado))
                              : '—'}
                            {mercado ? ` • ${mercado}` : ''} •{' '}
                            <strong>{Math.round(desconto)}% OFF</strong>
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`radar-prelist-toggle ${
                          monitorado ? 'is-active' : 'is-paused'
                        }`}
                        disabled={togglingMonitorId === item.id}
                        onClick={() => void handleToggleMonitorado(item)}
                      >
                        {monitorado ? 'Monitorando' : 'Não Monitorar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="radar-suggestions-card">
            <div className="radar-suggestions-header">
              <span className="radar-suggestions-title">
                Adicionar rápido à lista
              </span>
              <span className="radar-suggestions-hint">1 clique</span>
            </div>
            <div className="radar-suggestions-grid">
              {SUGESTOES_PRODUTOS.map((sug) => {
                const jaNaLista = nomesNaLista.has(normalizeKey(sug.nome));
                const isAddingThis = addingSugestao === sug.nome;
                return (
                  <button
                    key={sug.nome}
                    type="button"
                    className={`radar-suggestion-chip ${
                      jaNaLista ? 'is-added' : ''
                    }`}
                    disabled={jaNaLista || isAddingThis}
                    onClick={() => void handleAddSugestao(sug)}
                  >
                    <span>
                      {jaNaLista ? '✓ ' : isAddingThis ? '... ' : '+ '}
                      {sug.nome}
                    </span>
                    <span className="radar-suggestion-price">
                      {formatBRL(sug.preco)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <form className="radar-form-card" onSubmit={handleAddProduto}>
            <div className="radar-form-row">
              <div className="radar-field">
                <label htmlFor="radar-nome" className="radar-label">
                  Nome do Produto
                </label>
                <input
                  id="radar-nome"
                  type="text"
                  className="radar-input"
                  placeholder="Ex: Café Pilão 500g"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  disabled={addingItem}
                />
              </div>

              <div className="radar-field">
                <label htmlFor="radar-preco" className="radar-label">
                  Preço Normal (R$)
                </label>
                <input
                  id="radar-preco"
                  type="text"
                  inputMode="decimal"
                  className="radar-input"
                  placeholder="22.00"
                  value={novoPreco}
                  onChange={(e) => setNovoPreco(e.target.value)}
                  disabled={addingItem}
                />
              </div>
            </div>

            <button
              type="submit"
              className="radar-add-btn"
              disabled={addingItem}
            >
              {addingItem ? (
                <>
                  <Loader2 size={18} className="radar-spinner" />
                  Adicionando...
                </>
              ) : (
                <>
                  <Plus size={19} />
                  Adicionar à Lista
                </>
              )}
            </button>
          </form>

          {/* Abas de Controle: Monitorados vs. Não Monitorados */}
          <div className="radar-tabs" role="tablist" aria-label="Controle de monitoramento">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'monitorados'}
              className={`radar-tab-btn ${
                activeTab === 'monitorados' ? 'is-active' : ''
              }`}
              onClick={() => setActiveTab('monitorados')}
            >
              Monitorados (Ativos) ({produtosMonitorados.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pausados'}
              className={`radar-tab-btn ${
                activeTab === 'pausados' ? 'is-active' : ''
              }`}
              onClick={() => setActiveTab('pausados')}
            >
              Não Monitorados (Pausados) ({produtosPausados.length})
            </button>
          </div>

          {loadingProdutos ? (
            <div className="radar-empty-state">
              <Loader2
                size={22}
                className="radar-spinner"
                style={{ margin: '0 auto 8px', display: 'block' }}
              />
              Carregando lista monitorada...
            </div>
          ) : produtosDaAba.length === 0 ? (
            <div className="radar-empty-state">
              <ShoppingBasket
                size={26}
                style={{ margin: '0 auto 8px', display: 'block', color: '#94a3b8' }}
              />
              {activeTab === 'monitorados'
                ? 'Nenhum produto ativo no monitoramento. Adicione itens acima ou reative itens pausados.'
                : 'Nenhum produto pausado no momento.'}
            </div>
          ) : (
            <div className="radar-products-list">
              {produtosDaAba.map((item) => {
                const nome = getProdutoNome(item);
                const precoNormal = Number(item.preco_referencia || 0);
                const menorPreco =
                  item.menor_preco_encontrado !== null &&
                  item.menor_preco_encontrado !== undefined
                    ? Number(item.menor_preco_encontrado)
                    : null;

                const desconto = getDescontoPercent(item);
                const isSuperOferta =
                  Boolean(item.super_oferta) ||
                  (desconto !== null && desconto >= 50);

                const mercado =
                  item.mercado_vencedor ||
                  item.mercado ||
                  item.supermercado ||
                  item.loja ||
                  null;

                const monitorado = isProdutoMonitorado(item);
                const isUpdatingThis = updatingIndividualId === item.id;
                const isTogglingThis = togglingMonitorId === item.id;

                return (
                  <article
                    key={item.id}
                    className={`radar-product-card ${
                      isSuperOferta ? 'is-super-oferta' : ''
                    } ${!monitorado ? 'is-paused' : ''}`}
                  >
                    <div className="radar-product-top">
                      <div>
                        {(isSuperOferta || mercado) && (
                          <div className="radar-product-badges">
                            {isSuperOferta && (
                              <span className="radar-super-badge">
                                🔥 +50% OFF IMPERDÍVEL
                              </span>
                            )}
                            {mercado && (
                              <span className="radar-market-badge">{mercado}</span>
                            )}
                          </div>
                        )}
                        <h3 className="radar-product-name">{nome}</h3>
                      </div>

                      <button
                        type="button"
                        className="radar-delete-btn"
                        aria-label={`Remover ${nome}`}
                        onClick={() => void handleDeleteProduto(item.id)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>

                    <div className="radar-prices-grid">
                      <div className="radar-price-col">
                        <span className="radar-price-label">Preço Normal</span>
                        <span className="radar-price-normal">
                          {formatBRL(precoNormal)}
                        </span>
                      </div>

                      <div className="radar-price-col">
                        <span className="radar-price-label">
                          Menor Preço Encontrado
                        </span>
                        {menorPreco !== null ? (
                          <span className="radar-price-found">
                            {formatBRL(menorPreco)}
                          </span>
                        ) : (
                          <span className="radar-price-pending">
                            Aguardando busca
                          </span>
                        )}
                      </div>
                    </div>

                    {desconto !== null && (
                      <div className="radar-discount-row">
                        <span
                          className={`radar-discount-pill ${
                            desconto >= 50 ? 'is-high' : ''
                          }`}
                        >
                          {desconto > 0
                            ? `${Math.round(desconto)}% de desconto`
                            : 'Sem desconto no momento'}
                        </span>
                      </div>
                    )}

                    <div className="radar-card-actions">
                      {item.link_oferta && (
                        <a
                          href={item.link_oferta}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`radar-offer-link-btn ${
                            isSuperOferta ? '' : 'radar-offer-link-secondary'
                          }`}
                        >
                          Ver no Site
                          <ExternalLink size={16} />
                        </a>
                      )}

                      {monitorado ? (
                        <button
                          type="button"
                          className="radar-action-btn radar-pause-btn"
                          disabled={isTogglingThis}
                          onClick={() => void handleToggleMonitorado(item)}
                        >
                          <Pause size={15} />
                          Pausar
                        </button>
                      ) : (
                        <div className="radar-paused-actions">
                          <button
                            type="button"
                            className="radar-action-btn radar-refresh-btn"
                            disabled={isUpdatingThis}
                            onClick={() => void handleAtualizarIndividual(item)}
                          >
                            {isUpdatingThis ? (
                              <Loader2 size={15} className="radar-spinner" />
                            ) : (
                              <RefreshCw size={15} />
                            )}
                            {isUpdatingThis
                              ? 'Atualizando...'
                              : '🔄 Atualizar Preço Agora'}
                          </button>

                          <button
                            type="button"
                            className="radar-action-btn radar-resume-btn"
                            disabled={isTogglingThis}
                            onClick={() => void handleToggleMonitorado(item)}
                          >
                            <Play size={15} />
                            ▶️ Monitorar
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
