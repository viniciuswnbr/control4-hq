import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
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
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}
STOP_WORDS = {"de", "da", "do", "das", "dos", "com", "sem", "para", "em", "e", "ou", "tipo"}

if not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_KEY não encontrada no ambiente ou nos arquivos .env")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize_text(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", value.lower())
        if unicodedata.category(c) != "Mn"
    )


def extract_keywords(query: str) -> list[str]:
    return [
        tok for tok in re.split(r"[^a-z0-9]+", normalize_text(query))
        if len(tok) >= 2 and tok not in STOP_WORDS
    ]


def matches_title(title: str, keywords: list[str]) -> bool:
    if not keywords:
        return True
    return keywords[0] in normalize_text(title)


def score_title(title: str, keywords: list[str]) -> int:
    norm = normalize_text(title)
    return sum(1 for kw in keywords if kw in norm)


def parse_brl(raw: str) -> float | None:
    cleaned = re.sub(r"[^\d,.]", "", raw.replace("&nbsp;", " ")).strip()
    if not cleaned:
        return None
    normalized = cleaned.replace(".", "").replace(",", ".") if "," in cleaned else cleaned
    try:
        val = float(normalized)
        return val if val > 0 else None
    except ValueError:
        return None


def fetch_html(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read().decode("utf-8", "ignore")
    except Exception:
        return None


def buscar_preco_carrefour(termo: str):
    url = f"https://mercado.carrefour.com.br/busca/{urllib.parse.quote(termo)}"
    html = fetch_html(url)
    if not html:
        return None, None

    keywords = extract_keywords(termo)
    pattern = re.compile(
        r"<h2[^>]*>([^<]+)</h2>[\s\S]{0,1200}?text-price-default[^>]*>([^<]+)<",
        re.I,
    )
    candidates = []
    for title, raw_price in pattern.findall(html):
        if not matches_title(title, keywords):
            continue
        preco = parse_brl(raw_price)
        if preco:
            candidates.append((score_title(title, keywords), preco))

    if not candidates:
        return None, None
    max_score = max(c[0] for c in candidates)
    best_price = min(p for s, p in candidates if s == max_score)
    return best_price, url


def buscar_preco_tauste(termo: str):
    url = f"https://tauste.com.br/taubate/catalogsearch/result/?q={urllib.parse.quote_plus(termo)}"
    html = fetch_html(url)
    if not html:
        return None, None

    keywords = extract_keywords(termo)
    pattern = re.compile(
        r'<strong class="product-item-name">\s*<a[^>]*>([\s\S]*?)</a>\s*</strong>[\s\S]{0,1500}?class="price"[^>]*>([^<]+)<',
        re.I,
    )
    candidates = []
    for title, raw_price in pattern.findall(html):
        clean_title = re.sub(r"\s+", " ", title).strip()
        if not matches_title(clean_title, keywords):
            continue
        preco = parse_brl(raw_price)
        if preco:
            candidates.append((score_title(clean_title, keywords), preco))

    if not candidates:
        return None, None
    max_score = max(c[0] for c in candidates)
    best_price = min(p for s, p in candidates if s == max_score)
    return best_price, url


def processar_produto(prod: dict):
    nome = prod["nome"]
    ref = float(prod["preco_referencia"])
    print(f"Buscando: {nome}...")

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_c = pool.submit(buscar_preco_carrefour, nome)
        f_t = pool.submit(buscar_preco_tauste, nome)
        p_carrefour, link_c = f_c.result()
        p_tauste, link_t = f_t.result()

    candidatos = []
    if p_carrefour:
        candidatos.append((p_carrefour, "Carrefour", link_c))
    if p_tauste:
        candidatos.append((p_tauste, "Tauste", link_t))

    if candidatos:
        menor_preco, mercado, link = min(candidatos, key=lambda x: x[0])
        desconto = ((ref - menor_preco) / ref) * 100 if ref > 0 else 0
        supabase.table("radar_produtos").update(
            {
                "menor_preco_encontrado": menor_preco,
                "mercado_vencedor": mercado,
                "link_oferta": link,
                "super_oferta": desconto >= 50.0,
                "atualizado_em": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", prod["id"]).execute()


def executar_varredura(execucao_id: str):
    supabase.table("radar_execucoes").update({"status": "rodando"}).eq(
        "id", execucao_id
    ).execute()

    try:
        produtos = supabase.table("radar_produtos").select("*").execute().data or []
        if produtos:
            with ThreadPoolExecutor(max_workers=5) as pool:
                list(pool.map(processar_produto, produtos))

        supabase.table("radar_execucoes").update(
            {
                "status": "concluido",
                "finalizado_em": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", execucao_id).execute()
        print("Varredura concluída!")
    except Exception as exc:
        print(f"Erro na varredura: {exc}")
        supabase.table("radar_execucoes").update(
            {
                "status": "erro",
                "finalizado_em": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", execucao_id).execute()


if __name__ == "__main__":
    print("Radar Worker (HTTP paralelo) ativo aguardando cliques...")
    while True:
        res = (
            supabase.table("radar_execucoes")
            .select("*")
            .eq("status", "pendente")
            .execute()
        )
        if res.data:
            executar_varredura(res.data[0]["id"])
        time.sleep(3)
