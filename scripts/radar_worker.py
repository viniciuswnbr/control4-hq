import os
import re
import time
import unicodedata
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
from supabase import create_client


def load_env_files():
    """Carrega variáveis do .env local ou do _orchestrator/.env sem sobrescrever o ambiente."""
    root_dir = Path(__file__).resolve().parent.parent
    candidates = [
        root_dir / ".env",
        root_dir.parent / "_orchestrator" / ".env",
    ]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_files()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://eyinimyrycqaafupkaaa.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SECRET_KEY") or ""

if not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_KEY não encontrada no ambiente ou nos arquivos .env")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

STOP_WORDS = {
    "de", "da", "do", "das", "dos", "com", "sem", "para", "em", "e", "ou", "tipo", "rolos", "rolo"
}
SIZE_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litros?)\b", re.I)
PACK_RE = re.compile(r"\b(\d+)\s*rolos?\b", re.I)
PRICE_RE = re.compile(r"R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\s*/)")

EXCLUSIONS = {
    "leite": ["condensado", "creme de leite", "coco", "doce de leite", "achocolatado", "iogurte", "composto lacteo", "bebida lactea", "em po", "cafe com leite", "sachet", "sache", "cappuccino"],
    "arroz": ["tempero", "chips", "biscoito", "bolacha", "farinha", "vinagre", "arroz doce", "bebida"],
    "cafe": ["capsula", "cappuccino", "achocolatado", "filtro", "biscoito", "bala"],
    "azeite": ["sardinha", "atum", "molho", "tempero", "azeitona"],
    "oleo": ["azeite", "corporal", "capilar", "motor"],
    "acucar": ["adocante", "bala", "doce", "achocolatado"],
    "feijao": ["tempero", "caldo"],
    "frango": ["tempero", "caldo", "nuggets", "empanado", "salsicha", "mortadela", "hamburguer"],
    "sabao": ["amaciante", "agua sanitaria"],
}


def normalize_text(value: str) -> str:
    no_accents = "".join(
        c for c in unicodedata.normalize("NFD", value.lower())
        if unicodedata.category(c) != "Mn"
    )
    no_accents = re.sub(r"(\d),(\d)", r"\1.\2", no_accents)
    no_accents = re.sub(r"\b(\d+(?:\.\d+)?)\s*(litros?)\b", r"\1l", no_accents)
    no_accents = re.sub(r"\b(\d+(?:\.\d+)?)\s+(kg|g|ml|l)\b", r"\1\2", no_accents)
    return no_accents


def matches_product(title: str, query: str, price: float, ref: float = 0.0) -> bool:
    norm_title = normalize_text(title)
    norm_query = normalize_text(query)

    # 1. Trava de sanidade de preço (evita miniatura/preço por 100g/erro >75% OFF)
    if ref > 0 and price < ref * 0.25:
        return False

    # 2. Exclusões semânticas (ex: não aceitar "tempero para arroz" ao buscar "arroz")
    for head, blocked_words in EXCLUSIONS.items():
        if re.search(rf"\b{head}\b", norm_query):
            for bw in blocked_words:
                if bw not in norm_query and bw in norm_title:
                    return False

    # 3. Peso / volume exato com fronteira de palavra
    query_sizes = [f"{m.group(1)}{m.group(2)}" for m in SIZE_RE.finditer(norm_query)]
    for sz in query_sizes:
        if not re.search(rf"(?<![\d.]){re.escape(sz)}\b", norm_title):
            return False

    # Se a busca não especificou tamanho (ex: "leite zero lactose"), evita sachês/miniaturas (<100g ou <300ml)
    if not query_sizes and ref >= 5.0:
        if re.search(r"\b(?:[1-9]\d?g|[1-2]\d{2}ml)\b", norm_title):
            return False

    # 4. Quantidade de rolos (ex: "12 rolos")
    for m in PACK_RE.finditer(norm_query):
        qty = m.group(1)
        if not re.search(rf"(?<!\d){qty}(?:\s*(?:rolos?|un|unidades?)|(?=\s|$))", norm_title):
            return False

    # 5. Palavras-chave principais (com sinônimo "sabao em po" <-> "lava roupas po")
    if "sabao" in norm_query and "po" in norm_query:
        has_sabao_po = ("sabao" in norm_title and "po" in norm_title) or (
            "lava" in norm_title and "roupas" in norm_title and "po" in norm_title
        )
        if not has_sabao_po:
            return False
        return True

    tokens = [
        t for t in re.split(r"[^a-z0-9.]+", norm_query)
        if len(t) >= 2 and t not in STOP_WORDS and not SIZE_RE.fullmatch(t) and not t.isdigit()
    ]
    if not tokens:
        return True
    return all(re.search(rf"\b{re.escape(tok)}", norm_title) for tok in tokens)


