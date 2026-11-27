-- 1. Evoluir a tabela de produtos
ALTER TABLE radar_produtos
ADD COLUMN IF NOT EXISTS monitorado BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS pre_lista BOOLEAN DEFAULT FALSE;

-- 2. Permitir execução individual na fila (sem travar as 8h da busca geral)
ALTER TABLE radar_execucoes
ADD COLUMN IF NOT EXISTS produto_id UUID REFERENCES radar_produtos(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'geral'; -- 'geral' (trava 8h) ou 'individual' (livre)
