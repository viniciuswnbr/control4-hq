import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Store,
  Trash2,
  Truck,
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
  preco_anterior?: number | null;
  menor_preco_encontrado?: number | null;
  super_oferta?: boolean | null;
  monitorado?: boolean | null;
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

const STALE_EXECUCAO_MS = 5 * 60 * 1000;
const COOLDOWN_8H_MS = 8 * 60 * 60 * 1000;

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatBRL(value: number): string {
  return brlFormatter.format(value);
}

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

function getMercadoNome(item: RadarProduto): string | null {
  return (
    item.mercado_vencedor ||
    item.mercado ||
    item.supermercado ||
    item.loja ||
    null
  );
}

function getPrecoAnterior(item: RadarProduto): number {
  if (item.preco_anterior !== null && item.preco_anterior !== undefined) {
    return Number(item.preco_anterior);
  }
  return Number(item.preco_referencia || 0);
}

function getDescontoInfo(item: RadarProduto): {
  valor: number | null;
  percentual: number | null;
} {
  const base = getPrecoAnterior(item);
  const atual =
    item.menor_preco_encontrado !== null &&
    item.menor_preco_encontrado !== undefined
      ? Number(item.menor_preco_encontrado)
      : null;

  if (atual === null || base <= 0) {
    return { valor: null, percentual: null };
  }

  const valor = base - atual;
  const percentual = (valor / base) * 100;
  return { valor, percentual };
}

function isProdutoVisivel(item: RadarProduto): boolean {
  return item.monitorado !== false;
}

function getExecucaoTimestamp(exec: RadarExecucao): string {
  return exec.atualizado_em || exec.criado_em || exec.created_at || '';
}