def extract_best_price_from_text(text: str) -> float | None:
    prices = []
    for m in PRICE_RE.finditer(text):
        raw = m.group(1).replace(".", "").replace(",", ".")
        try:
            val = float(raw)
            if 0.5 <= val <= 5000:
                prices.append(val)
        except ValueError:
            pass
    return min(prices) if prices else None


def pick_best_candidate(
    candidates: list[tuple[str, float, str]], query: str, ref: float = 0.0
) -> tuple[float, str, str] | None:
    valid = []
    for title, price, link in candidates:
        if matches_product(title, query, price, ref):
            valid.append((price, link, title))
    if not valid:
        return None
    return min(valid, key=lambda x: x[0])


def otimizar_pagina(page):
    """Bloqueia imagens, mídia e fontes (mantém CSS para não quebrar layout/visibilidade)."""
    page.route(
        "**/*",
        lambda route: route.abort()
        if route.request.resource_type in ["image", "media", "font"]
        else route.continue_(),
    )


def buscar_carrefour(page, termo: str, ref: float = 0.0):
    try:
        url = f"https://mercado.carrefour.com.br/busca/{urllib.parse.quote(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('a[href*="/produto/"]')).map(a => ({
                href: a.getAttribute('href') || '',
                title: (a.querySelector('h2, h3')?.innerText || a.innerText || '').replace(/\\s+/g, ' ').trim(),
                text: (a.innerText || '').replace(/\\s+/g, ' ').trim()
            })).filter(c => c.text.includes('R$') && c.text.length < 300);
        }""")
        candidates = []
        for c in cards:
            price = extract_best_price_from_text(c["text"])
            if price:
                link = f"https://mercado.carrefour.com.br{c['href']}" if c["href"].startswith("/") else url
                candidates.append((c["title"], price, link))
        best = pick_best_candidate(candidates, termo, ref)
        if best:
            return best[0], best[1], best[2]
    except Exception:
        pass
    return None, None, None


def buscar_tauste(page, termo: str, ref: float = 0.0):
    try:
        url = f"https://tauste.com.br/taubate/catalogsearch/result/?q={urllib.parse.quote_plus(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('.product-item')).map(el => ({
                title: (el.querySelector('.product-item-name a')?.innerText || '').replace(/\\s+/g, ' ').trim(),
                priceText: (el.querySelector('[data-price-type="finalPrice"] .price, .price-box .price')?.innerText || '').replace(/\\s+/g, ' ').trim(),
                href: el.querySelector('.product-item-name a')?.getAttribute('href') || ''
            })).filter(c => c.title && c.priceText);
        }""")
        candidates = []
        for c in cards:
            price = extract_best_price_from_text(c["priceText"])
            if price:
                candidates.append((c["title"], price, c["href"] or url))
        best = pick_best_candidate(candidates, termo, ref)
        if best:
            return best[0], best[1], best[2]
    except Exception:
        pass
    return None, None, None


def buscar_shibata(page, termo: str, ref: float = 0.0):
    try:
        url = f"https://www.loja.shibata.com.br/busca?termo={urllib.parse.quote(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2800)
        cards = page.evaluate("""() => {
            const res = [];
            document.querySelectorAll('app-product-card, [class*="product-card"], [class*="card-product"], a[href*="/produto/"]').forEach(el => {
                const txt = (el.innerText || '').replace(/\\s+/g, ' ').trim();
                const a = el.tagName === 'A' ? el : el.querySelector('a[href]');
                if (txt.includes('R$') && txt.length > 8 && txt.length < 280) {
                    res.push({text: txt, href: a ? a.getAttribute('href') : ''});
                }
            });
            return res;
        }""")
        candidates = []
        for c in cards:
            price = extract_best_price_from_text(c["text"])
            if price:
                href = c["href"]
                link = f"https://www.loja.shibata.com.br{href}" if href.startswith("/") else (href or url)
                candidates.append((c["text"], price, link))
        best = pick_best_candidate(candidates, termo, ref)
        if best:
            return best[0], best[1], best[2]
    except Exception:
        pass
    return None, None, None


