const db = window.supabase.createClient(HQ_CONFIG.SUPABASE_URL, HQ_CONFIG.SUPABASE_ANON_KEY);

let agents = [];
let missions = [];
let logs = [];

async function init() {
  await Promise.all([loadAgents(), loadMissions(), loadLogs()]);
  setupRealtime();
  document.getElementById("conn-status").textContent = "● Online (Realtime)";
}

async function loadAgents() {
  const { data } = await db.from("agents").select("*").order("room").order("project_name");
  if (data) {
    agents = data;
    populateSelect();
    renderDashboard();
  }
}

async function loadMissions() {
  const { data } = await db
    .from("missions")
    .select("*")
    .in("status", ["BACKLOG", "DRAFTING", "PENDING", "IN_IDE"])
    .order("created_at", { ascending: false });
  if (data) {
    missions = data;
    renderDashboard();
  }
}

async function loadLogs() {
  const { data } = await db.from("execution_logs").select("*").order("created_at", { ascending: false }).limit(25);
  if (data) {
    logs = data;
    renderLogs();
  }
}

function setupRealtime() {
  db.channel("hq-command-center")
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => loadAgents())
    .on("postgres_changes", { event: "*", schema: "public", table: "missions" }, () => loadMissions())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_logs" }, payload => {
      logs.unshift(payload.new);
      if (logs.length > 30) logs.pop();
      renderLogs();
    })
    .subscribe();
}

