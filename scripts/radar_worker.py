import os
import time
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


def otimizar_pagina(page):
    """Bloqueia imagens, mídia, CSS e fontes para acelerar em até 5x."""
    page.route(
        "**/*",
        lambda route: route.abort()
        if route.request.resource_type in ["image", "media", "font", "stylesheet"]
        else route.continue_(),
    )


def extrair_valor(texto: str) -> float | None:
    limpo = "".join(c for c in texto if c.isdigit() or c in [",", "."])
    limpo = limpo.replace(".", "").replace(",", ".").strip()
    try:
        val = float(limpo)
        return val if val > 0 else None
    except ValueError:
        return None


def buscar_carrefour(page, termo: str):
    try:
        url = f"https://mercado.carrefour.com.br/busca/{termo.replace(' ', '%20')}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        el = page.locator("[data-test-id='price-value'], .text-blue-royal").first
        if el.is_visible():
            return extrair_valor(el.inner_text()), url
    except Exception:
        pass
    return None, None


def buscar_tauste(page, termo: str):
    try:
        url = f"https://tauste.com.br/taubate/catalogsearch/result/?q={termo.replace(' ', '+')}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        el = page.locator(".price-wrapper .price").first
        if el.is_visible():
            return extrair_valor(el.inner_text()), url
    except Exception:
        pass
    return None, None


def buscar_shibata(page, termo: str):
    try:
        url = f"https://www.shibatacasaemercado.com.br/busca?q={termo.replace(' ', '%20')}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        el = page.locator(".price, [class*='price'], [class*='Price']").first
        if el.is_visible():
            return extrair_valor(el.inner_text()), url
    except Exception:
        pass
    return None, None


def buscar_nagumo(page, termo: str):
    try:
        url = f"https://www.nagumo.com.br/taubate/busca?q={termo.replace(' ', '%20')}"
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        el = page.locator(".price, [class*='price'], [class*='Price']").first
        if el.is_visible():
            return extrair_valor(el.inner_text()), url
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
            # Busca apenas os monitorados para manter alta performance
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
                context = browser.new_context(locale="pt-BR")
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

                        supabase.table("radar_produtos").update(
                            {
                                "menor_preco_encontrado": menor_preco,
                                "mercado_vencedor": mercado,
                                "link_oferta": link,
                                "super_oferta": super_oferta,
                                "atualizado_em": datetime.now(timezone.utc).isoformat(),
                            }
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
