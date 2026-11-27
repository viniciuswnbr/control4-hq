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
SIZE_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b", re.I)
PRICE_RE = re.compile(r"R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\s*/)")


def normalize_text(value: str) -> str:
    no_accents = "".join(
        c for c in unicodedata.normalize("NFD", value.lower())
        if unicodedata.category(c) != "Mn"
    )
    # Normaliza espaços entre número e unidade: "5 kg" -> "5kg", "1,6 kg" -> "1.6kg"
    no_accents = re.sub(r"(\d),(\d)", r"\1.\2", no_accents)
    no_accents = re.sub(r"(\d+(?:\.\d+)?)\s+(kg|g|ml|l)\b", r"\1\2", no_accents)
    return no_accents


def matches_product(title: str, query: str) -> bool:
    norm_title = normalize_text(title)
    norm_query = normalize_text(query)

    # 1. Se a busca especifica peso/volume (ex: 5kg, 500g, 900ml, 1l), exige correspondência exata
    query_sizes = [f"{m.group(1).replace(',', '.')}{m.group(2)}" for m in SIZE_RE.finditer(norm_query)]
    for sz in query_sizes:
        if sz not in norm_title:
            return False

    # 2. Exige que todas as palavras-chave principais da busca apareçam no título
    tokens = [
        t for t in re.split(r"[^a-z0-9.]+", norm_query)
        if len(t) >= 2 and t not in STOP_WORDS and not SIZE_RE.fullmatch(t)
    ]
    if not tokens:
        return True
    return all(tok in norm_title for tok in tokens)


def extract_best_price_from_text(text: str) -> float | None:
    # Ignora preços unitários como "R$ 36,49/kg" graças ao lookahead negativo em PRICE_RE
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


def pick_best_candidate(candidates: list[tuple[str, float, str]], query: str) -> tuple[float, str] | None:
    valid = []
    for title, price, link in candidates:
        if matches_product(title, query):
            valid.append((price, link))
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


def buscar_carrefour(page, termo: str):
    try:
        url = f"https://mercado.carrefour.com.br/busca/{urllib.parse.quote(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('a[href*="/produto/"]')).map(a => ({
                href: a.getAttribute('href') || '',
                text: (a.innerText || '').replace(/\\s+/g, ' ').trim()
            })).filter(c => c.text.includes('R$') && c.text.length < 300);
        }""")
        candidates = []
        for c in cards:
            price = extract_best_price_from_text(c["text"])
            if price:
                link = f"https://mercado.carrefour.com.br{c['href']}" if c["href"].startswith("/") else url
                candidates.append((c["text"], price, link))
        best = pick_best_candidate(candidates, termo)
        if best:
            return best
    except Exception:
        pass
    return None, None


def buscar_tauste(page, termo: str):
    try:
        url = f"https://tauste.com.br/taubate/catalogsearch/result/?q={urllib.parse.quote_plus(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('.product-item')).map(el => ({
                title: (el.querySelector('.product-item-name')?.innerText || '').replace(/\\s+/g, ' ').trim(),
                priceText: (el.querySelector('.price')?.innerText || '').replace(/\\s+/g, ' ').trim(),
                href: el.querySelector('.product-item-link')?.getAttribute('href') || ''
            })).filter(c => c.title && c.priceText);
        }""")
        candidates = []
        for c in cards:
            price = extract_best_price_from_text(c["priceText"])
            if price:
                candidates.append((c["title"], price, c["href"] or url))
        best = pick_best_candidate(candidates, termo)
        if best:
            return best
    except Exception:
        pass
    return None, None


def buscar_shibata(page, termo: str):
    try:
        url = f"https://www.loja.shibata.com.br/busca?termo={urllib.parse.quote(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        lines = [l.strip() for l in page.locator("body").inner_text().splitlines() if l.strip()]
        candidates = []
        for idx, line in enumerate(lines):
            if "R$" in line or len(line) < 6:
                continue
            window_text = " ".join(lines[idx : idx + 4])
            if "R$" in window_text and len(window_text) < 240:
                price = extract_best_price_from_text(window_text)
                if price:
                    candidates.append((line, price, url))
        best = pick_best_candidate(candidates, termo)
        if best:
            return best
    except Exception:
        pass
    return None, None


def buscar_nagumo(page, termo: str):
    try:
        url = f"https://www.nagumo.com.br/busca?q={urllib.parse.quote_plus(termo)}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        # Extrai blocos do texto renderizado contendo título + R$ (ou Por: R$)
        lines = [l.strip() for l in page.locator("body").inner_text().splitlines() if l.strip()]
        candidates = []
        for idx, line in enumerate(lines):
            if "R$" in line or len(line) < 6:
                continue
            window_text = " ".join(lines[idx : idx + 5])
            if "R$" in window_text and len(window_text) < 260:
                price = extract_best_price_from_text(window_text)
                if price:
                    candidates.append((line, price, url))
        best = pick_best_candidate(candidates, termo)
        if best:
            return best
    except Exception:
        pass
    return None, None


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
                        preco, link = fn(page, nome)
                        if preco and preco > 0:
                            resultados.append((preco, mercado, link))

                    if resultados:
                        menor_preco, mercado, link = min(resultados, key=lambda x: x[0])
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