function renderDashboard() {
  const grid = document.getElementById("projectsGrid");
  const workingCount = agents.filter(a => a.status === "WORKING").length;
  const backlogCount = missions.filter(m => m.status === "BACKLOG").length;

  document.getElementById("statWorking").textContent = workingCount;
  document.getElementById("statBacklog").textContent = backlogCount;

  grid.innerHTML = agents.map(agent => {
    const projectMissions = missions.filter(m => m.agent_id === agent.id);
    const activeItems = projectMissions.filter(m => ["DRAFTING", "PENDING", "IN_IDE"].includes(m.status));
    const backlogItems = projectMissions.filter(m => m.status === "BACKLOG");

    const statusLabel = agent.status === "WORKING" ? "⚡ Em Execução" : (agent.status === "ERROR" ? "🚨 Alerta" : "Pronto");
    const cardClass = agent.status === "WORKING" ? "card working" : (agent.status === "ERROR" ? "card error" : "card");

    const linkHtml = agent.url && agent.url.startsWith("http")
      ? `<a href="${agent.url}" target="_blank" style="color:#60a5fa; text-decoration:none;">↗ Abrir App</a>`
      : `<span>📁 ${agent.local_path.split("\\").pop()}</span>`;

    return `
      <div class="${cardClass}">
        <div class="card-header">
          <div>
            <h3 class="card-title">${agent.project_name}</h3>
            <div class="card-meta">${agent.room} • ${linkHtml}</div>
          </div>
          <span class="status-badge st-${agent.status}">${statusLabel}</span>
        </div>

        <div class="stack-line">${agent.stack || "Stack Padrão"}</div>

        <div class="backlog-box">
          <div class="backlog-header">
            <span>Fila de Melhorias (${backlogItems.length})</span>
            <button class="btn btn-sm btn-ai" onclick="auditProject('${agent.id}')">✨ Sugerir Melhorias</button>
          </div>

          <div class="backlog-list">
            ${activeItems.map(m => `
              <div class="backlog-item active-ide">
                <div class="backlog-text"><strong>[NA IDE]</strong> ${escapeHtml(m.raw_idea)}</div>
                <div class="item-actions">
                  <button class="btn btn-sm btn-ghost" title="Marcar como concluído" onclick="completeMission('${m.id}', '${agent.id}')">✓</button>
                </div>
              </div>
            `).join("")}

            ${backlogItems.map(m => `
              <div class="backlog-item">
                <div class="backlog-text">${escapeHtml(m.raw_idea)}</div>
                <div class="item-actions">
                  <button class="btn btn-sm btn-exec" title="Enviar agora para Antigravity IDE" onclick="promoteToIDE('${m.id}')">▶ IDE</button>
                  <button class="btn btn-sm btn-ghost" title="Remover ideia" onclick="deleteMission('${m.id}')">✕</button>
                </div>
              </div>
            `).join("")}

            ${(activeItems.length === 0 && backlogItems.length === 0)
              ? `<div style="font-size:0.78rem; color:#6b7280; padding:8px; text-align:center;">Nenhuma melhoria pendente. Adicione abaixo ou clique em Sugerir.</div>`
              : ""}
          </div>
        </div>

        <div class="quick-add">
          <input type="text" id="input-${agent.id}" placeholder="+ Anotar ideia de melhoria..." onkeydown="if(event.key==='Enter') quickAddIdea('${agent.id}')">
          <button class="btn btn-sm btn-ghost" onclick="quickAddIdea('${agent.id}')">Add</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderLogs() {
  const container = document.getElementById("logList");
  container.innerHTML = logs.map(l => {
    const time = new Date(l.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `
      <div class="log-item ${l.level}">
        <div class="log-time">${time} • <strong>${l.agent_id || "SISTEMA"}</strong></div>
        <div>${escapeHtml(l.message)}</div>
      </div>
    `;
  }).join("");
}

// Ações Rápidas nos Cards
async function quickAddIdea(agentId) {
  const input = document.getElementById(`input-${agentId}`);
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await db.from("missions").insert({ agent_id: agentId, task_type: "FEATURE", raw_idea: text, status: "BACKLOG" });
  loadMissions();
}

async function promoteToIDE(missionId) {
  await db.from("missions").update({ status: "PENDING" }).eq("id", missionId);
  loadMissions();
}

async function completeMission(missionId, agentId) {
  await db.from("missions").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", missionId);
  await db.from("agents").update({ status: "LOUNGE", current_task_summary: "Concluído via Command Center" }).eq("id", agentId);
  loadAgents();
  loadMissions();
}

async function deleteMission(missionId) {
  await db.from("missions").delete().eq("id", missionId);
  loadMissions();
}

// Auditor de Melhorias com IA (Gera 3 ideias estratégicas por projeto)
async function auditProject(agentId) {
  const key = localStorage.getItem("HQ_GEMINI_KEY");
  if (!key) {
    openKeyModal();
    return;
  }

  const agent = agents.find(a => a.id === agentId);
  document.getElementById("auditTitle").textContent = `✨ Sugestões para ${agent.project_name}`;
  document.getElementById("auditResults").innerHTML = `<p style="color:#9ca3af;">Analisando stack e regras de negócio...</p>`;
  document.getElementById("auditModal").style.display = "flex";

  const prompt = `Você é um Arquiteto de Software e Produto Sênior.
Analise o projeto abaixo e sugira exatamente 3 melhorias práticas, de alto impacto e implementação rápida.
Projeto: ${agent.project_name}
Stack: ${agent.stack}
Regras: ${agent.agent_context}

Responda APENAS com um array JSON válido de 3 strings curtas e diretas (sem markdown, sem crases). Exemplo:
["Melhoria 1", "Melhoria 2", "Melhoria 3"]`;

  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await resp.json();
    const rawText = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
    const suggestions = JSON.parse(rawText);

    document.getElementById("auditResults").innerHTML = suggestions.map((s, idx) => `
      <div class="suggestion-card">
        <span>${escapeHtml(s)}</span>
        <button class="btn btn-sm" onclick="acceptSuggestion('${agent.id}', ${idx})">+ Backlog</button>
      </div>
    `).join("");
    window._lastSuggestions = suggestions;
  } catch (err) {
    document.getElementById("auditResults").innerHTML = `<p style="color:#f87171;">Erro ao gerar sugestões. Verifique sua chave Gemini em "🔑 API Auditor".</p>`;
  }
}

async function acceptSuggestion(agentId, idx) {
  const idea = window._lastSuggestions[idx];
  if (!idea) return;
  await db.from("missions").insert({ agent_id: agentId, task_type: "FEATURE", raw_idea: idea, status: "BACKLOG" });
  loadMissions();
  closeModals();
}

// Modais
function populateSelect() {
  document.getElementById("agentSelect").innerHTML = agents.map(a => `<option value="${a.id}">${a.project_name} (${a.room})</option>`).join("");
}

function openNewMissionModal() {
  document.getElementById("missionModal").style.display = "flex";
  document.getElementById("rawIdeaInput").focus();
}

async function saveMission(targetStatus) {
  const agent_id = document.getElementById("agentSelect").value;
  const task_type = document.getElementById("taskTypeSelect").value;
  const raw_idea = document.getElementById("rawIdeaInput").value.trim();
  if (!raw_idea) return alert("Descreva a ideia ou melhoria.");

  await db.from("missions").insert({ agent_id, task_type, raw_idea, status: targetStatus });
  document.getElementById("rawIdeaInput").value = "";
  closeModals();
  loadMissions();
}

function openKeyModal() {
  document.getElementById("geminiKeyInput").value = localStorage.getItem("HQ_GEMINI_KEY") || "";
  document.getElementById("keyModal").style.display = "flex";
}

function saveBrowserKey() {
  const val = document.getElementById("geminiKeyInput").value.trim();
  if (val) localStorage.setItem("HQ_GEMINI_KEY", val);
  closeModals();
}

function closeModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.style.display = "none");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

init();
