(function () {
  "use strict";

  var STORAGE_KEY = "tiagente.os.v1";
  var APP_LIST = [
    { id: "browser", name: "Navegador" },
    { id: "studio", name: "Estúdio" },
    { id: "files", name: "Arquivos" },
    { id: "email", name: "E-mail" },
    { id: "terminal", name: "Terminal" },
    { id: "agent", name: "TIAgente" },
    { id: "launcher", name: "Aplicativos" },
    { id: "settings", name: "Configurações" },
    { id: "gallery", name: "Galeria" },
    { id: "calculator", name: "Calculadora" },
    { id: "gamestudio", name: "Game Studio" },
    { id: "jogos", name: "Jogos" },
    { id: "tigrinho", name: "Tigrinho" },
    { id: "curriculos", name: "Currículos" },
    { id: "memoria", name: "Memória" },
    { id: "pesquisa", name: "Pesquisa" },
    { id: "btc", name: "BTC Market" },
    { id: "quantfury", name: "Quantfury" }
  ];
  // Módulos da SPA principal exibidos como apps. Cada um abre a aba
  // correspondente num iframe via rota "/?tab=<id>" (reaproveita as telas existentes).
  var MODULE_APPS = {
    gamestudio: "Game Studio",
    jogos: "Jogos",
    tigrinho: "Tigrinho",
    curriculos: "Currículos",
    memoria: "Memória",
    pesquisa: "Pesquisa",
    btc: "BTC Market",
    quantfury: "Quantfury"
  };
  // Categorias da central de aplicativos (FASE 2).
  var APP_CATEGORIES = [
    { id: "inteligencia", name: "Inteligência", apps: ["agent", "memoria", "pesquisa", "curriculos"] },
    { id: "criacao", name: "Criação", apps: ["gamestudio", "jogos", "tigrinho", "studio", "gallery"] },
    { id: "desenvolvimento", name: "Desenvolvimento", apps: ["browser", "files", "terminal"] },
    { id: "gerenciamento", name: "Gerenciamento", apps: ["launcher", "settings", "calculator", "email", "btc", "quantfury"] }
  ];
  var DEFAULTS = {
    theme: "dark",
    accent: "violet",
    wallpaper: "",
    labels: {},
    order: ["launcher", "browser", "studio", "files", "email", "terminal", "agent", "settings", "gallery", "calculator", "gamestudio", "jogos", "tigrinho", "curriculos", "memoria", "pesquisa", "btc", "quantfury"],
    // Ícones exibidos na área de trabalho (conjunto enxuto; o restante fica na central de aplicativos).
    desktop: ["agent", "browser", "studio", "files", "gamestudio", "settings"],
    dock: ["launcher", "browser", "studio", "files", "email", "agent", "settings", "calculator", "gallery", "terminal"],
    taskHistory: [],
    favorites: [],
    browserHistory: [],
    agentSession: "",
    project: "default",
    projectSource: "inherit"
  };
  var settings = loadSettings();
  var windows = [];
  var nextWindowId = 1;
  var zIndex = 20;
  var noticeTimer = null;
  var agentSocket = null;
  var agentWindowId = null;
  var agentReady = false;
  var agentQueuedPrompt = null;
  var agentCurrentTask = null;
  var agentCurrentText = "";
  var agentWantsCode = false;
  var dragState = null;
  var fileFolderCache = {};
  var fileFolderCacheOrder = [];

  var root = document.getElementById("os");
  var desktop = document.getElementById("desktop");
  var desktopIcons = document.getElementById("desktop-icons");
  var windowsHost = document.getElementById("windows");
  var dock = document.getElementById("dock");
  var menuPopover = document.getElementById("menu-popover");
  var notice = document.getElementById("notice");

  function loadSettings() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) {}
    var result = {};
    var key;
    for (key in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        result[key] = saved && Object.prototype.hasOwnProperty.call(saved, key)
          ? saved[key] : DEFAULTS[key];
      }
    }
    if (!result.order || !result.order.length) result.order = DEFAULTS.order.slice(0);
    if (!result.dock) result.dock = DEFAULTS.dock.slice(0);
    if (!result.labels) result.labels = {};
    if (!result.taskHistory) result.taskHistory = [];
    if (!result.favorites) result.favorites = [];
    if (!result.browserHistory) result.browserHistory = [];
    if (result.projectSource !== "custom") {
      try {
        var existing = JSON.parse(localStorage.getItem("trae_agent_state_v1") || "{}");
        if (existing.project && typeof existing.project === "string") result.project = existing.project;
      } catch (e) {}
    }
    return result;
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true; }
    catch (e) { showNotice("Não foi possível salvar mais dados neste aparelho."); return false; }
  }

  function labelFor(id) {
    return settings.labels[id] || appById(id).name;
  }

  function appById(id) {
    var i;
    for (i = 0; i < APP_LIST.length; i++) if (APP_LIST[i].id === id) return APP_LIST[i];
    return APP_LIST[0];
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function iconSvg(id) {
    var icons = {
      browser: '<circle cx="32" cy="32" r="25" fill="#16a8ed"/><circle cx="32" cy="32" r="21" fill="none" stroke="#baf4ff" stroke-width="2"/><path d="M43 18L35 37 20 45l9-17z" fill="#fff"/><path d="M43 18L35 37l-6-9z" fill="#fa526f"/><circle cx="32" cy="32" r="2.5" fill="#fff"/>',
      studio: '<rect x="7" y="12" width="50" height="34" rx="6" fill="#2b2540"/><rect x="11" y="16" width="42" height="26" rx="3" fill="#f6f5ff"/><path d="M13 18h10" stroke="#8f86c9" stroke-width="2"/><rect x="13" y="23" width="16" height="15" rx="2" fill="#6d4be0"/><path d="M33 25h18M33 30h18M33 35h12" stroke="#b9b2e8" stroke-width="2.4"/><path d="M24 50h16l-2 6H26z" fill="#3d3660"/>',
      files: '<path d="M8 18a5 5 0 0 1 5-5h13l5 5h20a5 5 0 0 1 5 5v20a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z" fill="#10b7ee"/><path d="M8 26h48l-5 20a4 4 0 0 1-4 3H12a4 4 0 0 1-4-4z" fill="#0786db"/>',
      email: '<rect x="8" y="15" width="48" height="34" rx="5" fill="#f4fbff"/><path d="M10 18l22 17 22-17" fill="none" stroke="#168de0" stroke-width="4" stroke-linejoin="round"/><path d="M10 46l15-13m29 13L39 33" fill="none" stroke="#6dcaf2" stroke-width="2"/>',
      terminal: '<rect x="7" y="10" width="50" height="44" rx="9" fill="#1b2030"/><path d="M17 23l9 8-9 8m14 0h13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
      agent: '<circle cx="32" cy="32" r="27" fill="#311082"/><path d="M32 12v7" stroke="#f2eaff" stroke-width="3"/><circle cx="32" cy="9" r="4" fill="#fff"/><rect x="16" y="20" width="32" height="25" rx="9" fill="#f8f6ff"/><rect x="20" y="25" width="24" height="14" rx="6" fill="#101b51"/><circle cx="27" cy="32" r="2.5" fill="#38ddff"/><circle cx="37" cy="32" r="2.5" fill="#38ddff"/><path d="M23 49h18" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
      settings: '<path d="M28 8h8l2 6 5 2 5-3 6 6-3 5 2 5 6 2v8l-6 2-2 5 3 5-6 6-5-3-5 2-2 6h-8l-2-6-5-2-5 3-6-6 3-5-2-5-6-2v-8l6-2 2-5-3-5 6-6 5 3 5-2z" fill="#9098ac" transform="translate(-1,-3) scale(.98)"/><circle cx="32" cy="32" r="10" fill="#34394c"/><circle cx="32" cy="32" r="5" fill="#dfe6f8"/>',
      gallery: '<rect x="9" y="12" width="46" height="40" rx="6" fill="#7650df"/><circle cx="22" cy="24" r="4" fill="#ffe27a"/><path d="M12 46l13-14 9 9 8-11 11 16z" fill="#72dfdc"/>',
      calculator: '<rect x="11" y="8" width="42" height="48" rx="8" fill="#444a61"/><rect x="17" y="14" width="30" height="12" rx="3" fill="#d8fbef"/><g fill="#fff"><circle cx="21" cy="34" r="3"/><circle cx="32" cy="34" r="3"/><circle cx="43" cy="34" r="3"/><circle cx="21" cy="45" r="3"/><circle cx="32" cy="45" r="3"/></g><circle cx="43" cy="45" r="4" fill="#f1a341"/>',
      gamestudio: '<rect width="64" height="64" rx="14" fill="#6d28d9"/><rect x="8" y="24" width="48" height="19" rx="9.5" fill="#fff"/><circle cx="16.5" cy="42.5" r="9" fill="#fff"/><circle cx="47.5" cy="42.5" r="9" fill="#fff"/><rect x="20.4" y="28.5" width="4.2" height="12.2" rx="1.4" fill="#5b21b6"/><rect x="16.4" y="32.5" width="12.2" height="4.2" rx="1.4" fill="#5b21b6"/><circle cx="41" cy="31.5" r="2.7" fill="#f97316"/><circle cx="45.8" cy="35.6" r="2.7" fill="#7c3aed"/>',
      jogos: '<rect width="64" height="64" rx="14" fill="#0f9d6b"/><g fill="#eafff6"><rect x="16" y="34" width="6" height="13" rx="2"/><rect x="26" y="26" width="6" height="21" rx="2"/><rect x="36" y="30" width="6" height="17" rx="2"/><rect x="46" y="20" width="6" height="27" rx="2"/></g>',
      tigrinho: '<circle cx="32" cy="32" r="25" fill="#f5b301"/><circle cx="32" cy="32" r="20" fill="#ffd765"/><path d="M32 17l4.3 9.3 10.2 1.1-7.6 7 1.9 10.1L32 49.6l-8.8 4.9 1.9-10.1-7.6-7 10.2-1.1z" fill="#ef8f00"/>',
      curriculos: '<rect width="64" height="64" rx="14" fill="#2f7de1"/><rect x="15" y="12" width="30" height="40" rx="5" fill="#fff"/><rect x="21" y="19" width="18" height="3.4" rx="1.7" fill="#9dc1f2"/><rect x="21" y="27" width="18" height="3.4" rx="1.7" fill="#9dc1f2"/><rect x="21" y="35" width="12" height="3.4" rx="1.7" fill="#9dc1f2"/><circle cx="44" cy="44" r="11" fill="#1e40af"/><circle cx="44" cy="41" r="3.4" fill="#dbeafe"/><path d="M37 51c1.4-3.4 5.6-5 7-5s5.6 1.6 7 5z" fill="#dbeafe"/>',
      memoria: '<rect width="64" height="64" rx="14" fill="#7c3aed"/><rect x="18" y="18" width="28" height="28" rx="7" fill="#e9d5ff"/><rect x="25" y="25" width="14" height="14" rx="3" fill="#7c3aed"/><g stroke="#e9d5ff" stroke-width="3" stroke-linecap="round"><path d="M32 8v6M32 50v6M8 32h6M50 32h6M15 15l4 4M49 49l-4-4M49 15l-4 4M15 49l4-4"/></g>',
      pesquisa: '<rect width="64" height="64" rx="14" fill="#0ea5e9"/><circle cx="27" cy="27" r="14" fill="#e0f2fe"/><circle cx="27" cy="27" r="14" fill="none" stroke="#0369a1" stroke-width="3"/><rect x="37" y="37" width="9" height="19" rx="4.5" fill="#0369a1" transform="rotate(-45 41.5 46.5)"/>',
      btc: '<circle cx="32" cy="32" r="25" fill="#f7931a"/><g fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"><path d="M27 16h7a7 7 0 0 1 0 14h-7zM27 30h9a7 7 0 0 1 0 14h-9z"/><path d="M23 16h4M23 44h4M30 12v6M30 42v6"/></g>',
      quantfury: '<rect width="64" height="64" rx="14" fill="#0b1220"/><path d="M14 44l11-13 10 6 15-19" fill="none" stroke="#22d3ee" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="18" r="4.5" fill="#34d399"/>',
      launcher: '<rect width="64" height="64" rx="14" fill="#4c1d95"/><g fill="#fff"><rect x="13" y="13" width="16" height="16" rx="5"/><rect x="35" y="13" width="16" height="16" rx="5"/><rect x="13" y="35" width="16" height="16" rx="5"/><rect x="35" y="35" width="16" height="16" rx="5"/></g><circle cx="42" cy="42" r="4" fill="#f97316"/>'
    };
    return '<svg viewBox="0 0 64 64" aria-hidden="true">' + (icons[id] || icons.agent) + "</svg>";
  }

  function iconMarkup(id, small) {
    var cls = small ? "app-icon" : "app-icon";
    if (id === "agent") {
      return '<span class="' + cls + '"><img src="icon.svg" alt=""></span>';
    }
    return '<span class="' + cls + '">' + iconSvg(id) + "</span>";
  }

  function getOrderedApps() {
    var result = [];
    var used = {};
    var i, id;
    for (i = 0; i < settings.order.length; i++) {
      id = settings.order[i];
      if (!used[id] && appExists(id)) { result.push(id); used[id] = true; }
    }
    for (i = 0; i < APP_LIST.length; i++) {
      id = APP_LIST[i].id;
      if (!used[id]) result.push(id);
    }
    return result;
  }

  function appExists(id) {
    var i;
    for (i = 0; i < APP_LIST.length; i++) if (APP_LIST[i].id === id) return true;
    return false;
  }

  function desktopApps() {
    var list = settings.desktop && settings.desktop.length ? settings.desktop : DEFAULTS.desktop;
    var result = [];
    var i, id;
    for (i = 0; i < list.length; i++) {
      id = list[i];
      if (appExists(id) && result.indexOf(id) < 0) result.push(id);
    }
    return result;
  }

  function renderDesktopIcons() {
    var ids = desktopApps();
    var html = "";
    var i, id;
    for (i = 0; i < ids.length; i++) {
      id = ids[i];
      html += '<button type="button" class="desktop-icon" data-app="' + id + '" aria-label="Abrir ' + escapeHtml(labelFor(id)) + '">'
        + iconMarkup(id, false) + '<span class="desktop-icon-label">' + escapeHtml(labelFor(id)) + "</span></button>";
    }
    desktopIcons.innerHTML = html;
    renderDock();
  }

  function dockItemHtml(id) {
    return '<button type="button" class="dock-item' + (findWindow(id) ? " opened" : "") + '" data-app="' + id + '" title="' + escapeHtml(labelFor(id)) + '" aria-label="Abrir ' + escapeHtml(labelFor(id)) + '">'
      + iconMarkup(id, true) + "</button>";
  }

  function renderDock() {
    var html = "";
    var favorites = settings.dock || [];
    var running = [];
    var i, id;
    for (i = 0; i < favorites.length; i++) {
      id = favorites[i];
      if (appExists(id)) html += dockItemHtml(id);
    }
    // Aplicativos abertos que não estão nos favoritos.
    for (i = 0; i < windows.length; i++) {
      id = windows[i].appId;
      if (favorites.indexOf(id) < 0 && running.indexOf(id) < 0 && appExists(id)) running.push(id);
    }
    if (running.length) {
      if (favorites.length) html += '<span class="dock-separator" aria-hidden="true"></span>';
      for (i = 0; i < running.length; i++) html += dockItemHtml(running[i]);
    }
    dock.innerHTML = html;
  }

  function showNotice(text) {
    notice.textContent = String(text || "");
    notice.className = "notice visible";
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { notice.className = "notice"; }, 3000);
  }

  function setStatusLine(win, text) {
    if (!win || !win.status) return;
    win.status.textContent = text;
  }

  function findWindow(appId) {
    var i;
    for (i = 0; i < windows.length; i++) if (windows[i].appId === appId) return windows[i];
    return null;
  }

  function focusWindow(win) {
    var i;
    if (!win) return;
    if (win.minimized) {
      win.minimized = false;
      win.el.style.display = "flex";
    }
    zIndex++;
    win.el.style.zIndex = zIndex;
    for (i = 0; i < windows.length; i++) windows[i].el.className = windows[i].el.className.replace(" active", "");
    if (win.el.className.indexOf(" active") < 0) win.el.className += " active";
    renderDock();
  }

  function openApp(appId) {
    var existing = findWindow(appId);
    if (existing) { focusWindow(existing); return existing; }
    var app = appById(appId);
    var id = "os-window-" + nextWindowId++;
    var win = { id: id, appId: appId, app: app, minimized: false, maximized: false, el: null, content: null, status: null };
    var pos = Math.max(0, windows.length);
    var html = '<section id="' + id + '" class="app-window" role="dialog" aria-label="' + escapeHtml(labelFor(appId)) + '">'
      + '<header class="window-titlebar" data-drag-window="' + id + '">'
      + '<div class="window-controls">'
      + '<button type="button" class="window-control close" data-window-action="close" data-window="' + id + '" aria-label="Fechar"></button>'
      + '<button type="button" class="window-control minimize" data-window-action="minimize" data-window="' + id + '" aria-label="Minimizar"></button>'
      + '<button type="button" class="window-control maximize" data-window-action="maximize" data-window="' + id + '" aria-label="Maximizar ou restaurar"></button>'
      + '</div><span class="window-app-mark">' + (appId === "agent" ? '<img src="icon.svg" alt="">' : iconSvg(appId)) + '</span>'
      + '<span class="window-title">' + escapeHtml(labelFor(appId)) + '</span></header>'
      + '<div class="window-content" id="' + id + '-content"></div>'
      + '<footer class="window-statusbar"><span class="window-status-indicator" id="' + id + '-status">Pronto</span><span>TIAgente OS</span></footer>'
      + '<span class="resize-handle" data-resize-window="' + id + '" aria-label="Redimensionar janela"></span></section>';
    windowsHost.insertAdjacentHTML("beforeend", html);
    win.el = document.getElementById(id);
    win.content = document.getElementById(id + "-content");
    win.status = document.getElementById(id + "-status");
    windows.push(win);
    positionWindow(win, pos);
    focusWindow(win);
    renderApp(win);
    return win;
  }

  function closeWindow(id) {
    var i, win;
    for (i = 0; i < windows.length; i++) {
      if (windows[i].id === id) {
        win = windows[i];
        if (win.appId === "agent") disconnectAgent();
        if (win.el && win.el.parentNode) win.el.parentNode.removeChild(win.el);
        windows.splice(i, 1);
        renderDock();
        return;
      }
    }
  }

  function minimizeWindow(id) {
    var win = windowById(id);
    if (!win) return;
    win.minimized = true;
    win.el.style.display = "none";
    renderDock();
  }

  function windowById(id) {
    var i;
    for (i = 0; i < windows.length; i++) if (windows[i].id === id) return windows[i];
    return null;
  }

  function positionWindow(win, index) {
    if (!win || !win.el || win.maximized) return;
    var width = window.innerWidth || document.documentElement.clientWidth;
    var height = window.innerHeight || document.documentElement.clientHeight;
    var portrait = height > width;
    if (width <= 760) {
      win.el.style.left = "5px";
      win.el.style.top = "111px";
      win.el.style.width = "calc(100% - 10px)";
      win.el.style.height = "calc(100% - 120px)";
    } else if (portrait) {
      win.el.style.left = "4%";
      win.el.style.top = "112px";
      win.el.style.width = "92%";
      win.el.style.height = "calc(100% - 125px)";
    } else {
      win.el.style.left = Math.max(5, 15 + (index % 5) * 3) + "%";
      win.el.style.top = Math.max(5, 7 + (index % 5) * 3) + "%";
      win.el.style.width = "78%";
      win.el.style.height = "78%";
    }
  }

  function renderApp(win) {
    if (win.appId === "agent") renderAgent(win);
    else if (win.appId === "browser") renderBrowser(win);
    else if (win.appId === "studio") renderStudio(win);
    else if (win.appId === "email") renderEmail(win);
    else if (win.appId === "files") renderFiles(win);
    else if (win.appId === "terminal") renderTerminal(win);
    else if (win.appId === "gallery") renderGallery(win);
    else if (win.appId === "calculator") renderCalculator(win);
    else if (win.appId === "settings") renderSettings(win);
    else if (win.appId === "launcher") renderLauncher(win);
    else if (Object.prototype.hasOwnProperty.call(MODULE_APPS, win.appId)) renderModuleApp(win, win.appId);
  }

  function renderAgent(win) {
    var historyHtml = "";
    var i, item;
    for (i = settings.taskHistory.length - 1; i >= 0 && i >= settings.taskHistory.length - 5; i--) {
      item = settings.taskHistory[i];
      historyHtml += '<button type="button" class="history-item" data-history="' + i + '">' + escapeHtml(shortText(item.prompt, 68)) + "</button>";
    }
    win.content.innerHTML = '<div class="agent-app">'
      + '<div class="agent-hero"><span class="agent-avatar"><img src="icon.svg" alt=""></span>'
      + '<div class="agent-heading"><h1>TIAgente</h1><p>Seu assistente inteligente, sempre ao seu lado!</p>'
      + '<span class="agent-state" id="agent-state-' + win.id + '">Pronto para conectar</span></div></div>'
      + '<div class="agent-grid"><div class="agent-main">'
      + '<form class="task-composer" data-agent-form="' + win.id + '">'
      + '<textarea name="prompt" aria-label="Sua solicitação" placeholder="Digite o que você deseja fazer..." maxlength="4000"></textarea>'
      + '<button class="send-task" type="submit" aria-label="Enviar solicitação">&#10148;</button></form>'
      + '<h2 class="agent-section-title">Exemplos do que você pode pedir:</h2>'
      + '<div class="agent-shortcuts">'
      + '<button class="agent-shortcut" type="button" data-prompt="Pesquise na internet sobre">⌕ &nbsp; Pesquisar na internet</button>'
      + '<button class="agent-shortcut" type="button" data-prompt="Mostre o código do projeto atual">⌘ &nbsp; Mostrar código</button>'
      + '<button class="agent-shortcut" type="button" data-prompt="Organize os arquivos do projeto atual">▰ &nbsp; Organizar arquivos</button>'
      + '<button class="agent-shortcut" type="button" data-prompt="Explique o que posso fazer neste projeto">◫ &nbsp; Explorar projeto</button>'
      + '<button class="agent-shortcut" type="button" data-prompt="Crie uma página web simples para">◎ &nbsp; Criar uma página</button>'
      + '<button class="agent-shortcut" type="button" data-app="settings">⚙ &nbsp; Configurar o sistema</button>'
      + '</div><div class="agent-output" id="agent-output-' + win.id + '" aria-live="polite"></div>'
      + '<div class="agent-history"><h2>Tarefas recentes</h2><div id="agent-history-' + win.id + '">'
      + (historyHtml || '<p class="muted">Suas tarefas concluídas aparecerão aqui.</p>') + '</div></div></div>'
      + '<aside class="agent-side"><div class="agent-card"><h2>✓ &nbsp; Recursos</h2>'
      + '<div class="resource-line"><span class="resource-icon">◎</span>Navegação na web</div>'
      + '<div class="resource-line"><span class="resource-icon">▰</span>Arquivos e projetos</div>'
      + '<div class="resource-line"><span class="resource-icon">⌘</span>Ferramentas autorizadas</div>'
      + '<div class="resource-line"><span class="resource-icon">⚙</span>Execução de tarefas</div>'
      + '<div class="resource-line"><span class="resource-icon">✦</span>Integração com IA</div>'
      + '<p>O agente usa a sessão e os serviços existentes. Código e detalhes técnicos só aparecem quando solicitados.</p>'
      + '</div></aside></div></div>';
  }

  function shortText(text, max) {
    var value = String(text || "").replace(/\s+/g, " ");
    return value.length > max ? value.slice(0, max - 1) + "…" : value;
  }

  function renderBrowser(win) {
    win.content.innerHTML = '<div class="toolbar">'
      + '<button type="button" data-browser-action="back" aria-label="Voltar">&#8592;</button>'
      + '<button type="button" data-browser-action="forward" aria-label="Avançar">&#8594;</button>'
      + '<button type="button" data-browser-action="home" aria-label="Página inicial">⌂</button>'
      + '<input type="text" id="' + win.id + '-address" placeholder="Digite um endereço ou pesquise" aria-label="Endereço ou pesquisa">'
      + '<button type="button" data-browser-action="go">Ir</button>'
      + '</div><div class="browser-actions"><button type="button" data-browser-action="favorite">☆ Favorito</button>'
      + '<span class="browser-recent-label">Favoritos:</span><span id="' + win.id + '-favorites"></span>'
      + '<span class="browser-recent-label">Histórico:</span><span id="' + win.id + '-history"></span></div>'
      + '<div class="browser-frame-wrap"><iframe class="browser-frame" id="' + win.id + '-frame" title="Página web" sandbox="allow-forms allow-scripts" src="about:blank"></iframe>'
      + '<div class="browser-empty" id="' + win.id + '-browser-note">Digite um endereço ou pesquise. As páginas serão abertas neste painel; alguns sites podem bloquear a incorporação.</div></div>';
    win.browserHistory = settings.browserHistory.slice(0);
    win.browserCursor = win.browserHistory.length - 1;
    refreshBrowserFavorites(win);
    refreshBrowserHistory(win);
  }

  function renderStudio(win) {
    var slug = settings.project || "default";
    win.content.innerHTML = '<div class="studio-app">'
      + '<div class="studio-head"><h2>Estúdio de visualização</h2>'
      + '<p>O Tiagente abre aqui os sistemas que criar, sem você escolher um aplicativo.</p></div>'
      + '<div class="studio-toolbar">'
      + '<input class="text-field" id="' + win.id + '-studio-project" type="text" value="' + escapeHtml(slug) + '" aria-label="Nome do projeto">'
      + '<button class="action-button" type="button" data-studio-action="load">Abrir prévia</button>'
      + '<button class="action-button" type="button" data-studio-action="reload">Atualizar</button>'
      + '<button class="action-button" type="button" data-studio-action="fullscreen">Tela cheia</button>'
      + '<button class="action-button" type="button" data-studio-action="reopen">Reabrir projeto</button>'
      + '<button class="action-button primary" type="button" data-studio-action="publish">Publicar</button></div>'
      + '<div class="studio-meta"><span class="studio-badge" id="' + win.id + '-studio-kind"></span>'
      + '<span class="studio-path" id="' + win.id + '-studio-path"></span></div>'
      + '<div class="studio-url" id="' + win.id + '-studio-url"></div>'
      + '<input class="text-field studio-publish-field hidden" id="' + win.id + '-studio-publish" type="text" readonly aria-label="Link público">'
      + '<div class="studio-status" id="' + win.id + '-studio-status" role="status"></div>'
      + '<div class="studio-frame-wrap"><iframe class="browser-frame" id="' + win.id + '-studio-frame" title="Prévia do projeto" sandbox="allow-forms allow-scripts" src="about:blank"></iframe>'
      + '<div class="browser-empty" id="' + win.id + '-studio-note">A prévia aparece aqui. Toque em “Abrir prévia”.</div></div></div>';
    setStatusLine(win, "Estúdio pronto");
  }

  // Apps de módulo: reaproveitam a tela da SPA num iframe via rota "/?tab=<id>".
  function renderModuleApp(win, appId) {
    var label = MODULE_APPS[appId] || labelFor(appId);
    var url = "/?tab=" + encodeURIComponent(appId);
    win.content.innerHTML = '<div class="toolbar">'
      + '<span class="browser-recent-label">' + escapeHtml(label) + '</span>'
      + '<button type="button" style="margin-left:auto" data-module-action="reload" data-window="' + win.id + '">Atualizar</button>'
      + '</div><div class="browser-frame-wrap"><iframe class="browser-frame" id="' + win.id + '-module-frame" title="' + escapeHtml(label) + '" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" src="' + url + '"></iframe>'
      + '<div class="browser-empty" id="' + win.id + '-module-note">Carregando ' + escapeHtml(label) + '…</div></div>';
    var frame = document.getElementById(win.id + "-module-frame");
    var note = document.getElementById(win.id + "-module-note");
    if (frame && note) frame.onload = function () { note.style.display = "none"; };
    setStatusLine(win, label + " pronto");
  }

  function handleModuleAction(button) {
    var win = windowById(button.getAttribute("data-window"));
    if (!win) return;
    var action = button.getAttribute("data-module-action");
    if (action !== "reload") return;
    var frame = document.getElementById(win.id + "-module-frame");
    var note = document.getElementById(win.id + "-module-note");
    if (note) { note.textContent = "Atualizando…"; note.style.display = ""; }
    if (frame) frame.src = "/?tab=" + encodeURIComponent(win.appId) + "&t=" + new Date().getTime();
    setStatusLine(win, "Atualizando…");
  }

  function studioPreviewUrl(slug) {
    return "/preview/" + encodeURIComponent(slug) + "/";
  }

  function studioEl(win, suffix) {
    return document.getElementById(win.id + suffix);
  }

  function studioSetNote(win, text) {
    var note = studioEl(win, "-studio-note");
    if (!note) return;
    note.textContent = text || "";
    note.style.display = text ? "" : "none";
  }

  function studioSetStatus(win, text, isError) {
    var status = studioEl(win, "-studio-status");
    if (!status) return;
    status.textContent = text || "";
    status.className = "studio-status" + (isError ? " error" : "");
  }

  function studioShowError(win, message) {
    var frame = studioEl(win, "-studio-frame");
    if (frame) frame.src = "about:blank";
    studioSetNote(win, (message || "Não foi possível carregar a prévia.") + " Toque em “Reabrir projeto” para tentar de novo.");
    studioSetStatus(win, message || "Erro ao carregar a prévia.", true);
    setStatusLine(win, "Erro na prévia");
  }

  function studioLoadFrame(win, url, okMessage) {
    var frame = studioEl(win, "-studio-frame");
    if (frame) frame.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + new Date().getTime();
    studioSetNote(win, "");
    studioSetStatus(win, okMessage || "", false);
    setStatusLine(win, "Prévia carregada");
  }

  function loadStudioPreview(win, slug) {
    var value = String(slug == null ? "" : slug).replace(/^\s+|\s+$/g, "");
    if (!value) { showNotice("Informe o nome do projeto."); return; }
    settings.project = value;
    saveSettings();
    var urlLabel = studioEl(win, "-studio-url");
    var kindLabel = studioEl(win, "-studio-kind");
    var pathLabel = studioEl(win, "-studio-path");
    if (urlLabel) urlLabel.textContent = location.origin + studioPreviewUrl(value);
    if (kindLabel) kindLabel.textContent = "";
    if (pathLabel) pathLabel.textContent = "";
    studioSetStatus(win, "Consultando o projeto…", false);
    studioSetNote(win, "Carregando a prévia de “" + value + "”…");
    setStatusLine(win, "Carregando prévia…");
    getJSON("/api/projects/" + encodeURIComponent(value) + "/preview/info", function (err, info) {
      if (err || !info || info.ok === false) {
        studioShowError(win, (info && info.error) || (err && err.message) || "Não foi possível consultar o projeto.");
        return;
      }
      if (pathLabel) pathLabel.textContent = info.path ? ("Arquivos: " + info.path) : "";
      if (info.kind === "node") {
        if (kindLabel) kindLabel.textContent = "Projeto com dependências" + (info.devCommand ? " (" + info.devCommand + ")" : "");
        previewStudioNodeProject(win, value, info);
        return;
      }
      if (info.kind === "empty") {
        if (kindLabel) kindLabel.textContent = "Sem página inicial";
        studioShowError(win, "O projeto “" + value + "” ainda não tem uma página inicial (index.html).");
        return;
      }
      if (kindLabel) kindLabel.textContent = info.entry ? ("Entrada: " + info.entry) : "Projeto HTML";
      studioLoadFrame(win, studioPreviewUrl(value), info.entry ? ("Página de entrada: " + info.entry) : "Prévia carregada.");
    });
  }

  function previewStudioNodeProject(win, slug, info) {
    if (!info.devCommand) {
      studioShowError(win, "Projeto com dependências, mas sem servidor de desenvolvimento reconhecido. Use vite, next ou react-scripts com as dependências instaladas.");
      return;
    }
    studioSetStatus(win, "Iniciando servidor de desenvolvimento…", false);
    studioSetNote(win, "Projeto com dependências. Iniciando o servidor de desenvolvimento…");
    setStatusLine(win, "Iniciando servidor…");
    request("POST", "/api/projects/" + encodeURIComponent(slug) + "/dev/start", {}, function (err, dev) {
      if (err || !dev || dev.ok === false || !dev.url) {
        studioShowError(win, (dev && dev.error) || (err && err.message) || "Não foi possível iniciar o servidor de desenvolvimento.");
        return;
      }
      studioLoadFrame(win, dev.url, "Servidor de desenvolvimento ativo.");
    }, 30000);
  }

  function copyText(text, callback) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { if (callback) callback(true); }, function () { if (callback) callback(false); });
      return;
    }
    var ok = false;
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "absolute";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand("copy");
      document.body.removeChild(area);
    } catch (e) { ok = false; }
    if (callback) callback(ok);
  }

  function publishStudio(win) {
    var input = document.getElementById(win.id + "-studio-project");
    var slug = input ? input.value.replace(/^\s+|\s+$/g, "") : "";
    if (!slug) slug = settings.project || "default";
    if (!slug) { showNotice("Informe o nome do projeto antes de publicar."); return; }
    var url = location.origin + studioPreviewUrl(slug);
    var localOnly = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    var field = document.getElementById(win.id + "-studio-publish");
    if (field) { field.value = url; field.className = "text-field studio-publish-field"; }
    copyText(url, function (copied) {
      if (copied) showNotice("Link copiado. Envie para quem quiser divulgar.");
      else showNotice("Link pronto. Toque e segure no campo para copiar.");
    });
    if (navigator.share) {
      try {
        navigator.share({ title: "Projeto " + slug, text: "Confira o site:", url: url }).catch(function () {});
      } catch (e) {}
    }
    setStatusLine(win, localOnly ? "Link local (só neste aparelho)" : "Link público pronto");
    if (localOnly) showNotice("Atenção: este link é local e só funciona neste aparelho.");
  }

  function openStudioForProject(slug) {
    var win = openApp("studio");
    var value = chromeSafeSlug(slug);
    var input = document.getElementById(win.id + "-studio-project");
    if (input) input.value = value;
    loadStudioPreview(win, value);
    return win;
  }

  function chromeSafeSlug(slug) {
    var value = String(slug == null ? "" : slug).replace(/^\s+|\s+$/g, "");
    return value || settings.project || "default";
  }

  function maybeOpenStudioAfterTask(prompt) {
    if (!/cri(e|ar|ando)|site|p[aá]gina|landing|html|portf[oó]lio|projeto/i.test(String(prompt || ""))) return;
    openStudioForProject(settings.project);
  }

  function renderEmail(win) {
    win.content.innerHTML = '<div class="app-panel"><h2>E-mail</h2>'
      + '<p>Abra seu serviço de e-mail no navegador integrado. O TIAgente OS não solicita nem armazena sua senha.</p>'
      + '<button class="email-service" type="button" data-email-url="https://mail.google.com/"><strong>Gmail</strong><span>Conta Google</span></button>'
      + '<button class="email-service" type="button" data-email-url="https://outlook.live.com/mail/"><strong>Outlook</strong><span>Conta Microsoft</span></button>'
      + '<button class="email-service" type="button" data-email-url="https://www.icloud.com/mail/"><strong>iCloud Mail</strong><span>Conta Apple</span></button>'
      + '<p>Alguns serviços podem bloquear a abertura integrada ou exigir um navegador mais recente.</p>'
      + '</div>';
  }

  function renderFiles(win) {
    win.content.innerHTML = '<div class="app-panel"><h2>Arquivos</h2>'
      + '<div class="file-toolbar"><input class="text-field" id="' + win.id + '-project" type="text" value="' + escapeHtml(settings.project || "default") + '" aria-label="Projeto">'
      + '<button class="action-button" type="button" data-files-action="load" data-window="' + win.id + '">Carregar / atualizar</button>'
      + '<button class="action-button" type="button" data-files-action="up" data-window="' + win.id + '">Pasta acima</button></div>'
      + '<div id="' + win.id + '-file-path" class="muted">O conteúdo só é consultado quando você tocar em “Carregar projeto”.</div>'
      + '<div id="' + win.id + '-file-list"></div><pre id="' + win.id + '-file-viewer" class="file-viewer hidden"></pre>'
      + '<a id="' + win.id + '-file-download" class="action-button hidden" href="#" download>Baixar arquivo</a>'
      + '<div class="settings-group"><strong>Anexo</strong><p>Envie um arquivo para o espaço de anexos já usado pelo TiAgente.</p>'
      + '<input type="file" id="' + win.id + '-upload"><button class="action-button" type="button" data-files-action="upload" data-window="' + win.id + '">Enviar anexo</button>'
      + '<div id="' + win.id + '-upload-result"></div></div></div>';
  }

  function renderTerminal(win) {
    win.content.innerHTML = '<div class="app-panel"><h2>Terminal autorizado</h2>'
      + '<p>Este painel não aceita comandos livres. Ele envia somente tarefas permitidas pelo Gateway e pelo worker remoto existente.</p>'
      + '<div class="settings-group"><div id="' + win.id + '-remote-status">Consultando o Gateway quando o Terminal é aberto…</div>'
      + '<button class="action-button" type="button" data-terminal-action="refresh-agents" data-window="' + win.id + '">Atualizar conexão</button></div>'
      + '<div class="terminal-controls"><select id="' + win.id + '-job-type" class="select-field" aria-label="Ferramenta">'
      + '<option value="health_check">Verificar worker</option><option value="run_tests">Executar testes</option>'
      + '<option value="build_project">Construir projeto</option><option value="run_linter">Verificar código</option></select>'
      + '<input id="' + win.id + '-workspace" class="text-field" type="text" value="tester" aria-label="Workspace autorizado">'
      + '<button class="action-button" type="button" data-terminal-action="run" data-window="' + win.id + '">Executar</button></div>'
      + '<div id="' + win.id + '-terminal-output" class="terminal-output">Nenhuma tarefa remota foi solicitada.</div>'
      + '<button class="action-button hidden" id="' + win.id + '-job-refresh" type="button" data-terminal-action="refresh-job" data-window="' + win.id + '">Atualizar tarefa</button>'
      + '<p>O progresso é consultado apenas quando você solicita atualização. Não há polling contínuo.</p></div>';
    getJSON("/api/remote/status", function (err, data) {
      if (windowById(win.id) !== win) return;
      var target = document.getElementById(win.id + "-remote-status");
      if (!target) return;
      if (err || !data || !data.ok) target.textContent = "Gateway remoto indisponível.";
      else {
        var count = 0;
        var i;
        for (i = 0; i < (data.agents || []).length; i++) {
      if (/^(ONLINE|IDLE)$/i.test(data.agents[i].status || "")) count++;
        }
        target.textContent = count ? count + " worker(s) conectado(s)." : "Nenhum worker conectado no momento.";
      }
    });
  }

  function renderGallery(win) {
    win.content.innerHTML = '<div class="app-panel"><h2>Galeria</h2>'
      + '<p>Selecione imagens que o Safari/iOS disponibilizar ao aplicativo. O TIAgente OS não lê a Fototeca sem sua escolha.</p>'
      + '<input class="gallery-picker" type="file" accept="image/*" multiple id="' + win.id + '-gallery-input">'
      + '<div class="gallery-grid" id="' + win.id + '-gallery-grid"></div></div>';
  }

  function renderCalculator(win) {
    var keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "-", "0", ".", "C", "+", "(", ")", "%", "="];
    var html = "";
    var i;
    for (i = 0; i < keys.length; i++) {
      html += '<button type="button" data-calc="' + escapeHtml(keys[i]) + '"' + ("/÷×-+%=C".indexOf(keys[i]) >= 0 ? ' class="operator"' : "") + '>' + escapeHtml(keys[i]) + "</button>";
    }
    win.content.innerHTML = '<div class="app-panel"><h2>Calculadora</h2><div class="calculator">'
      + '<input id="' + win.id + '-calc-display" class="calculator-display" type="text" value="0" readonly aria-label="Visor">'
      + '<div class="calculator-keys">' + html + "</div></div></div>";
  }

  // Central de aplicativos: agrupa tudo por categoria e permite pesquisar.
  function launcherCategories() {
    var used = {};
    var others = [];
    var list = [];
    var i, j, cat;
    for (i = 0; i < APP_CATEGORIES.length; i++) {
      cat = APP_CATEGORIES[i];
      for (j = 0; j < cat.apps.length; j++) used[cat.apps[j]] = true;
      list.push(cat);
    }
    for (i = 0; i < APP_LIST.length; i++) {
      if (!used[APP_LIST[i].id]) others.push(APP_LIST[i].id);
    }
    if (others.length) list.push({ id: "outros", name: "Outros", apps: others });
    return list;
  }

  function renderLauncher(win) {
    win.content.innerHTML = '<div class="app-panel launcher">'
      + '<h2>Aplicativos</h2>'
      + '<div class="launcher-search"><input class="text-field" id="' + win.id + '-launcher-search" type="text" placeholder="Pesquisar aplicativos" aria-label="Pesquisar aplicativos" autocomplete="off"></div>'
      + '<div class="launcher-groups" id="' + win.id + '-launcher-groups"></div>'
      + '<p class="muted" id="' + win.id + '-launcher-empty" hidden>Nenhum aplicativo encontrado.</p></div>';
    renderLauncherGroups(win, "");
    setStatusLine(win, "Aplicativos prontos");
  }

  function renderLauncherGroups(win, query) {
    var host = document.getElementById(win.id + "-launcher-groups");
    if (!host) return;
    var q = String(query == null ? "" : query).replace(/^\s+|\s+$/g, "").toLowerCase();
    var categories = launcherCategories();
    var html = "";
    var total = 0;
    var i, j, cat, apps, id, name;
    for (i = 0; i < categories.length; i++) {
      cat = categories[i];
      apps = "";
      for (j = 0; j < cat.apps.length; j++) {
        id = cat.apps[j];
        if (!appExists(id)) continue;
        name = labelFor(id);
        if (q && name.toLowerCase().indexOf(q) < 0 && id.toLowerCase().indexOf(q) < 0) continue;
        apps += '<button type="button" class="launcher-item" data-app="' + id + '" aria-label="Abrir ' + escapeHtml(name) + '">'
          + iconMarkup(id, false) + '<span class="launcher-item-label">' + escapeHtml(name) + "</span></button>";
        total++;
      }
      if (apps) {
        html += '<section class="launcher-group"><h3>' + escapeHtml(cat.name) + '</h3><div class="launcher-grid">' + apps + "</div></section>";
      }
    }
    host.innerHTML = html;
    var empty = document.getElementById(win.id + "-launcher-empty");
    if (empty) empty.hidden = total > 0;
    setStatusLine(win, total + (total === 1 ? " aplicativo" : " aplicativos"));
  }

  function openLauncherSearch() {
    var win = openApp("launcher");
    var field = document.getElementById(win.id + "-launcher-search");
    if (field) {
      try { field.focus(); field.select(); } catch (e) {}
    }
    return win;
  }

  function handleLauncherInput(target) {
    var win = findWindow("launcher");
    if (win) renderLauncherGroups(win, target.value);
  }

  function renderSettings(win) {
    var i, id, rows = "";
    var order = getOrderedApps();
    for (i = 0; i < order.length; i++) {
      id = order[i];
      rows += '<div class="settings-row"><span>' + escapeHtml(appById(id).name) + '</span>'
        + '<input type="text" maxlength="18" aria-label="Nome de ' + escapeHtml(appById(id).name) + '" data-label-app="' + id + '" value="' + escapeHtml(labelFor(id)) + '">'
        + '<button type="button" data-order-move="-1" data-app-id="' + id + '" aria-label="Mover para cima">↑</button>'
        + '<button type="button" data-order-move="1" data-app-id="' + id + '" aria-label="Mover para baixo">↓</button>'
        + '<label><input type="checkbox" data-dock-app="' + id + '"' + (settings.dock.indexOf(id) >= 0 ? " checked" : "") + '> Dock</label>'
        + '<label><input type="checkbox" data-desktop-app="' + id + '"' + (settings.desktop.indexOf(id) >= 0 ? " checked" : "") + '> Desktop</label></div>';
    }
    win.content.innerHTML = '<div class="app-panel"><h2>Configurações</h2>'
      + '<section class="settings-group"><strong>Aparência</strong>'
      + '<div class="settings-row"><span>Tema</span><select id="' + win.id + '-theme" class="select-field"><option value="dark">Escuro</option><option value="light">Claro</option></select></div>'
      + '<div class="settings-row"><span>Cor de destaque</span><select id="' + win.id + '-accent" class="select-field">'
      + '<option value="violet">Violeta</option><option value="blue">Azul</option><option value="teal">Verde-azulado</option><option value="orange">Laranja</option></select></div>'
      + '<div class="wallpaper-preview" id="' + win.id + '-wallpaper-preview"></div>'
      + '<label class="action-button" for="' + win.id + '-wallpaper-file">Escolher imagem de fundo</label>'
      + '<input class="hidden" type="file" accept="image/*" id="' + win.id + '-wallpaper-file">'
      + '<button class="action-button" type="button" data-settings-action="reset-wallpaper">Restaurar paisagem original</button></section>'
      + '<section class="settings-group"><strong>Ícones, Desktop e Dock</strong><p>Escolha o que aparece na área de trabalho e no Dock. O restante fica na central de aplicativos.</p>'
      + '<div id="' + win.id + '-app-order">' + rows + '</div></section>'
      + '<section class="settings-group"><strong>Dados locais</strong><p>Preferências, favoritos e tarefas recentes ficam neste aparelho.</p>'
      + '<button class="action-button" type="button" data-settings-action="reset">Restaurar configurações</button></section>'
      + '</div>';
    document.getElementById(win.id + "-theme").value = settings.theme;
    document.getElementById(win.id + "-accent").value = settings.accent;
    applySettings();
    updateWallpaperPreview(win);
  }

  function updateWallpaperPreview(win) {
    var preview = document.getElementById(win.id + "-wallpaper-preview");
    if (preview && settings.wallpaper) preview.style.backgroundImage = 'url("' + settings.wallpaper + '")';
  }

  function applySettings() {
    root.className = "os theme-" + (settings.theme === "light" ? "light" : "dark") + " accent-" + settings.accent;
    if (settings.wallpaper) root.style.backgroundImage = 'url("' + settings.wallpaper + '")';
    else root.style.backgroundImage = "";
  }

  function request(method, url, body, callback, timeout) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = timeout || 20000;
    if (body !== null && body !== undefined) xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data;
      try { data = JSON.parse(xhr.responseText || "{}"); } catch (e) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) callback(null, data, xhr);
      else callback(new Error(data && (data.error || data.message) || "Falha de comunicação (" + xhr.status + ")."), data, xhr);
    };
    xhr.ontimeout = function () { callback(new Error("A solicitação demorou mais que o esperado.")); };
    xhr.onerror = function () { callback(new Error("Sem resposta do servidor.")); };
    try { xhr.send(body === null || body === undefined ? null : JSON.stringify(body)); }
    catch (e) { callback(e); }
    return xhr;
  }

  function getJSON(url, callback) {
    return request("GET", url, null, callback);
  }

  function renderFilesList(win, data) {
    var list = document.getElementById(win.id + "-file-list");
    var pathLabel = document.getElementById(win.id + "-file-path");
    var tree = data && data.tree ? data.tree : [];
    var i, entry, button, suffix;
    if (!list) return;
    list.innerHTML = "";
    if (pathLabel) pathLabel.textContent = "Projeto " + (data.project || "default") + " / " + (data.root || ".");
    for (i = 0; i < tree.length; i++) {
      entry = tree[i];
      if (entry.type === "error") continue;
      button = document.createElement("button");
      button.type = "button";
      button.className = "file-entry" + (entry.type === "dir" ? " folder" : "");
      button.setAttribute("data-file-path", entry.path);
      button.setAttribute("data-file-type", entry.type);
      suffix = entry.type === "dir" ? "Pasta" : formatBytes(entry.size || 0);
      button.textContent = (entry.type === "dir" ? "▰  " : "▤  ") + entry.name + "  ·  " + suffix;
      list.appendChild(button);
    }
    if (!tree.length) list.textContent = "Esta pasta está vazia.";
  }

  function formatBytes(value) {
    var n = Number(value) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function fileCacheKey(project, path) {
    return project + "|" + (path || ".");
  }

  function cacheFileFolder(key, data) {
    var i;
    if (!Object.prototype.hasOwnProperty.call(fileFolderCache, key)) fileFolderCacheOrder.push(key);
    fileFolderCache[key] = data;
    while (fileFolderCacheOrder.length > 20) {
      i = fileFolderCacheOrder.shift();
      delete fileFolderCache[i];
    }
  }

  function clearProjectFileCache(project) {
    var prefix = project + "|";
    var kept = [];
    var i;
    for (i = 0; i < fileFolderCacheOrder.length; i++) {
      if (fileFolderCacheOrder[i].indexOf(prefix) === 0) delete fileFolderCache[fileFolderCacheOrder[i]];
      else kept.push(fileFolderCacheOrder[i]);
    }
    fileFolderCacheOrder = kept;
  }

  function loadFileFolder(winId, path, forceRefresh) {
    var win = windowById(winId);
    var projectInput = document.getElementById(winId + "-project");
    if (!win || !projectInput) return;
    var project = projectInput.value.replace(/^\s+|\s+$/g, "") || "default";
    var targetPath = path || ".";
    var key = fileCacheKey(project, targetPath);
    var cached;
    settings.project = project;
    settings.projectSource = "custom";
    saveSettings();
    win.fileLoadSequence = (win.fileLoadSequence || 0) + 1;
    var sequence = win.fileLoadSequence;
    if (forceRefresh) clearProjectFileCache(project);
    cached = fileFolderCache[key];
    if (cached && !forceRefresh) {
      win.currentPath = cached.root || targetPath;
      renderFilesList(win, cached);
      setStatusLine(win, "Pasta exibida do cache local");
      return;
    }
    setStatusLine(win, "Carregando arquivos…");
    var url = "/api/files?project=" + encodeURIComponent(project) + "&path=" + encodeURIComponent(targetPath) + "&depth=1";
    getJSON(url, function (err, data) {
      if (windowById(winId) !== win || win.fileLoadSequence !== sequence) return;
      if (err || !data || data.ok === false) {
        setStatusLine(win, "Não foi possível abrir esta pasta.");
        showNotice(err ? err.message : "Falha ao carregar arquivos.");
        return;
      }
      cacheFileFolder(key, data);
      win.currentPath = data.root || ".";
      renderFilesList(win, data);
      setStatusLine(win, "Arquivos carregados");
    });
  }

  function showFile(win, path) {
    var projectInput = document.getElementById(win.id + "-project");
    var project = projectInput ? projectInput.value.replace(/^\s+|\s+$/g, "") : "default";
    setStatusLine(win, "Abrindo arquivo…");
    getJSON("/api/files/read?project=" + encodeURIComponent(project) + "&path=" + encodeURIComponent(path), function (err, data) {
      if (windowById(win.id) !== win) return;
      var viewer = document.getElementById(win.id + "-file-viewer");
      var link = document.getElementById(win.id + "-file-download");
      if (err || !data || data.ok === false) {
        showNotice(err ? err.message : "Este arquivo não pôde ser lido como texto.");
        setStatusLine(win, "Falha ao abrir arquivo");
        return;
      }
      var content = data.content || "(arquivo vazio)";
      viewer.textContent = content.length > 80000
        ? content.slice(0, 80000) + "\n\n[Prévia limitada. Baixe o arquivo para ver o restante.]"
        : content;
      viewer.className = "file-viewer";
      link.href = "/workspace/" + encodeURIComponent(project) + "/" + encodePath(path);
      link.className = "action-button";
      setStatusLine(win, "Arquivo aberto");
    });
  }

  function encodePath(path) {
    var parts = String(path || "").split("/");
    var i;
    for (i = 0; i < parts.length; i++) parts[i] = encodeURIComponent(parts[i]);
    return parts.join("/");
  }

  function uploadAttachment(win) {
    var input = document.getElementById(win.id + "-upload");
    var result = document.getElementById(win.id + "-upload-result");
    var file = input && input.files && input.files[0];
    if (!file) { showNotice("Escolha um arquivo antes de enviar."); return; }
    if (file.size > 50 * 1024 * 1024) { showNotice("O limite do servidor é 50 MB."); return; }
    var form = new FormData();
    form.append("file", file);
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    xhr.timeout = 60000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        result.innerHTML = "";
        var link = document.createElement("a");
        link.href = data.url;
        link.textContent = "Anexo enviado: " + (data.originalname || file.name);
        link.className = "action-button";
        result.appendChild(link);
        setStatusLine(win, "Anexo enviado");
      } else {
        showNotice(data.error || "O envio do anexo falhou.");
        setStatusLine(win, "Falha no envio");
      }
    };
    xhr.onerror = function () { showNotice("Sem resposta do servidor."); };
    xhr.ontimeout = function () { showNotice("O envio demorou demais."); };
    setStatusLine(win, "Enviando anexo…");
    xhr.send(form);
  }

  function renderTerminalText(winId, text) {
    var out = document.getElementById(winId + "-terminal-output");
    if (out) out.textContent = text;
  }

  function runRemoteJob(winId) {
    var win = windowById(winId);
    var type = document.getElementById(winId + "-job-type");
    var workspace = document.getElementById(winId + "-workspace");
    if (!win || !type || !workspace) return;
    var workspaceName = workspace.value.replace(/^\s+|\s+$/g, "") || "default";
    var payload = { type: type.value, workspace: workspaceName, parameters: {} };
    setStatusLine(win, "Enviando tarefa ao worker…");
    renderTerminalText(winId, "Tarefa enviada. Acompanhe manualmente pelo botão Atualizar tarefa.");
    request("POST", "/api/remote/jobs", payload, function (err, data) {
      if (windowById(winId) !== win) return;
      if (err || !data || !data.ok) {
        setStatusLine(win, "Worker indisponível ou tarefa não autorizada.");
        renderTerminalText(winId, err ? err.message : "O Gateway não aceitou essa tarefa.");
        return;
      }
      win.remoteJobId = data.jobId;
      var refresh = document.getElementById(winId + "-job-refresh");
      if (refresh) refresh.className = "action-button";
      setStatusLine(win, "Tarefa enviada");
      renderTerminalText(winId, "Tarefa recebida pelo Gateway. Toque em “Atualizar tarefa” quando quiser consultar o resultado.");
    });
  }

  function refreshRemoteJob(winId) {
    var win = windowById(winId);
    if (!win || !win.remoteJobId) { showNotice("Nenhuma tarefa remota selecionada."); return; }
    getJSON("/api/remote/jobs/" + encodeURIComponent(win.remoteJobId), function (err, data) {
      if (windowById(winId) !== win) return;
      if (err || !data || !data.job) {
        renderTerminalText(winId, err ? err.message : "Não foi possível consultar a tarefa.");
        return;
      }
      var job = data.job;
      var text = "Estado: " + friendlyJobStatus(job.status) + "\n";
      if (job.progressPct != null) text += "Progresso: " + job.progressPct + "%\n";
      if (job.error) text += "\n" + job.error;
      if (job.logsTail && job.logsTail.length) {
        text += "\n\n";
        var i;
        for (i = 0; i < job.logsTail.length; i++) {
          text += String(job.logsTail[i].text || job.logsTail[i].stream || "") + "\n";
        }
      }
      if (job.result && typeof job.result === "object" && job.result.ok) text += "\nConcluído.";
      renderTerminalText(winId, text);
      setStatusLine(win, "Estado atualizado");
    });
  }

  function friendlyJobStatus(status) {
    var map = { QUEUED: "na fila", RUNNING: "em execução", COMPLETED: "concluída", FAILED: "falhou", CANCELLED: "cancelada", TIMEOUT: "tempo esgotado" };
    return map[status] || "indisponível";
  }

  function refreshRemoteAgents(winId) {
    var win = windowById(winId);
    if (!win) return;
    setStatusLine(win, "Atualizando conexão…");
    getJSON("/api/remote/status", function (err, data) {
      if (windowById(winId) !== win) return;
      var target = document.getElementById(winId + "-remote-status");
      if (!target) return;
      if (err || !data || !data.ok) target.textContent = "Gateway remoto indisponível.";
      else {
        var count = 0, i;
        for (i = 0; i < (data.agents || []).length; i++) {
          if (/^(ONLINE|IDLE)$/i.test(data.agents[i].status || "")) count++;
        }
        target.textContent = count ? count + " worker(s) conectado(s)." : "Nenhum worker conectado no momento.";
      }
      setStatusLine(win, "Conexão atualizada");
    });
  }

  function renderGalleryFiles(win, files) {
    var grid = document.getElementById(win.id + "-gallery-grid");
    if (!grid) return;
    grid.innerHTML = "";
    var index = 0;
    var selected = 0;
    var queue = [];
    var i;
    for (i = 0; i < files.length && queue.length < 6; i++) {
      if (files[i].type && files[i].type.indexOf("image/") === 0 && files[i].size <= 12 * 1024 * 1024) queue.push(files[i]);
    }
    function next() {
      if (windowById(win.id) !== win || index >= queue.length) {
        if (!selected) grid.textContent = "Nenhuma imagem compatível selecionada.";
        return;
      }
      var file = queue[index++];
      compressImage(file, 800, 600, .68, function (err, dataUrl) {
        if (!err && dataUrl && windowById(win.id) === win) {
          var img = document.createElement("img");
          img.className = "gallery-thumb";
          img.alt = "Imagem selecionada";
          img.src = dataUrl;
          grid.appendChild(img);
          selected++;
        }
        next();
      });
    }
    next();
  }

  function updateNetworkStatus() {
    var online = navigator.onLine !== false;
    var status = document.getElementById("network-status");
    var label = document.getElementById("network-label");
    if (!status || !label) return;
    status.className = online ? "network-status" : "network-status offline";
    label.textContent = online ? "Online" : "Sem conexão";
  }

  function updateClock() {
    var clock = document.getElementById("clock");
    if (!clock) return;
    var d = new Date();
    var days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    var hh = d.getHours();
    var mm = d.getMinutes();
    clock.textContent = days[d.getDay()] + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " · " + pad(hh) + ":" + pad(mm);
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function updateBattery() {
    var target = document.getElementById("battery-status");
    if (!target || !navigator.getBattery) return;
    try {
      navigator.getBattery().then(function (battery) {
        target.hidden = false;
        target.textContent = Math.round(battery.level * 100) + "%";
      });
    } catch (e) {}
  }

  function connectAgent() {
    if (agentSocket && (agentSocket.readyState === 0 || agentSocket.readyState === 1)) return;
    if (navigator.onLine === false) { showNotice("Conecte-se à internet para enviar a tarefa."); return; }
    var win = windowById(agentWindowId);
    if (!win) return;
    var state = document.getElementById("agent-state-" + win.id);
    if (state) { state.textContent = "Conectando…"; state.className = "agent-state busy"; }
    var protocol = location.protocol === "https:" ? "wss://" : "ws://";
    try { agentSocket = new WebSocket(protocol + location.host + "/ws"); }
    catch (e) { showNotice("Não foi possível conectar ao agente."); return; }
    agentSocket.onopen = function () {
      if (settings.agentSession) agentSocket.send(JSON.stringify({ type: "session:resume", sessionId: settings.agentSession, project: settings.project || "default" }));
      else agentSocket.send(JSON.stringify({ type: "session:new", project: settings.project || "default" }));
    };
    agentSocket.onmessage = function (event) {
      var message;
      try { message = JSON.parse(event.data); } catch (e) { return; }
      handleAgentMessage(message);
    };
    agentSocket.onerror = function () { showNotice("Falha na conexão com o agente."); };
    agentSocket.onclose = function () {
      agentSocket = null;
      agentReady = false;
      var current = windowById(agentWindowId);
      if (current) {
        var stateNode = document.getElementById("agent-state-" + current.id);
        if (stateNode) { stateNode.textContent = "Desconectado"; stateNode.className = "agent-state"; }
      }
    };
  }

  function handleAgentMessage(message) {
    var win = windowById(agentWindowId);
    var data = message.data || {};
    if (message.type === "session:ready") {
      settings.agentSession = data.id || "";
      saveSettings();
      agentReady = true;
      var state = win && document.getElementById("agent-state-" + win.id);
      if (state) { state.textContent = "Online"; state.className = "agent-state"; }
      if (agentQueuedPrompt) sendQueuedPrompt();
      return;
    }
    if (message.type === "agent:state") {
      if (win) {
        var agentState = document.getElementById("agent-state-" + win.id);
        if (agentState && data.state === "running") {
          agentState.textContent = "Trabalhando…";
          agentState.className = "agent-state busy";
        }
      }
      return;
    }
    if (message.type === "message:ai:delta" || message.type === "message:ai") {
      if (typeof data.text === "string") agentCurrentText = data.text;
      showAgentOutput();
      return;
    }
    if (message.type === "agent:step" || message.type === "agent:progress") {
      if (win) setStatusLine(win, "Tarefa em andamento…");
      return;
    }
    if (message.type === "agent:done") {
      finishAgentTask(data.reason || "finished");
      return;
    }
    if (message.type === "project:created" || message.type === "project:switched") {
      var projectSlug = data.project && (data.project.slug || data.project.name) ? (data.project.slug || data.project.name) : data.project;
      if (typeof data.slug === "string") projectSlug = data.slug;
      openStudioForProject(typeof projectSlug === "string" ? projectSlug : settings.project);
      return;
    }
    if (message.type === "error") {
      agentCurrentText = String(data.message || "O agente encontrou um erro.");
      showAgentOutput();
      if (win) setStatusLine(win, "O agente encontrou um problema.");
    }
  }

  function sendAgentTask(winId) {
    var win = windowById(winId);
    var form = win && win.content.querySelector("form[data-agent-form]");
    var field = form && form.querySelector("textarea[name=prompt]");
    var text = field ? field.value.replace(/^\s+|\s+$/g, "") : "";
    if (!text) { showNotice("Digite uma solicitação primeiro."); return; }
    if (agentCurrentTask) { showNotice("Aguarde a tarefa atual terminar."); return; }
    agentWindowId = winId;
    agentCurrentTask = { prompt: text, started: new Date().toISOString() };
    agentCurrentText = "";
    agentWantsCode = /c[oó]digo|arquivo|fonte|mostrar|exibir|abrir/i.test(text);
    agentQueuedPrompt = text;
    if (field) field.value = "";
    var state = document.getElementById("agent-state-" + winId);
    if (state) { state.textContent = "Enviando…"; state.className = "agent-state busy"; }
    setStatusLine(win, "Solicitação enviada");
    if (agentSocket && agentSocket.readyState === 1 && agentReady) sendQueuedPrompt();
    else connectAgent();
  }

  function sendQueuedPrompt() {
    if (!agentSocket || agentSocket.readyState !== 1 || !agentReady || !agentQueuedPrompt) return;
    var text = agentQueuedPrompt;
    agentQueuedPrompt = null;
    agentSocket.send(JSON.stringify({ type: "chat:send", text: text, images: [] }));
  }

  function showAgentOutput() {
    var win = windowById(agentWindowId);
    if (!win) return;
    var target = document.getElementById("agent-output-" + win.id);
    if (!target) return;
    var text = agentCurrentText || "";
    var codePresent = /```[\s\S]*?```/.test(text);
    if (codePresent && !agentWantsCode) {
      text = text.replace(/```[\s\S]*?```/g, "[Trecho de código oculto. Peça “mostrar o código” para exibi-lo.]");
    }
    target.textContent = text;
    var existing = document.getElementById("agent-show-code-" + win.id);
    if (codePresent && !agentWantsCode && !existing) {
      var button = document.createElement("button");
      button.type = "button";
      button.id = "agent-show-code-" + win.id;
      button.className = "action-button";
      button.textContent = "Mostrar código da resposta";
      button.setAttribute("data-agent-show-code", win.id);
      target.parentNode.insertBefore(button, target.nextSibling);
    }
  }

  function finishAgentTask(reason) {
    var win = windowById(agentWindowId);
    if (!agentCurrentTask) return;
    var finishedPrompt = agentCurrentTask.prompt;
    var status = reason === "finished" ? "Concluída" : "Finalizada";
    settings.taskHistory.push({
      prompt: agentCurrentTask.prompt,
      response: agentCurrentText.slice(0, 20000),
      status: status,
      date: new Date().toISOString(),
      showCode: agentWantsCode
    });
    if (settings.taskHistory.length > 12) settings.taskHistory = settings.taskHistory.slice(-12);
    saveSettings();
    if (win) {
      var state = document.getElementById("agent-state-" + win.id);
      if (state) { state.textContent = status; state.className = "agent-state"; }
      setStatusLine(win, status);
      refreshAgentHistory(win);
    }
    agentCurrentTask = null;
    agentCurrentText = "";
    agentWantsCode = false;
    if (agentSocket) {
      var idleSocket = agentSocket;
      agentSocket = null;
      agentReady = false;
      idleSocket.onclose = null;
      try { idleSocket.close(); } catch (e) {}
    }
    maybeOpenStudioAfterTask(finishedPrompt);
  }

  function refreshAgentHistory(win) {
    var host = document.getElementById("agent-history-" + win.id);
    if (!host) return;
    host.innerHTML = "";
    var i, button;
    for (i = settings.taskHistory.length - 1; i >= 0 && i >= settings.taskHistory.length - 5; i--) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      button.setAttribute("data-history", i);
      button.textContent = shortText(settings.taskHistory[i].prompt, 68);
      host.appendChild(button);
    }
    if (!settings.taskHistory.length) host.textContent = "Suas tarefas concluídas aparecerão aqui.";
  }

  function disconnectAgent() {
    if (agentSocket) {
      try { agentSocket.close(); } catch (e) {}
    }
    agentSocket = null;
    agentReady = false;
    agentWindowId = null;
    agentCurrentTask = null;
    agentQueuedPrompt = null;
    agentCurrentText = "";
  }

  function navigateBrowser(win, value, fromHistory) {
    var input = document.getElementById(win.id + "-address");
    var frame = document.getElementById(win.id + "-frame");
    var note = document.getElementById(win.id + "-browser-note");
    var raw = String(value || "").replace(/^\s+|\s+$/g, "");
    if (!raw) return;
    var url;
    if (/^https?:\/\//i.test(raw)) url = raw;
    else if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(raw)) url = "https://" + raw;
    else url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(raw);
    if (input) input.value = url;
    if (!fromHistory) {
      settings.browserHistory.push(url);
      if (settings.browserHistory.length > 30) settings.browserHistory.shift();
      saveSettings();
      win.browserHistory = settings.browserHistory.slice(0);
      win.browserCursor = win.browserHistory.length - 1;
      refreshBrowserHistory(win);
    }
    if (navigator.userAgent.indexOf("TIAgenteOSNative/1.0") >= 0) {
      if (note) note.textContent = "Abrindo a página no navegador interno do aplicativo.";
      setStatusLine(win, "Abrindo navegador interno");
      window.location.href = url;
      return;
    }
    if (frame) frame.src = url;
    if (note) note.textContent = "Página solicitada neste painel. Se o site bloquear a incorporação, ele não poderá ser exibido aqui.";
    setStatusLine(win, "Página solicitada");
  }

  function toggleFavorite(win) {
    var input = document.getElementById(win.id + "-address");
    var url = input && input.value;
    if (!url) { showNotice("Abra um endereço antes de salvar favorito."); return; }
    var i, found = -1;
    for (i = 0; i < settings.favorites.length; i++) if (settings.favorites[i].url === url) found = i;
    if (found >= 0) settings.favorites.splice(found, 1);
    else settings.favorites.unshift({ url: url, title: url.replace(/^https?:\/\//, "") });
    if (settings.favorites.length > 12) settings.favorites.length = 12;
    saveSettings();
    var favoriteButton = win.content.querySelector('[data-browser-action="favorite"]');
    if (favoriteButton) favoriteButton.textContent = found >= 0 ? "☆ Favorito" : "★ Favorito";
    refreshBrowserFavorites(win);
    showNotice(found >= 0 ? "Favorito removido." : "Favorito salvo neste aparelho.");
  }

  function refreshBrowserFavorites(win) {
    var target = document.getElementById(win.id + "-favorites");
    if (!target) return;
    target.innerHTML = "";
    var i, button;
    for (i = 0; i < settings.favorites.length && i < 8; i++) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-navigate", settings.favorites[i].url);
      button.textContent = shortText(settings.favorites[i].title || settings.favorites[i].url, 26);
      target.appendChild(button);
    }
  }

  function refreshBrowserHistory(win) {
    var target = document.getElementById(win.id + "-history");
    if (!target) return;
    target.innerHTML = "";
    var i, count = 0, button;
    for (i = settings.browserHistory.length - 1; i >= 0 && count < 5; i--, count++) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-navigate", settings.browserHistory[i]);
      button.textContent = shortText(settings.browserHistory[i].replace(/^https?:\/\//, ""), 25);
      target.appendChild(button);
    }
  }

  function renderMenu(kind, anchor) {
    var items = [];
    if (kind === "arquivo" || kind === "main") {
      items = [["TIAgente", "app:agent"], ["Navegador", "app:browser"], ["Arquivos", "app:files"], ["Configurações", "app:settings"], ["Aplicativos", "app:launcher"]];
    } else if (kind === "editar") {
      items = [["Calculadora", "app:calculator"], ["Galeria", "app:gallery"], ["E-mail", "app:email"]];
    } else if (kind === "visualizar") {
      items = [["Mostrar aplicativos", "show-apps"], ["Restaurar janelas", "restore-windows"], ["Tela cheia", "fullscreen"]];
    } else {
      items = [["Sobre o TIAgente OS", "about"], ["Instalar na Tela de Início", "install-help"]];
    }
    var html = "";
    var i;
    for (i = 0; i < items.length; i++) {
      html += '<button type="button" data-menu-action="' + items[i][1] + '">' + escapeHtml(items[i][0]) + "</button>";
    }
    menuPopover.innerHTML = html;
    menuPopover.hidden = false;
    menuPopover.style.left = anchor && anchor.getBoundingClientRect ? Math.max(8, anchor.getBoundingClientRect().left) + "px" : "12px";
    menuPopover.style.top = "8px";
  }

  function handleMenuAction(action) {
    if (action.indexOf("app:") === 0) openApp(action.slice(4));
    else if (action === "show-apps") openLauncherSearch();
    else if (action === "restore-windows") {
      var i;
      for (i = 0; i < windows.length; i++) if (windows[i].minimized) focusWindow(windows[i]);
    } else if (action === "fullscreen") {
      try {
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
        else showNotice("A tela cheia é controlada pelo Safari neste aparelho.");
      } catch (e) { showNotice("A tela cheia é controlada pelo Safari."); }
    } else if (action === "about") showNotice("TIAgente OS 1.0 · Ambiente web independente.");
    else if (action === "install-help") showNotice("No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.");
    menuPopover.hidden = true;
  }

  function handleClick(event) {
    var target = event.target;
    var appButton = closestAttribute(target, "data-app");
    var menuButton = closestAttribute(target, "data-menu");
    var actionButton = closestAttribute(target, "data-action");
    var menuAction = closestAttribute(target, "data-menu-action");
    var winAction = closestAttribute(target, "data-window-action");
    var shortcut = closestAttribute(target, "data-prompt");
    var historyButton = closestAttribute(target, "data-history");
    var browserAction = closestAttribute(target, "data-browser-action");
    var navigate = closestAttribute(target, "data-navigate");
    var email = closestAttribute(target, "data-email-url");
    var fileAction = closestAttribute(target, "data-files-action");
    var terminalAction = closestAttribute(target, "data-terminal-action");
    var studioAction = closestAttribute(target, "data-studio-action");
    var moduleAction = closestAttribute(target, "data-module-action");
    var appWindow;
    if (appButton) {
      menuPopover.hidden = true;
      if (appButton.getAttribute("data-app") === "settings" && appButton.hasAttribute("data-prompt")) {
        openApp("settings");
      } else openApp(appButton.getAttribute("data-app"));
      return;
    }
    if (menuButton) { renderMenu(menuButton.getAttribute("data-menu"), menuButton); return; }
    if (actionButton && actionButton.getAttribute("data-action") === "menu") { renderMenu("main", actionButton); return; }
    if (actionButton && actionButton.getAttribute("data-action") === "global-search") { menuPopover.hidden = true; openLauncherSearch(); return; }
    if (menuAction) { handleMenuAction(menuAction.getAttribute("data-menu-action")); return; }
    if (winAction) {
      var id = winAction.getAttribute("data-window");
      var action = winAction.getAttribute("data-window-action");
      appWindow = windowById(id);
      if (action === "close") closeWindow(id);
      else if (action === "minimize") minimizeWindow(id);
      else if (action === "maximize") toggleMaximize(appWindow);
      return;
    }
    if (shortcut) {
      var win = windowById(closestAttribute(shortcut, "data-agent-form") ? closestAttribute(shortcut, "data-agent-form").getAttribute("data-agent-form") : "");
      if (!win) win = findWindow("agent");
      if (win && shortcut.hasAttribute("data-prompt")) {
        var field = win.content.querySelector("textarea[name=prompt]");
        if (field) { field.value = shortcut.getAttribute("data-prompt") + " "; field.focus(); }
      }
      return;
    }
    if (historyButton) {
      var item = settings.taskHistory[parseInt(historyButton.getAttribute("data-history"), 10)];
      var winHistory = findWindow("agent");
      if (item && winHistory) {
        var out = document.getElementById("agent-output-" + winHistory.id);
        if (out) out.textContent = item.response || "Tarefa " + (item.status || "enviada") + ".";
      }
      return;
    }
    if (closestAttribute(target, "data-agent-show-code")) {
      var showButton = closestAttribute(target, "data-agent-show-code");
      var winCode = windowById(showButton.getAttribute("data-agent-show-code"));
      var last = settings.taskHistory[settings.taskHistory.length - 1];
      if (winCode && last) {
        var output = document.getElementById("agent-output-" + winCode.id);
        if (output) output.textContent = last.response || agentCurrentText;
      }
      return;
    }
    if (browserAction) { handleBrowserAction(browserAction); return; }
    if (navigate) { navigateBrowser(findWindow("browser"), navigate.getAttribute("data-navigate")); return; }
    if (email) {
      var browserWindow = openApp("browser");
      navigateBrowser(browserWindow, email.getAttribute("data-email-url"));
      return;
    }
    if (fileAction) { handleFilesAction(fileAction); return; }
    if (terminalAction) { handleTerminalAction(terminalAction); return; }
    if (studioAction) { handleStudioAction(studioAction); return; }
    if (moduleAction) { handleModuleAction(moduleAction); return; }
    if (closestAttribute(target, "data-file-path")) { handleFileEntry(closestAttribute(target, "data-file-path")); return; }
    if (closestAttribute(target, "data-calc")) { handleCalculator(closestAttribute(target, "data-calc")); return; }
    if (closestAttribute(target, "data-settings-action")) { handleSettingsAction(closestAttribute(target, "data-settings-action")); return; }
    if (closestAttribute(target, "data-order-move")) { moveApp(closestAttribute(target, "data-order-move")); return; }
    if (target && target.className && String(target.className).indexOf("app-window") >= 0) focusWindow(windowById(target.id));
    else if (target && target.closest) {
      var parentWindow = target.closest(".app-window");
      if (parentWindow) focusWindow(windowById(parentWindow.id));
    } else {
      var parent = target;
      while (parent && parent !== windowsHost) {
        if (parent.id && parent.id.indexOf("os-window-") === 0) { focusWindow(windowById(parent.id)); break; }
        parent = parent.parentNode;
      }
    }
    if (!menuButton && !menuAction && !menuPopover.contains(target)) menuPopover.hidden = true;
  }

  function closestAttribute(node, attribute) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute(attribute) !== null) return node;
      node = node.parentNode;
    }
    return null;
  }

  function toggleMaximize(win) {
    if (!win) return;
    win.maximized = !win.maximized;
    win.el.className = win.maximized ? "app-window maximized active" : "app-window active";
    focusWindow(win);
  }

  function handleBrowserAction(button) {
    var win = findWindow("browser");
    if (!win) return;
    var action = button.getAttribute("data-browser-action");
    if (action === "go") {
      var input = document.getElementById(win.id + "-address");
      navigateBrowser(win, input ? input.value : "");
    } else if (action === "back") {
      if (win.browserCursor > 0) {
        win.browserCursor--;
        navigateBrowser(win, win.browserHistory[win.browserCursor], true);
      }
    } else if (action === "forward") {
      if (win.browserCursor < win.browserHistory.length - 1) {
        win.browserCursor++;
        navigateBrowser(win, win.browserHistory[win.browserCursor], true);
      }
    } else if (action === "home") {
      var frame = document.getElementById(win.id + "-frame");
      if (frame) frame.src = "about:blank";
      var note = document.getElementById(win.id + "-browser-note");
      if (note) note.textContent = "Digite um endereço ou pesquise. As páginas serão abertas neste painel; alguns sites podem bloquear a incorporação.";
    } else if (action === "favorite") toggleFavorite(win);
  }

  function handleFilesAction(button) {
    var win = windowById(button.getAttribute("data-window"));
    if (!win) return;
    var action = button.getAttribute("data-files-action");
    if (action === "load") loadFileFolder(win.id, ".", true);
    else if (action === "up") {
      var path = win.currentPath || ".";
      if (path !== ".") {
        var parts = path.split("/");
        parts.pop();
        loadFileFolder(win.id, parts.join("/") || ".");
      }
    } else if (action === "upload") uploadAttachment(win);
  }

  function handleFileEntry(button) {
    var win = findWindow("files");
    if (!win) return;
    var path = button.getAttribute("data-file-path");
    if (button.getAttribute("data-file-type") === "dir") loadFileFolder(win.id, path);
    else showFile(win, path);
  }

  function handleTerminalAction(button) {
    var winId = button.getAttribute("data-window");
    var action = button.getAttribute("data-terminal-action");
    if (action === "run") runRemoteJob(winId);
    else if (action === "refresh-job") refreshRemoteJob(winId);
    else if (action === "refresh-agents") refreshRemoteAgents(winId);
  }

  function handleStudioAction(button) {
    var win = findWindow("studio");
    if (!win) return;
    var action = button.getAttribute("data-studio-action");
    var input = document.getElementById(win.id + "-studio-project");
    var slug = input ? input.value.replace(/^\s+|\s+$/g, "") : settings.project;
    if (action === "load" || action === "reload" || action === "reopen") loadStudioPreview(win, slug);
    else if (action === "publish") publishStudio(win);
    else if (action === "fullscreen") toggleMaximize(win);
  }

  function handleSettingsAction(button) {
    var action = button.getAttribute("data-settings-action");
    if (action === "reset-wallpaper") {
      settings.wallpaper = "";
      saveSettings();
      applySettings();
      var win = findWindow("settings");
      if (win) updateWallpaperPreview(win);
      showNotice("Papel de parede original restaurado.");
    } else if (action === "reset") {
      settings = JSON.parse(JSON.stringify(DEFAULTS));
      saveSettings();
      applySettings();
      renderDesktopIcons();
      var settingsWin = findWindow("settings");
      if (settingsWin) renderApp(settingsWin);
      showNotice("Preferências locais restauradas.");
    }
  }

  function moveApp(button) {
    var id = button.getAttribute("data-app-id");
    var delta = parseInt(button.getAttribute("data-order-move"), 10);
    var index = settings.order.indexOf(id);
    var other = index + delta;
    if (index < 0 || other < 0 || other >= settings.order.length) return;
    var tmp = settings.order[index];
    settings.order[index] = settings.order[other];
    settings.order[other] = tmp;
    saveSettings();
    renderDesktopIcons();
    var win = findWindow("settings");
    if (win) renderSettings(win);
  }

  function handleCalculator(button) {
    var key = button.getAttribute("data-calc");
    var win = findWindow("calculator");
    var display = win && document.getElementById(win.id + "-calc-display");
    if (!display) return;
    if (key === "C") display.value = "0";
    else if (key === "=") {
      try { display.value = String(parseMath(display.value)); }
      catch (e) { display.value = "Erro"; }
    } else {
      if (display.value === "0" || display.value === "Erro") display.value = "";
      display.value += key;
    }
  }

  function parseMath(input) {
    var text = String(input).replace(/×/g, "*").replace(/÷/g, "/").replace(/\s/g, "");
    if (!text || text.length > 80) throw new Error("expressão inválida");
    var index = 0;
    function expression() {
      var value = term();
      while (text.charAt(index) === "+" || text.charAt(index) === "-") {
        var op = text.charAt(index++);
        var next = term();
        value = op === "+" ? value + next : value - next;
      }
      return value;
    }
    function term() {
      var value = factor();
      while (text.charAt(index) === "*" || text.charAt(index) === "/" || text.charAt(index) === "%") {
        var op = text.charAt(index++);
        var next = factor();
        if ((op === "/" || op === "%") && next === 0) throw new Error("divisão por zero");
        value = op === "*" ? value * next : (op === "/" ? value / next : value % next);
      }
      return value;
    }
    function factor() {
      var sign = 1;
      if (text.charAt(index) === "+") index++;
      else if (text.charAt(index) === "-") { sign = -1; index++; }
      if (text.charAt(index) === "(") {
        index++;
        var nested = expression();
        if (text.charAt(index) !== ")") throw new Error("parêntese");
        index++;
        return sign * nested;
      }
      var start = index;
      while (/[0-9.]/.test(text.charAt(index)) && text.charAt(index)) index++;
      if (start === index) throw new Error("número");
      var number = Number(text.slice(start, index));
      if (!isFinite(number)) throw new Error("número");
      return sign * number;
    }
    var result = expression();
    if (index !== text.length || !isFinite(result)) throw new Error("expressão");
    return Math.round(result * 100000000) / 100000000;
  }

  function compressImage(file, maxWidth, maxHeight, quality, callback) {
    var reader = new FileReader();
    reader.onerror = function () { callback(new Error("Não foi possível ler a imagem.")); };
    reader.onload = function () {
      var image = new Image();
      image.onerror = function () { callback(new Error("Formato de imagem não reconhecido.")); };
      image.onload = function () {
        var scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        var context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        try { callback(null, canvas.toDataURL("image/jpeg", quality)); }
        catch (e) { callback(e); }
        canvas.width = 1;
        canvas.height = 1;
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function handleChange(event) {
    var target = event.target;
    if (target.getAttribute("data-label-app")) {
      var id = target.getAttribute("data-label-app");
      var value = target.value.replace(/^\s+|\s+$/g, "");
      if (value) settings.labels[id] = value;
      else delete settings.labels[id];
      saveSettings();
      renderDesktopIcons();
      return;
    }
    if (target.getAttribute("data-dock-app")) {
      var appId = target.getAttribute("data-dock-app");
      var index = settings.dock.indexOf(appId);
      if (target.checked && index < 0) settings.dock.push(appId);
      if (!target.checked && index >= 0) settings.dock.splice(index, 1);
      saveSettings();
      renderDock();
      return;
    }
    if (target.getAttribute("data-desktop-app")) {
      var deskId = target.getAttribute("data-desktop-app");
      var deskIndex = settings.desktop.indexOf(deskId);
      if (target.checked && deskIndex < 0) settings.desktop.push(deskId);
      if (!target.checked && deskIndex >= 0) settings.desktop.splice(deskIndex, 1);
      saveSettings();
      renderDesktopIcons();
      return;
    }
    if (target.id && /-theme$/.test(target.id)) {
      settings.theme = target.value;
      saveSettings();
      applySettings();
      return;
    }
    if (target.id && /-accent$/.test(target.id)) {
      settings.accent = target.value;
      saveSettings();
      applySettings();
      return;
    }
    if (target.id && /-wallpaper-file$/.test(target.id)) {
      if (!target.files || !target.files[0]) return;
      if (target.files[0].size > 8 * 1024 * 1024) { showNotice("Escolha uma imagem menor que 8 MB."); return; }
      compressImage(target.files[0], 1280, 900, .72, function (err, dataUrl) {
        if (err) { showNotice(err.message); return; }
        settings.wallpaper = dataUrl;
        if (saveSettings()) {
          applySettings();
          var settingsWin = findWindow("settings");
          if (settingsWin) updateWallpaperPreview(settingsWin);
          showNotice("Papel de parede salvo neste aparelho.");
        }
      });
      return;
    }
    if (target.id && /-gallery-input$/.test(target.id)) {
      var gallery = findWindow("gallery");
      if (gallery && target.files) renderGalleryFiles(gallery, target.files);
    }
  }

  function handleInput(event) {
    var target = event.target;
    if (target && target.id && /-launcher-search$/.test(target.id)) handleLauncherInput(target);
  }

  function handleSubmit(event) {
    var form = closestAttribute(event.target, "data-agent-form");
    if (form) {
      event.preventDefault();
      sendAgentTask(form.getAttribute("data-agent-form"));
    }
  }

  function handleKeydown(event) {
    if (event.keyCode === 13 && event.target && event.target.id && /-address$/.test(event.target.id)) {
      event.preventDefault();
      var win = findWindow("browser");
      if (win) navigateBrowser(win, event.target.value);
    }
    if (event.keyCode === 13 && event.target && event.target.tagName === "TEXTAREA" && event.target.getAttribute("name") === "prompt" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      var agent = findWindow("agent");
      if (agent) sendAgentTask(agent.id);
    }
  }

  function startDrag(event) {
    var title = closestAttribute(event.target, "data-drag-window");
    var resize = closestAttribute(event.target, "data-resize-window");
    var winId = title ? title.getAttribute("data-drag-window") : (resize && resize.getAttribute("data-resize-window"));
    var win = windowById(winId);
    if (!win || win.maximized) return;
    if (title && closestAttribute(event.target, "data-window-action")) return;
    var point = event.touches && event.touches.length ? event.touches[0] : event;
    var rect = win.el.getBoundingClientRect();
    var desktopRect = desktop.getBoundingClientRect();
    dragState = {
      win: win,
      resize: !!resize,
      startX: point.clientX,
      startY: point.clientY,
      left: rect.left - desktopRect.left,
      top: rect.top - desktopRect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };
    focusWindow(win);
  }

  function moveDrag(event) {
    if (!dragState) return;
    var point = event.touches && event.touches.length ? event.touches[0] : event;
    var dx = point.clientX - dragState.startX;
    var dy = point.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragState.moved = true;
    if (dragState.moved && event.preventDefault) event.preventDefault();
    var rect = desktop.getBoundingClientRect();
    if (dragState.resize) {
      dragState.win.el.style.width = Math.max(300, Math.min(rect.width - 10, dragState.width + dx)) + "px";
      dragState.win.el.style.height = Math.max(220, Math.min(rect.height - 10, dragState.height + dy)) + "px";
    } else {
      dragState.win.el.style.left = Math.max(0, Math.min(rect.width - 130, dragState.left + dx)) + "px";
      dragState.win.el.style.top = Math.max(0, Math.min(rect.height - 90, dragState.top + dy)) + "px";
    }
  }

  function endDrag() { dragState = null; }

  function initialize() {
    applySettings();
    renderDesktopIcons();
    updateClock();
    updateNetworkStatus();
    updateBattery();
    window.setInterval(updateClock, 30000);
    window.addEventListener("online", updateNetworkStatus, false);
    window.addEventListener("offline", updateNetworkStatus, false);
    window.addEventListener("orientationchange", function () {
      var i;
      for (i = 0; i < windows.length; i++) positionWindow(windows[i], i);
    }, false);
    document.addEventListener("click", handleClick, false);
    document.addEventListener("change", handleChange, false);
    document.addEventListener("input", handleInput, false);
    document.addEventListener("submit", handleSubmit, false);
    document.addEventListener("keydown", handleKeydown, false);
    windowsHost.addEventListener("mousedown", startDrag, false);
    windowsHost.addEventListener("touchstart", startDrag, false);
    document.addEventListener("mousemove", moveDrag, false);
    document.addEventListener("touchmove", moveDrag, false);
    document.addEventListener("mouseup", endDrag, false);
    document.addEventListener("touchend", endDrag, false);
    document.addEventListener("touchcancel", endDrag, false);
    document.addEventListener("click", function (event) {
      if (!menuPopover.hidden && !menuPopover.contains(event.target) && !closestAttribute(event.target, "data-menu")) menuPopover.hidden = true;
    }, true);
    openApp("agent");
  }

  initialize();
}());