function formatRemainingTime(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function sortByDesconto(items: RadarProduto[]): RadarProduto[] {
  return [...items].sort((a, b) => {
    const descA = getDescontoInfo(a).percentual ?? -999;
    const descB = getDescontoInfo(b).percentual ?? -999;
    if (descB !== descA) return descB - descA;
    const dateA = a.atualizado_em ? new Date(a.atualizado_em).getTime() : 0;
    const dateB = b.atualizado_em ? new Date(b.atualizado_em).getTime() : 0;
    return dateB - dateA;
  });
}

export function RadarOfertas() {
  const [mainTab, setMainTab] = useState<'supermercados' | 'delivery'>('supermercados');
  const [visibilityFilter, setVisibilityFilter] = useState<'visiveis' | 'ocultos'>('visiveis');
  const [onlyPromocoes, setOnlyPromocoes] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [produtos, setProdutos] = useState<RadarProduto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(true);
  const [execucaoStatus, setExecucaoStatus] = useState<string | null>(null);
  const [ultimoConcluidoEm, setUltimoConcluidoEm] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [togglingId, setTogglingId] = useState<string | null>(null);
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
      .order('atualizado_em', { ascending: false });

    if (error) {
      setErrorMsg('Não foi possível carregar os produtos.');
    } else if (data) {
      setProdutos(sortByDesconto(data as RadarProduto[]));
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

  const produtosVisiveis = useMemo(
    () => produtos.filter((item) => isProdutoVisivel(item)),
    [produtos]
  );

  const produtosOcultos = useMemo(
    () => produtos.filter((item) => !isProdutoVisivel(item)),
    [produtos]
  );

  const listaExibida = useMemo(() => {
    const base =
      visibilityFilter === 'visiveis' ? produtosVisiveis : produtosOcultos;
    if (!onlyPromocoes) return base;
    return base.filter((item) => {
      const { valor } = getDescontoInfo(item);
      return valor !== null && valor > 0;
    });
  }, [visibilityFilter, produtosVisiveis, produtosOcultos, onlyPromocoes]);

  const resumoPromocoes = useMemo(() => {
    const comDesconto = produtosVisiveis.filter((p) => {
      const { valor } = getDescontoInfo(p);
      return valor !== null && valor > 0;
    });
    const maiorDesconto = comDesconto.reduce((max, p) => {
      const pct = getDescontoInfo(p).percentual ?? 0;
      return pct > max ? pct : max;
    }, 0);
    return {
      totalEmPromocao: comDesconto.length,
      maiorDesconto: Math.round(maiorDesconto),
    };
  }, [produtosVisiveis]);

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

    if (produtosVisiveis.length === 0) {
      setErrorMsg('Deixe pelo menos 1 produto visível/ativo antes de buscar.');
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

  const handleToggleVisibilidade = async (item: RadarProduto) => {
    setErrorMsg(null);
    const nextValue = !isProdutoVisivel(item);
    setTogglingId(item.id);
    setProdutos((prev) =>
      sortByDesconto(
        prev.map((p) => (p.id === item.id ? { ...p, monitorado: nextValue } : p))
      )
    );

    const { error } = await supabase
      .from('radar_produtos')
      .update({ monitorado: nextValue })
      .eq('id', item.id);

    setTogglingId(null);

    if (error) {
      setErrorMsg('Não foi possível alterar a exibição do item.');
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
      setProdutos((prev) => sortByDesconto([data as RadarProduto, ...prev]));
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
      setProdutos((prev) => sortByDesconto([data as RadarProduto, ...prev]));
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
        {/* Cabeçalho */}
        <header className="radar-header-card">
          <div className="radar-header-top">
            <span className="radar-location-pill">
              <MapPin size={14} />
              Spazio Trevile • Taubaté/SP
            </span>
            <span className="radar-markets-pill">
              Tauste • Carrefour • Shibata • Nagumo
            </span>
          </div>

          <h1 className="radar-title">Radar de Ofertas</h1>

          {/* Abas Principais: Supermercados vs Delivery */}
          <div className="radar-main-tabs" role="tablist" aria-label="Categorias">
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'supermercados'}
              className={`radar-main-tab ${
                mainTab === 'supermercados' ? 'is-active' : ''
              }`}
              onClick={() => setMainTab('supermercados')}
            >
              <Store size={17} />
              Supermercados ({produtosVisiveis.length})
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'delivery'}
              className={`radar-main-tab ${
                mainTab === 'delivery' ? 'is-active' : ''
              }`}
              onClick={() => setMainTab('delivery')}
            >
              <Truck size={17} />
              Delivery ({DELIVERY_SHORTCUTS.length})
            </button>
          </div>
        </header>

        {/* ABA 1: SUPERMERCADOS */}
        {mainTab === 'supermercados' && (
          <section className="radar-section">
            {/* Ação principal + resumo */}
            <div className="radar-toolbar-card">
              <button
                type="button"
                className="radar-primary-btn"
                onClick={handleBuscarPromocoes}
                disabled={submittingSearch || isBuscando || isCooldownLocked}
              >
                {submittingSearch || isBuscando ? (
                  <>
                    <Loader2 size={19} className="radar-spinner" />
                    Buscando nos 4 mercados...
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
                  <span>Consultando Tauste, Carrefour, Shibata e Nagumo...</span>
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

              {/* Resumo rápido de promoções */}
              <div className="radar-stats-row">
                <div className="radar-stat-chip">
                  <Flame size={15} className="radar-stat-icon-hot" />
                  <span>
                    <strong>{resumoPromocoes.totalEmPromocao}</strong> em promoção
                  </span>
                </div>
                {resumoPromocoes.maiorDesconto > 0 && (
                  <div className="radar-stat-chip">
                    <span>
                      Maior desconto: <strong>{resumoPromocoes.maiorDesconto}% OFF</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Controles de visualização: Visíveis vs Ocultos + Só Promoções + Adicionar */}
            <div className="radar-controls-bar">
              <div className="radar-subtabs" role="tablist" aria-label="Exibição">
                <button
                  type="button"
                  role="tab"
                  aria-selected={visibilityFilter === 'visiveis'}
                  className={`radar-subtab ${
                    visibilityFilter === 'visiveis' ? 'is-active' : ''
                  }`}
                  onClick={() => setVisibilityFilter('visiveis')}
                >
                  <Eye size={14} />
                  Exibindo ({produtosVisiveis.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={visibilityFilter === 'ocultos'}
                  className={`radar-subtab ${
                    visibilityFilter === 'ocultos' ? 'is-active' : ''
                  }`}
                  onClick={() => setVisibilityFilter('ocultos')}
                >
                  <EyeOff size={14} />
                  Ocultos ({produtosOcultos.length})
                </button>
              </div>

              <div className="radar-controls-right">
                <button
                  type="button"
                  className={`radar-filter-pill ${onlyPromocoes ? 'is-active' : ''}`}
                  onClick={() => setOnlyPromocoes((prev) => !prev)}
                >
                  <Flame size={14} />
                  Só promoções
                </button>

                <button
                  type="button"
                  className="radar-toggle-add-btn"
                  onClick={() => setShowAddForm((prev) => !prev)}
                >
                  <Plus size={15} />
                  Produto
                  {showAddForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>

            {/* Formulário colapsável de adicionar produto */}
            {showAddForm && (
              <div className="radar-add-panel">
                <div className="radar-suggestions-header">
                  <span className="radar-suggestions-title">Sugestões rápidas</span>
                  <span className="radar-suggestions-hint">1 clique para adicionar</span>
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
                        Preço Anterior / Ref. (R$)
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
                        <Plus size={18} />
                        Adicionar à Lista
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* Tabela / Lista de Preços e Evolução */}
            {loadingProdutos ? (
              <div className="radar-empty-state">
                <Loader2
                  size={22}
                  className="radar-spinner"
                  style={{ margin: '0 auto 8px', display: 'block' }}
                />
                Carregando produtos...
              </div>
            ) : listaExibida.length === 0 ? (
              <div className="radar-empty-state">
                <ShoppingBasket
                  size={26}
                  style={{ margin: '0 auto 8px', display: 'block', color: '#94a3b8' }}
                />
                {onlyPromocoes
                  ? 'Nenhum item com desconto encontrado neste filtro.'
                  : visibilityFilter === 'visiveis'
                    ? 'Nenhum produto exibido. Adicione um produto acima ou restaure da aba Ocultos.'
                    : 'Nenhum produto oculto no momento.'}
              </div>
            ) : (
              <div className="radar-table-card">
                <div className="radar-table-header">
                  <span>Produto</span>
                  <span>Preço Anterior</span>
                  <span>Preço Atual</span>
                  <span>Desconto</span>
                  <span>Supermercado</span>
                  <span className="radar-col-actions">Ações</span>
                </div>

                <div className="radar-table-body">
                  {listaExibida.map((item) => {
                    const nome = getProdutoNome(item);
                    const precoAnterior = getPrecoAnterior(item);
                    const precoAtual =
                      item.menor_preco_encontrado !== null &&
                      item.menor_preco_encontrado !== undefined
                        ? Number(item.menor_preco_encontrado)
                        : null;

                    const { valor: descontoValor, percentual: descontoPct } =
                      getDescontoInfo(item);
                    const mercado = getMercadoNome(item);
                    const visivel = isProdutoVisivel(item);
                    const isPromocao = descontoValor !== null && descontoValor > 0;
                    const isSuperOferta =
                      Boolean(item.super_oferta) ||
                      (descontoPct !== null && descontoPct >= 50);
                    const isUpdatingThis = updatingIndividualId === item.id;
                    const isTogglingThis = togglingId === item.id;

                    return (
                      <div
                        key={item.id}
                        className={`radar-table-row ${
                          isSuperOferta
                            ? 'is-super-oferta'
                            : isPromocao
                              ? 'is-promo'
                              : ''
                        }`}
                      >
                        {/* Produto */}
                        <div className="radar-cell radar-cell-product">
                          <span className="radar-cell-title">{nome}</span>
                          {item.atualizado_em && (
                            <span className="radar-cell-date">
                              Atualizado em{' '}
                              {new Date(item.atualizado_em).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>

                        {/* Preço Anterior */}
                        <div className="radar-cell">
                          <span className="radar-mobile-label">Preço Anterior</span>
                          <span
                            className={`radar-val-prev ${
                              isPromocao ? 'is-crossed' : ''
                            }`}
                          >
                            {formatBRL(precoAnterior)}
                          </span>
                        </div>

                        {/* Preço Atual */}
                        <div className="radar-cell">
                          <span className="radar-mobile-label">Preço Atual</span>
                          {precoAtual !== null ? (
                            <span
                              className={`radar-val-current ${
                                isPromocao ? 'is-lower' : ''
                              }`}
                            >
                              {formatBRL(precoAtual)}
                            </span>
                          ) : (
                            <span className="radar-val-pending">Aguardando busca</span>
                          )}
                        </div>

                        {/* Valor do Desconto & Evolução */}
                        <div className="radar-cell">
                          <span className="radar-mobile-label">Desconto</span>
                          {descontoValor !== null && descontoPct !== null ? (
                            descontoValor > 0 ? (
                              <span
                                className={`radar-discount-badge ${
                                  isSuperOferta ? 'is-super' : 'is-save'
                                }`}
                              >
                                <ArrowDownRight size={14} />
                                -{formatBRL(descontoValor)} ({Math.round(descontoPct)}%)
                              </span>
                            ) : descontoValor < 0 ? (
                              <span className="radar-discount-badge is-up">
                                <ArrowUpRight size={14} />
                                +{formatBRL(Math.abs(descontoValor))}
                              </span>
                            ) : (
                              <span className="radar-discount-badge is-neutral">
                                Sem alteração
                              </span>
                            )
                          ) : (
                            <span className="radar-val-pending">—</span>
                          )}
                        </div>

                        {/* Supermercado */}
                        <div className="radar-cell">
                          <span className="radar-mobile-label">Supermercado</span>
                          {mercado ? (
                            <div className="radar-market-wrap">
                              <span className="radar-market-badge">{mercado}</span>
                              {item.link_oferta && (
                                <a
                                  href={item.link_oferta}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="radar-link-mini"
                                  title="Abrir oferta no site"
                                >
                                  Ver <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                          ) : (
                            <span className="radar-val-pending">—</span>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="radar-cell radar-cell-actions">
                          {!visivel && (
                            <button
                              type="button"
                              className="radar-icon-btn radar-btn-refresh"
                              title="Atualizar preço agora"
                              disabled={isUpdatingThis}
                              onClick={() => void handleAtualizarIndividual(item)}
                            >
                              {isUpdatingThis ? (
                                <Loader2 size={15} className="radar-spinner" />
                              ) : (
                                <RefreshCw size={15} />
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            className={`radar-visibility-btn ${
                              visivel ? 'is-hide' : 'is-show'
                            }`}
                            disabled={isTogglingThis}
                            onClick={() => void handleToggleVisibilidade(item)}
                          >
                            {visivel ? (
                              <>
                                <EyeOff size={14} />
                                Ocultar
                              </>
                            ) : (
                              <>
                                <Eye size={14} />
                                Exibir
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            className="radar-icon-btn radar-btn-delete"
                            title={`Excluir ${nome}`}
                            aria-label={`Excluir ${nome}`}
                            onClick={() => void handleDeleteProduto(item.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ABA 2: DELIVERY */}
        {mainTab === 'delivery' && (
          <section className="radar-section">
            <div className="radar-section-header">
              <h2 className="radar-section-title">
                Delivery Até R$ 10 + Frete Grátis
              </h2>
              <span className="radar-section-badge">Atalhos 1 Clique</span>
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
        )}
      </div>
    </main>
  );
}
