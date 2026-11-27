import os
import time
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
from supabase import create_client

# Preencha com as credenciais do seu Supabase (via variáveis de ambiente ou padrão)
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://eyinimyrycqaafupkaaa.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "SUA_SERVICE_ROLE_KEY")
CEP_SPAZIO_TREVILE = "12070-000"  # Ajuste para o CEP exato da rua do Spazio Trevile

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def buscar_preco_carrefour(page, termo):
    try:
        url = f"https://mercado.carrefour.com.br/busca/{termo.replace(' ', '%20')}"
        page.goto(url, timeout=25000)
        page.wait_for_timeout(3000)
        # Captura o primeiro preço visível na vitrine
        preco_el = page.locator("[data-test-id='price-value'], .text-blue-royal").first
        if preco_el.is_visible():
            texto = (
                preco_el.inner_text()
                .replace("R$", "")
                .replace(".", "")
                .replace(",", ".")
                .strip()
            )
            return float(texto), url
    except Exception as e:
        print(f"[Carrefour] Erro ao buscar {termo}: {e}")
    return None, None


def buscar_preco_tauste(page, termo):
    try:
        url = f"https://tauste.com.br/taubate/catalogsearch/result/?q={termo.replace(' ', '+')}"
        page.goto(url, timeout=25000)
        page.wait_for_timeout(3000)
        preco_el = page.locator(".price-wrapper .price").first
        if preco_el.is_visible():
            texto = (
                preco_el.inner_text()
                .replace("R$", "")
                .replace(".", "")
                .replace(",", ".")
                .strip()
            )
            return float(texto), url
    except Exception as e:
        print(f"[Tauste] Erro ao buscar {termo}: {e}")
    return None, None


def executar_varredura(execucao_id):
    supabase.table("radar_execucoes").update({"status": "rodando"}).eq(
        "id", execucao_id
    ).execute()
    produtos = supabase.table("radar_produtos").select("*").execute().data

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(locale="pt-BR")
        page = context.new_page()

        for prod in produtos:
            nome = prod["nome"]
            ref = float(prod["preco_referencia"])
            print(f"Buscando: {nome}...")

            p_carrefour, link_c = buscar_preco_carrefour(page, nome)
            p_tauste, link_t = buscar_preco_tauste(page, nome)

            candidatos = []
            if p_carrefour:
                candidatos.append((p_carrefour, "Carrefour", link_c))
            if p_tauste:
                candidatos.append((p_tauste, "Tauste", link_t))

            if candidatos:
                menor_preco, mercado, link = min(candidatos, key=lambda x: x[0])
                desconto = ((ref - menor_preco) / ref) * 100
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
    ).eq("id", execucao_id).execute()
    print("Varredura concluída!")


if __name__ == "__main__":
    print("Radar Worker ativo aguardando cliques da Juliana...")
    while True:
        res = (
            supabase.table("radar_execucoes")
            .select("*")
            .eq("status", "pendente")
            .execute()
        )
        if res.data:
            executar_varredura(res.data[0]["id"])
        time.sleep(5)