def buscar_nagumo(page, termo: str, ref: float = 0.0):
    try:
        url = f"https://www.nagumo.com.br/busca?q={urllib.parse.quote_plus(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('.productCard')).map(el => ({
                text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
                href: el.querySelector('a[href]')?.getAttribute('href') || ''
            })).filter(c => c.text.includes('R$') && !c.text.includes('Produto Indisponível'));
        }""")
        candidates = []
        for c in cards:
            price = extract_best_price_from_text(c["text"])
            if price:
                href = c["href"]
                link = f"https://www.nagumo.com.br{href}" if href.startswith("/") else (href or url)
                candidates.append((c["text"], price, link))
        best = pick_best_candidate(candidates, termo, ref)
        if best:
            return best[0], best[1], best[2]
    except Exception:
        pass
    return None, None, None


def pode_rodar_geral() -> bool:
    res = (
        supabase.table("radar_execucoes")
        .select("finalizado_em")
        .eq("tipo", "geral")
        .eq("status", "concluido")
        .order("finalizado_em", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data or not res.data[0].get("finalizado_em"):
        return True
    ultimo = datetime.fromisoformat(res.data[0]["finalizado_em"].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - ultimo) >= timedelta(hours=8)


def processar_execucao(execucao: dict):
    exec_id = execucao["id"]
    tipo = execucao.get("tipo") or "geral"
    produto_id = execucao.get("produto_id")

    if tipo == "geral" and not pode_rodar_geral():
        print("Execução geral bloqueada: intervalo mínimo de 8 horas não atingido.")
        supabase.table("radar_execucoes").update({"status": "bloqueado_8h"}).eq(
            "id", exec_id
        ).execute()
        return

    supabase.table("radar_execucoes").update({"status": "rodando"}).eq(
        "id", exec_id
    ).execute()

    try:
        if tipo == "individual" and produto_id:
            produtos = (
                supabase.table("radar_produtos")
                .select("*")
                .eq("id", produto_id)
                .execute()
                .data
                or []
            )
        else:
            produtos = (
                supabase.table("radar_produtos")
                .select("*")
                .eq("monitorado", True)
                .execute()
                .data
                or []
            )

        if produtos:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    locale="pt-BR",
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                )
                page = context.new_page()
                otimizar_pagina(page)

                for prod in produtos:
                    nome = prod["nome"]
                    ref = float(prod["preco_referencia"] or 0)
                    print(f"[{tipo.upper()}] Buscando: {nome}...")

                    resultados = []
                    for fn, mercado in [
                        (buscar_carrefour, "Carrefour"),
                        (buscar_tauste, "Tauste"),
                        (buscar_shibata, "Shibata"),
                        (buscar_nagumo, "Nagumo"),
                    ]:
                        preco, link, matched_title = fn(page, nome, ref)
                        if preco and preco > 0:
                            resultados.append((preco, mercado, link, matched_title))

                    if resultados:
                        menor_preco, mercado, link, matched_title = min(
                            resultados, key=lambda x: x[0]
                        )
                        print(f"  -> Vencedor: {mercado} | R$ {menor_preco:.2f} | {matched_title[:60]}")
                        desconto = ((ref - menor_preco) / ref) * 100 if ref > 0 else 0
                        super_oferta = desconto >= 50.0

                        update_payload = {
                            "menor_preco_encontrado": menor_preco,
                            "mercado_vencedor": mercado,
                            "link_oferta": link,
                            "super_oferta": super_oferta,
                            "atualizado_em": datetime.now(timezone.utc).isoformat(),
                        }
                        if (
                            "preco_anterior" in prod
                            and prod.get("menor_preco_encontrado") is not None
                        ):
                            update_payload["preco_anterior"] = prod[
                                "menor_preco_encontrado"
                            ]

                        supabase.table("radar_produtos").update(
                            update_payload
                        ).eq("id", prod["id"]).execute()

                browser.close()

        supabase.table("radar_execucoes").update(
            {
                "status": "concluido",
                "finalizado_em": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", exec_id).execute()
        print(f"Execução {tipo} finalizada!")
    except Exception as exc:
        print(f"Erro na execução {tipo}: {exc}")
        supabase.table("radar_execucoes").update(
            {
                "status": "erro",
                "finalizado_em": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", exec_id).execute()


if __name__ == "__main__":
    print("Radar Worker (4 Mercados + Trava 8h) ativo...")
    while True:
        res = (
            supabase.table("radar_execucoes")
            .select("*")
            .eq("status", "pendente")
            .order("criado_em")
            .limit(1)
            .execute()
        )
        if res.data:
            processar_execucao(res.data[0])
        time.sleep(4)
