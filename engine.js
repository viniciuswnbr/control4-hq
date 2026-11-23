const db = window.supabase.createClient(HQ_CONFIG.SUPABASE_URL, HQ_CONFIG.SUPABASE_ANON_KEY);
const canvas = document.getElementById("hqCanvas");
const ctx = canvas.getContext("2d");
let agents = [], logs = [], tick = 0;

async function init() {
  await loadAgents();
  await loadLogs();
  setupRealtime();
  requestAnimationFrame(renderLoop);
}

async function loadAgents() {
  const { data, error } = await db.from("agents").select("*").order("id");
  if (!error && data) {
    agents = data.map((a, idx) => ({ ...a, curX: 150 + idx * 85, curY: 430 }));
    populateAgentSelect();
    document.getElementById("conn-status").textContent = "● Online (Realtime)";
  }
}

async function loadLogs() {
  const { data } = await db.from("execution_logs").select("*").order("created_at", { ascending: false }).limit(25);
  if (data) { logs = data; renderLogs(); }
}

function setupRealtime() {
  db.channel("hq-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, payload => {
      const idx = agents.findIndex(a => a.id === payload.new.id);
      if (idx >= 0) agents[idx] = { ...agents[idx], ...payload.new };
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_logs" }, payload => {
      logs.unshift(payload.new);
      if (logs.length > 30) logs.pop();
      renderLogs();
    })
    .subscribe();
}

function renderLogs() {
  const container = document.getElementById("logList");
  container.innerHTML = logs.map(l => {
    const time = new Date(l.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return '<div class="log-item ' + l.level + '"><div class="log-time">' + time + ' • <strong>' + (l.agent_id || "SISTEMA") + '</strong></div><div>' + l.message + '</div></div>';
  }).join("");
}

function renderLoop() {
  tick++;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  HQ_CONFIG.ROOMS.forEach(room => {
    ctx.fillStyle = room.color; ctx.strokeStyle = room.border; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(room.x, room.y, room.w, room.h, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = room.border; ctx.font = "bold 10px monospace"; ctx.fillText(room.label, room.x + 12, room.y + 18);
  });
  ctx.fillStyle = "#065f46"; ctx.strokeStyle = "#34d399"; ctx.lineWidth = 2;
  ctx.fillRect(350, 405, 100, 50); ctx.strokeRect(350, 405, 100, 50);
  ctx.beginPath(); ctx.moveTo(400, 405); ctx.lineTo(400, 455); ctx.strokeStyle = "#ffffff"; ctx.stroke();
  const ballX = 400 + Math.sin(tick * 0.12) * 38;
  ctx.fillStyle = "#fbbf24"; ctx.beginPath(); ctx.arc(ballX, 430, 3, 0, Math.PI * 2); ctx.fill();

  agents.forEach((agent, index) => {
    const desk = HQ_CONFIG.DESKS[agent.id] || { x: 100 + index * 90, y: 100 };
    ctx.fillStyle = "#334155"; ctx.fillRect(desk.x - 28, desk.y - 22, 56, 16);
    ctx.fillStyle = agent.status === "WORKING" ? "#38bdf8" : "#0f172a"; ctx.fillRect(desk.x - 10, desk.y - 20, 20, 10);
    let targetX = desk.x, targetY = desk.y + 14;
    if (agent.status === "LOUNGE") { targetX = 110 + index * 95; targetY = 435 + Math.sin(tick * 0.05 + index) * 4; }
    agent.curX += (targetX - agent.curX) * 0.08; agent.curY += (targetY - agent.curY) * 0.08;
    if (agent.status === "ERROR") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.3)"; ctx.beginPath(); ctx.arc(agent.curX, agent.curY, 26 + Math.sin(tick * 0.2) * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = agent.avatar_color || "#3b82f6"; ctx.beginPath(); ctx.arc(agent.curX, agent.curY, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#fde68a"; ctx.beginPath(); ctx.arc(agent.curX, agent.curY - 12, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)"; ctx.fillRect(agent.curX - 42, agent.curY + 15, 84, 16);
    ctx.fillStyle = "#f8fafc"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText(agent.agent_name, agent.curX, agent.curY + 26);
    if (agent.status === "WORKING") {
      ctx.fillStyle = "#10b981"; ctx.fillRect(agent.curX - 38, agent.curY - 34, 76, 14);
      ctx.fillStyle = "#022c22"; ctx.font = "bold 9px monospace"; ctx.fillText("⚡ CODANDO...", agent.curX, agent.curY - 24);
    }
    ctx.textAlign = "left";
  });
  requestAnimationFrame(renderLoop);
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const clickedAgent = agents.find(a => Math.hypot(a.curX - (e.clientX - rect.left), a.curY - (e.clientY - rect.top)) < 28);
  if (clickedAgent) openMissionModal(clickedAgent.id);
});

function populateAgentSelect() {
  document.getElementById("agentSelect").innerHTML = agents.map(a => '<option value="' + a.id + '">' + a.agent_name + ' — ' + a.project_name + '</option>').join("");
}
function openMissionModal(preselectedId = null) {
  if (preselectedId) document.getElementById("agentSelect").value = preselectedId;
  updateModalContext();
  document.getElementById("missionModal").style.display = "flex";
  document.getElementById("rawIdeaInput").focus();
}
document.getElementById("agentSelect").addEventListener("change", updateModalContext);
function updateModalContext() {
  const ag = agents.find(a => a.id === document.getElementById("agentSelect").value);
  if (ag) {
    document.getElementById("modalTitle").textContent = 'Comando para ' + ag.agent_name;
    document.getElementById("modalContext").textContent = 'Projeto: ' + ag.project_name + ' | Pasta: ' + ag.local_path;
  }
}
async function dispatchMission() {
  const agent_id = document.getElementById("agentSelect").value;
  const task_type = document.getElementById("taskTypeSelect").value;
  const raw_idea = document.getElementById("rawIdeaInput").value.trim();
  if (!raw_idea) return alert("Digite sua ideia antes de enviar.");
  const { error } = await db.from("missions").insert({ agent_id, task_type, raw_idea, status: "PENDING" });
  if (error) alert("Erro: " + error.message);
  else { document.getElementById("rawIdeaInput").value = ""; closeModals(); }
}
function openBriefing() {
  const w = agents.filter(a => a.status === "WORKING"), e = agents.filter(a => a.status === "ERROR"), i = agents.filter(a => a.status === "LOUNGE");
  document.getElementById("briefingContent").innerHTML = '<p><strong>📊 Status Geral:</strong></p><ul><li><strong>⚡ Em Produção (' + w.length + '):</strong> ' + (w.map(a => a.agent_name).join(", ") || "Nenhum") + '</li><li><strong>🚨 War Room (' + e.length + '):</strong> ' + (e.map(a => a.agent_name).join(", ") || "Zero falhas") + '</li><li><strong>🏓 Lounge (' + i.length + '):</strong> ' + i.map(a => a.agent_name).join(", ") + '</li></ul>';
  document.getElementById("briefingModal").style.display = "flex";
}
function closeModals() { document.getElementById("missionModal").style.display = "none"; document.getElementById("briefingModal").style.display = "none"; }
init();