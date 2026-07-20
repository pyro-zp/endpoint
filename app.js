// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const API_BASE = "https://d5dn7smcr727ub40o5lt.kocrdvxt.apigw.yandexcloud.net";

// ============================================================
// СОСТОЯНИЕ
// ============================================================
let skills = [];
let activeSkillKey = null;
let isLoading = false;

// История сообщений по каждому скиллу:
// { "sales": [{role, text, step, totalSteps, isTyping, isReport}], ... }
const chatHistories = {};

// ============================================================
// SESSION ID
// ============================================================
function getSessionId() {
  let id = localStorage.getItem("bf_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("bf_session_id", id);
  }
  return id;
}

// ============================================================
// API
// ============================================================
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

// ============================================================
// DOM
// ============================================================
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

// ============================================================
// MARKDOWN → RICH TEXT
// ============================================================
function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    return DOMPurify.sanitize(marked.parse(text));
  }
  // Фолбэк, если CDN не загрузился
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
async function init() {
  try {
    const data = await apiGet("/api/skills");
    skills = data.skills;
    renderSidebar();
  } catch (e) {
    console.error("Не удалось загрузить скиллы:", e);
    $skillList.innerHTML =
      '<p style="color:#e94560;padding:12px;">Ошибка загрузки. Обновите страницу.</p>';
  }
}

// ============================================================
// SIDEBAR
// ============================================================
function renderSidebar() {
  $skillList.innerHTML = "";
  skills.forEach(skill => {
    const btn = document.createElement("button");
    btn.className = "skill-btn" + (skill.key === activeSkillKey ? " active" : "");

    const history = chatHistories[skill.key] || [];
    const count = history.filter(m => !m.isTyping).length;
    const statusText = count > 0 ? `💬 ${count} сообщ.` : "";

    btn.innerHTML = `
      <span class="skill-name">${escapeHtml(skill.name)}</span>
      <span class="skill-desc">${escapeHtml(skill.description)}</span>
      ${statusText ? `<span class="skill-status">${statusText}</span>` : ""}
    `;
    btn.addEventListener("click", () => selectSkill(skill.key));
    $skillList.appendChild(btn);
  });
}

// ============================================================
// ВЫБОР СКИЛЛА
// ============================================================
async function selectSkill(key) {
  activeSkillKey = key;
  const skill = skills.find(s => s.key === key);

  $placeholder.classList.add("hidden");
  $chatContainer.classList.remove("hidden");
  $chatTitle.textContent = skill.name;
  $chatDesc.textContent = skill.description;
  renderSidebar();

  if (!chatHistories[key] || chatHistories[key].length === 0) {
    chatHistories[key] = [];
    renderMessages();
    await startSkill(key);
  } else {
    renderMessages();
  }
}

// ============================================================
// СТАРТ СКИЛЛА: приветствие + первый вопрос
// ============================================================
async function startSkill(key) {
  setLoading(true);
  try {
    const data = await apiPost("/api/skill/start", { skill_key: key });

    // Приветствие специалиста
    if (data.greeting) {
      addMessage(key, "bot", data.greeting);
    }
    // Первый вопрос (поле message!)
    addMessage(key, "bot", data.message, data.step, data.total_steps);
    renderMessages();
  } catch (e) {
    addMessage(key, "bot", "❌ Ошибка запуска скилла. Попробуйте ещё раз.");
    renderMessages();
  }
  setLoading(false);
}

// ============================================================
// ОТВЕТ ПОЛЬЗОВАТЕЛЯ
// ============================================================
async function sendAnswer() {
  const text = $input.value.trim();
  if (!text || isLoading || !activeSkillKey) return;

  const key = activeSkillKey;

  addMessage(key, "user", text);
  $input.value = "";
  renderMessages();

  setLoading(true);
  addMessage(key, "bot", "", null, null, true); // индикатор "печатает"
  renderMessages();

  try {
    const data = await apiPost("/api/chat", { skill_key: key, text });
    removeTyping(key);

    if (data.type === "question") {
      addMessage(key, "bot", data.message, data.step, data.total_steps);
    } else if (data.type === "report") {
      addMessage(key, "bot", data.report, null, null, false, true);
      addMessage(key, "note",
        "Аудит завершён. Выберите следующий скилл слева или запустите этот заново кнопкой «Сбросить».");
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

// ============================================================
// СООБЩЕНИЯ
// ============================================================
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

    // Системная заметка (по центру)
    if (msg.role === "note") {
      div.className = "system-note";
      div.textContent = msg.text;
      $messages.appendChild(div);
      return;
    }

    // Индикатор "печатает"
    if (msg.isTyping) {
      div.className = "bubble bot typing";
      div.innerHTML =
        '<span class="typing-dots"><span></span><span></span><span></span></span>';
      $messages.appendChild(div);
      return;
    }

    let cls = "bubble " + msg.role;
    if (msg.isReport) cls = "bubble bot report";
    div.className = cls;

    let html = "";
    if (msg.role === "bot" && msg.step && msg.totalSteps) {
      html += `<span class="step-badge">Вопрос ${msg.step} / ${msg.totalSteps}</span>`;
    }

    if (msg.role === "bot") {
      html += renderMarkdown(msg.text);   // бот → rich text
    } else {
      html += escapeHtml(msg.text);       // пользователь → обычный текст
    }

    div.innerHTML = html;
    $messages.appendChild(div);
  });

  $messages.scrollTop = $messages.scrollHeight;
}

// ============================================================
// LOADING
// ============================================================
function setLoading(state) {
  isLoading = state;
  $btnSend.disabled = state;
  $input.disabled = state;
}

// ============================================================
// СБРОС
// ============================================================
async function resetSkill(key) {
  try { await apiPost("/api/reset", { skill_key: key }); } catch (e) {}
  chatHistories[key] = [];
  renderSidebar();
  if (activeSkillKey === key) {
    renderMessages();
    await startSkill(key);
  }
}

async function resetAll() {
  for (const key of Object.keys(chatHistories)) {
    try { await apiPost("/api/reset", { skill_key: key }); } catch (e) {}
    chatHistories[key] = [];
  }
  renderSidebar();
  if (activeSkillKey) {
    renderMessages();
    await startSkill(activeSkillKey);
  }
}

// ============================================================
// СОБЫТИЯ
// ============================================================
$btnSend.addEventListener("click", sendAnswer);

$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAnswer();
  }
});

$btnResetSkill.addEventListener("click", () => {
  if (activeSkillKey && !isLoading) resetSkill(activeSkillKey);
});

$btnResetAll.addEventListener("click", () => {
  if (!isLoading) resetAll();
});

// ============================================================
// СТАРТ
// ============================================================
init();
