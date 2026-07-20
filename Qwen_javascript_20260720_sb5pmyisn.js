// ===== Конфигурация =====
const API_BASE = "https://d5dn7smcr727ub40o5lt.kocrdvxt.apigw.yandexcloud.net";

// ===== Состояние =====
let skills = [];
let activeSkillKey = null;
let isLoading = false;

// Хранилище сообщений по каждому скиллу
// { "sales": [{role, text, step, total_steps}], "crm": [...], ... }
const chatHistories = {};

// ===== Session ID =====
function getSessionId() {
  let id = localStorage.getItem("bf_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("bf_session_id", id);
  }
  return id;
}

// ===== API =====
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: getSessionId(), ...data })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ===== DOM =====
const $skillList = document.getElementById("skillList");
const $placeholder = document.getElementById("chatPlaceholder");
const $chatContainer = document.getElementById("chatContainer");
const $chatTitle = document.getElementById("chatTitle");
const $chatDesc = document.getElementById("chatDesc");
const $messages = document.getElementById("messages");
const $input = document.getElementById("userInput");
const $btnSend = document.getElementById("btnSend");
const $btnResetSkill = document.getElementById("btnResetSkill");
const $btnResetAll = document.getElementById("btnResetAll");

// ===== Инициализация =====
async function init() {
  try {
    const data = await apiGet("/api/skills");
    skills = data.skills;
    renderSidebar();
  } catch (e) {
    console.error("Не удалось загрузить скиллы:", e);
    $skillList.innerHTML = '<p style="color:#e94560;padding:12px;">Ошибка загрузки. Обновите страницу.</p>';
  }
}

// ===== Sidebar =====
function renderSidebar() {
  $skillList.innerHTML = "";
  skills.forEach(skill => {
    const btn = document.createElement("button");
    btn.className = "skill-btn" + (skill.key === activeSkillKey ? " active" : "");
    btn.dataset.key = skill.key;

    const history = chatHistories[skill.key] || [];
    const statusText = history.length > 0 ? `💬 ${history.length} сообщ.` : "";

    btn.innerHTML = `
      <span class="skill-name">${skill.name}</span>
      <span class="skill-desc">${skill.description}</span>
      ${statusText ? `<span class="skill-status">${statusText}</span>` : ""}
    `;
    btn.addEventListener("click", () => selectSkill(skill.key));
    $skillList.appendChild(btn);
  });
}

// ===== Выбор скилла =====
async function selectSkill(key) {
  activeSkillKey = key;
  const skill = skills.find(s => s.key === key);

  // UI
  $placeholder.classList.add("hidden");
  $chatContainer.classList.remove("hidden");
  $chatTitle.textContent = skill.name;
  $chatDesc.textContent = skill.description;
  renderSidebar();

  // Если чат пустой — начинаем сессию
  if (!chatHistories[key] || chatHistories[key].length === 0) {
    chatHistories[key] = [];
    renderMessages();
    await startSkill(key);
  } else {
    renderMessages();
  }
}

// ===== Старт скилла =====
async function startSkill(key) {
  setLoading(true);
  try {
    const data = await apiPost("/api/skill/start", { skill_key: key });
    addMessage(key, "bot", data.question, data.step, data.total_steps);
    renderMessages();
  } catch (e) {
    addMessage(key, "bot", "❌ Ошибка запуска скилла. Попробуйте ещё раз.");
    renderMessages();
  }
  setLoading(false);
}

// ===== Отправка ответа =====
async function sendAnswer() {
  const text = $input.value.trim();
  if (!text || isLoading || !activeSkillKey) return;

  const key = activeSkillKey;

  // Добавляем сообщение пользователя
  addMessage(key, "user", text);
  $input.value = "";
  renderMessages();

  // Отправляем на сервер
  setLoading(true);
  addMessage(key, "bot", "⏳ Обрабатываю...", null, null, true);
  renderMessages();

  try {
    const data = await apiPost("/api/chat", { skill_key: key, text });

    // Убираем "обрабатываю"
    removeTyping(key);

    if (data.type === "question") {
      addMessage(key, "bot", data.message, data.step, data.total_steps);
    } else if (data.type === "report") {
      addMessage(key, "bot", data.report, null, null, false, true);
    } else {
      addMessage(key, "bot", data.message || "Готово.");
    }
  } catch (e) {
    removeTyping(key);
    addMessage(key, "bot", "❌ Ошибка: " + e.message);
  }

  renderMessages();
  setLoading(false);
}

// ===== Сообщения =====
function addMessage(skillKey, role, text, step, totalSteps, isTyping = false, isReport = false) {
  if (!chatHistories[skillKey]) chatHistories[skillKey] = [];
  chatHistories[skillKey].push({ role, text, step, totalSteps, isTyping, isReport });
}

function removeTyping(skillKey) {
  if (!chatHistories[skillKey]) return;
  chatHistories[skillKey] = chatHistories[skillKey].filter(m => !m.isTyping);
}

function renderMessages() {
  const key = activeSkillKey;
  const history = chatHistories[key] || [];

  $messages.innerHTML = "";
  history.forEach(msg => {
    const div = document.createElement("div");
    let cls = "bubble " + msg.role;
    if (msg.isReport) cls = "bubble report";
    if (msg.isTyping) cls += " typing";
    div.className = cls;

    let html = "";
    if (msg.role === "bot" && msg.step && msg.totalSteps) {
      html += `<span class="step-badge">Вопрос ${msg.step} / ${msg.totalSteps}</span><br>`;
    }
    html += escapeHtml(msg.text);
    div.innerHTML = html;
    $messages.appendChild(div);
  });

  // Скролл вниз
  $messages.scrollTop = $messages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===== Loading =====
function setLoading(state) {
  isLoading = state;
  $btnSend.disabled = state;
  $input.disabled = state;
}

// ===== Сброс =====
async function resetSkill(key) {
  try {
    await apiPost("/api/reset", { skill_key: key });
  } catch (e) { /* ignore */ }
  chatHistories[key] = [];
  if (activeSkillKey === key) {
    renderMessages();
    await startSkill(key);
  }
  renderSidebar();
}

async function resetAll() {
  for (const key of Object.keys(chatHistories)) {
    try {
      await apiPost("/api/reset", { skill_key: key });
    } catch (e) { /* ignore */ }
    chatHistories[key] = [];
  }
  if (activeSkillKey) {
    renderMessages();
    await startSkill(activeSkillKey);
  }
  renderSidebar();
}

// ===== Events =====
$btnSend.addEventListener("click", sendAnswer);

$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAnswer();
  }
});

$btnResetSkill.addEventListener("click", () => {
  if (activeSkillKey) resetSkill(activeSkillKey);
});

$btnResetAll.addEventListener("click", resetAll);

// ===== Start =====
init();