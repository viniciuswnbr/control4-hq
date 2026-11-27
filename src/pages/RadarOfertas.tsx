import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  ShoppingBasket,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import './RadarOfertas.css';

interface RadarExecucao {
  id: string;
  status: string;
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
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [submittingSearch, setSubmittingSearch] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('');
  const [addingItem, setAddingItem] = useState(false);

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
    const { data } = await supabase.from('radar_execucoes').select('*');
    if (data && data.length > 0) {
      const sorted = [...(data as RadarExecucao[])].sort((a, b) =>
        getExecucaoTimestamp(b).localeCompare(getExecucaoTimestamp(a))
      );
      const latest = sorted[0];
      if (latest?.status === 'pendente' || latest?.status === 'rodando') {
        setExecucaoStatus(latest.status);
      } else {
        setExecucaoStatus(null);
      }
    }
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

          if (row.status === 'pendente' || row.status === 'rodando') {
            setExecucaoStatus(row.status);
            setShowSuccessBanner(false);
          } else if (row.status === 'concluido') {
            setExecucaoStatus(null);
            setShowSuccessBanner(true);
            void loadProdutos();
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

  const handleBuscarPromocoes = async () => {
    setErrorMsg(null);
    setShowSuccessBanner(false);
    setSubmittingSearch(true);

    const { error } = await supabase
      .from('radar_execucoes')
      .insert({ status: 'pendente' });

    setSubmittingSearch(false);

    if (error) {
      setErrorMsg('Erro ao iniciar busca de promoções. Tente novamente.');
      return;
    }

    setExecucaoStatus('pendente');
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
            disabled={submittingSearch || isBuscando}
          >
            {submittingSearch || isBuscando ? (
              <>
                <Loader2 size={20} className="radar-spinner" />
                Buscando Promoções...
              </>
            ) : (
              '🔍 Buscar Promoções Agora'
            )}
          </button>

          {isBuscando && (
            <div className="radar-status-banner radar-status-running" role="status">
              <Loader2 size={18} className="radar-spinner" />
              <span>Buscando ofertas no Tauste e Carrefour...</span>
            </div>
          )}

          {showSuccessBanner && !isBuscando && (
            <div className="radar-status-banner radar-status-success" role="status">
              <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              <span>Busca concluída! Ofertas atualizadas com sucesso.</span>
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

        {/* 3. Lista de Mercado Monitorada (Tauste & Carrefour) */}
        <section className="radar-section">
          <div className="radar-section-header">
            <h2 className="radar-section-title">
              Lista Monitorada (Tauste &amp; Carrefour)
            </h2>
            <span className="radar-section-badge">Meta: &gt;50% OFF</span>
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

          {loadingProdutos ? (
            <div className="radar-empty-state">
              <Loader2
                size={22}
                className="radar-spinner"
                style={{ margin: '0 auto 8px', display: 'block' }}
              />
              Carregando lista monitorada...
            </div>
          ) : produtos.length === 0 ? (
            <div className="radar-empty-state">
              <ShoppingBasket
                size={26}
                style={{ margin: '0 auto 8px', display: 'block', color: '#94a3b8' }}
              />
              Nenhum produto na lista ainda. Adicione itens acima para monitorar
              descontos no Tauste e Carrefour!
            </div>
          ) : (
            <div className="radar-products-list">
              {produtos.map((item) => {
                const nome =
                  item.nome || item.produto || item.nome_produto || 'Produto';
                const precoNormal = Number(item.preco_referencia || 0);
                const menorPreco =
                  item.menor_preco_encontrado !== null &&
                  item.menor_preco_encontrado !== undefined
                    ? Number(item.menor_preco_encontrado)
                    : null;

                const desconto =
                  menorPreco !== null && precoNormal > 0
                    ? ((precoNormal - menorPreco) / precoNormal) * 100
                    : null;

                const isSuperOferta =
                  Boolean(item.super_oferta) ||
                  (desconto !== null && desconto >= 50);

                const mercado =
                  item.mercado_vencedor ||
                  item.mercado ||
                  item.supermercado ||
                  item.loja ||
                  null;

                return (
                  <article
                    key={item.id}
                    className={`radar-product-card ${
                      isSuperOferta ? 'is-super-oferta' : ''
                    }`}
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
