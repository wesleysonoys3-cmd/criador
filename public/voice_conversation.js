(function () {
  'use strict';

  if (window.__TI_VOICE_CONVERSATION_LOADED__) return;
  window.__TI_VOICE_CONVERSATION_LOADED__ = true;
  window.__TI_USE_VOICE_CONVERSATION__ = true;

  const VOICE_REST_BASE =
    (window.__TI_CONFIG__ && typeof window.__TI_CONFIG__.VOICE_REST_URL === 'string' && String(window.__TI_CONFIG__.VOICE_REST_URL).replace(/\/+$/, '')) ||
    (window.VOICE_REST_URL && String(window.VOICE_REST_URL).replace(/\/+$/, '')) ||
    'http://127.0.0.1:3005';

  const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking',
    ERROR: 'error',
  };

  const STATE_LABEL = {
    [STATES.IDLE]: 'Clique para iniciar a conversa',
    [STATES.LISTENING]: 'Ouvindo…',
    [STATES.PROCESSING]: 'Processando…',
    [STATES.SPEAKING]: 'Falando…',
    [STATES.ERROR]: 'Erro',
  };

  // ----------------------------
  // Overlay Voice Mode (UI Central Ball)
  // ----------------------------
  let overlay = document.getElementById('voice-mode-overlay');
  let overlayVmBall = null;
  let overlayVmState = null;
  let overlayVmHint = null;
  let overlayVmTranscript = null;
  let overlayVmTimer = null;
  let overlayVmClose = null;
  function __ensureOverlayUI() {
    overlay = document.getElementById('voice-mode-overlay');
    if (!overlay) {
      try {
        const el = document.createElement('div');
        el.id = 'voice-mode-overlay';
        el.innerHTML = `
          <button type="button" id="vm-close-btn" class="vm-close" aria-label="Fechar Voice Mode" title="Fechar Voice Mode">✕</button>
          <div class="vm-inner">
            <div class="vm-title">Voice Mode</div>
            <div class="vm-ball-wrap" aria-hidden="true">
              <span class="vm-wave"></span><span class="vm-wave"></span><span class="vm-wave"></span>
              <div class="vm-ball" id="vm-ball"><div class="vm-ball-ring"></div><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg></div>
            </div>
            <div class="vm-state" id="vm-state">Ouvindo…</div>
            <div class="vm-hint" id="vm-hint">Fale com seu agente — detectamos o início e o fim automaticamente.</div>
            <div class="vm-transcript" id="vm-transcript" aria-live="polite"></div>
            <div class="vm-timer" id="vm-timer">00:00</div>
          </div>`;
        document.body.appendChild(el);
        overlay = el;
      } catch { overlay = null; }
    }
    if (overlay) {
      overlayVmBall = overlay.querySelector('#vm-ball') || null;
      overlayVmState = overlay.querySelector('#vm-state') || null;
      overlayVmHint = overlay.querySelector('#vm-hint') || null;
      overlayVmTranscript = overlay.querySelector('#vm-transcript') || null;
      overlayVmTimer = overlay.querySelector('#vm-timer') || null;
      overlayVmClose = overlay.querySelector('#vm-close-btn') || null;
      if (overlayVmClose && !overlayVmClose.dataset.__vm_bound) {
        overlayVmClose.dataset.__vm_bound = '1';
        overlayVmClose.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); endConversation(); });
      }
    }
  }
  __ensureOverlayUI();

  function openOverlayUI() {
    __ensureOverlayUI();
    if (!overlay) return;
    overlay.classList.add('vm--open');
    overlay.setAttribute('aria-hidden', 'false');
    try { document.body.style.overflow = 'hidden'; } catch {}
  }
  function closeOverlayUI() {
    if (!overlay) return;
    overlay.classList.remove('vm--open', 'vm--listening', 'vm--processing', 'vm--speaking', 'vm--error');
    overlay.setAttribute('aria-hidden', 'true');
    try { document.body.style.overflow = ''; } catch {}
  }
  function setOverlayState(st, opts) {
    opts = opts || {};
    if (!overlay) __ensureOverlayUI();
    if (!overlay) return;
    overlay.classList.remove('vm--listening', 'vm--processing', 'vm--speaking', 'vm--error');
    if (st === STATES.LISTENING) overlay.classList.add('vm--listening');
    else if (st === STATES.PROCESSING) overlay.classList.add('vm--processing');
    else if (st === STATES.SPEAKING) overlay.classList.add('vm--speaking');
    else if (st === STATES.ERROR) overlay.classList.add('vm--error');
    if (overlayVmState) overlayVmState.textContent = opts.stateText || STATE_LABEL[st] || '';
    if (overlayVmHint) overlayVmHint.textContent = opts.hint || (
      st === STATES.LISTENING ? 'Fale com seu agente — detectamos o início e o fim automaticamente.' :
      st === STATES.PROCESSING ? 'Transcrevendo e processando… aguarde.' :
      st === STATES.SPEAKING ? 'Agente respondendo em áudio.' :
      st === STATES.ERROR ? (opts.text || 'Ocorreu um erro. Tente novamente.') :
      'Voice Mode — conversa contínua por voz.'
    );
    if (overlayVmTranscript && typeof opts.transcript === 'string') overlayVmTranscript.textContent = opts.transcript;
    if (overlayVmTimer && typeof opts.timerText === 'string') overlayVmTimer.textContent = opts.timerText;
    if (overlayVmBall && typeof opts.vmAmp === 'number') { try { overlayVmBall.style.setProperty('--vm-amp', String(opts.vmAmp)); } catch {} }
  }
  function setOverlayAmp(amp) {
    if (!overlayVmBall) return;
    try { overlayVmBall.style.setProperty('--vm-amp', String(Math.max(0, Math.min(1, amp)))); } catch {}
  }
  function openOverlayIfActive() {
    if (CV.conversationActive) openOverlayUI();
  }

  const _oldBtn = document.getElementById('voice-mic-btn');
  // Remove TODOS os listeners anteriores (clone and replace) evitando conflito
  // com voice_recorder.js (modo clique-clique antigo). Os IDs internos são preservados.
  let btn = _oldBtn;
  if (_oldBtn && _oldBtn.parentNode) {
    try {
      const fresh = _oldBtn.cloneNode(true);
      _oldBtn.parentNode.replaceChild(fresh, _oldBtn);
      btn = fresh;
    } catch {}
  }
  const svg = btn ? btn.querySelector('#voice-mic-svg') || document.getElementById('voice-mic-svg') : null;
  const dot = btn ? btn.querySelector('#voice-mic-dot') || document.getElementById('voice-mic-dot') : null;
  const statusBar = document.getElementById('voice-status-bar');
  const statusIcon = document.getElementById('voice-status-icon');
  const statusText = document.getElementById('voice-status-text');
  const statusTimer = document.getElementById('voice-status-timer');
  const input = document.getElementById('trae-message-input');
  const chatForm = document.getElementById('trae-chat-form');
  const sendBtn = document.getElementById('trae-play-btn');

  if (!btn) return;

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  function showToast(icon, text, kind) {
    try {
      const t = document.getElementById('toast');
      const tic = document.getElementById('toast-icon');
      const ttxt = document.getElementById('toast-text');
      if (!t || !ttxt) return;
      tic.textContent = icon || '✓';
      ttxt.textContent = text || '';
      if (kind === 'error') tic.className = 'text-red-400 text-sm leading-none';
      else if (kind === 'warn') tic.className = 'text-amber-400 text-sm leading-none';
      else tic.className = 'text-emerald-400 text-sm leading-none';
      t.classList.remove('hidden');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => t.classList.add('hidden'), 3800);
    } catch {}
  }

  function b64toBlob(b64, mime) {
    const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
    const byteCh = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let bytes = [];
    for (let i = 0; i < clean.length; i += 4) {
      const c1 = byteCh.indexOf(clean[i] || '=');
      const c2 = byteCh.indexOf(clean[i+1] || '=');
      const c3 = byteCh.indexOf(clean[i+2] || '=');
      const c4 = byteCh.indexOf(clean[i+3] || '=');
      const b1 = (c1 << 2) | (c2 >> 4);
      const b2 = ((c2 & 15) << 4) | (c3 >> 2);
      const b3 = ((c3 & 3) << 6) | c4;
      if (c3 !== 64) bytes.push(b1, b2); else bytes.push(b1);
      if (c4 !== 64) bytes.push(b3);
    }
    return new Blob([new Uint8Array(bytes)], { type: mime || 'audio/mpeg' });
  }

  function stripMdForSpeak(txt) {
    let t = String(txt || '').trim();
    t = t.replace(/```[\s\S]*?```/g, ' (código omitido) ');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    t = t.replace(/\*([^*]+)\*/g, '$1');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    t = t.replace(/^#+\s+/gm, '');
    t = t.replace(/[\s]+/g, ' ').trim();
    return t.slice(0, 1800);
  }

  const CV = {
    state: STATES.IDLE,
    mediaStream: null,
    audioCtx: null,
    analyser: null,
    micSource: null,
    recorder: null,
    recorderChunks: [],
    mime: 'audio/webm;codecs=opus',
    startTime: 0,
    timerInt: null,
    vadInt: null,

    speechStartTs: 0,
    speechEndedPending: 0,
    lastVadRms: 0,
    vadRmsThreshold: 0.014,
    vadNoiseFloor: 0.008,
    vadTailMs: 900,
    vadMinSpeechMs: 480,
    vadSilenceSince: 0,

    ttsAudio: null,
    ttsInterruptCtx: null,
    ttsInterruptNodes: null,
    ttsInterruptBuffer: null,
    ttsInterruptSrc: null,
    ttsInterruptRunning: false,
    _stoppingTts: false,

    conversationActive: false,
  };

  function setStateUI(st, opts) {
    opts = opts || {};
    CV.state = st;
    btn.dataset.state = st;
    btn.title = STATE_LABEL[st] || '';
    btn.setAttribute('aria-label', STATE_LABEL[st] || '');

    for (const k of Object.values(STATES)) btn.classList.remove('st--' + k);
    btn.classList.add('st--' + st);

    // Mantém o dot visível em caso de erro/latência por poucos segundos quando escutando
    if (dot) {
      if (st === STATES.LISTENING || st === STATES.PROCESSING) dot.classList.remove('hidden');
      else dot.classList.add('hidden');
    }

    // Remover antigos overlays caso existam (segurança)
    for (let i = 3; i <= 6; i++) {
      const el = btn.querySelector(`:scope > [data-overlay="${i}"]`);
      if (el && (st !== STATES.LISTENING || i !== 4)) el.remove();
    }
    if (st === STATES.LISTENING) {
      for (let i = 3; i <= 4; i++) {
        const el = document.createElement('span');
        el.setAttribute('data-overlay', String(i));
        el.className = 'voice-wave';
        btn.appendChild(el);
      }
    }

    // Status bar
    if (!statusBar) return;
    if (st === STATES.IDLE) { statusBar.classList.add('hidden'); return; }
    statusBar.classList.remove('hidden');
    const map = {
      [STATES.LISTENING]:  { icon: '🎙️', cls: 'text-emerald-400 animate-pulse',      textCls: 'text-emerald-200', timerCls: 'text-emerald-300/80', bar: 'border-emerald-500/20 bg-emerald-500/10' },
      [STATES.PROCESSING]: { icon: '⏳',  cls: 'text-brand-400 animate-pulse',        textCls: 'text-brand-200',   timerCls: 'text-brand-300/80',   bar: 'border-brand-500/25 bg-brand-500/10' },
      [STATES.SPEAKING]:   { icon: '🔊', cls: 'text-sky-400',                         textCls: 'text-sky-200',     timerCls: 'text-sky-300/80',     bar: 'border-sky-500/25 bg-sky-500/10' },
      [STATES.ERROR]:      { icon: '⚠️', cls: 'text-red-400',                         textCls: 'text-red-200',     timerCls: 'text-red-300/80',     bar: 'border-red-500/25 bg-red-500/10' },
    };
    const m = map[st] || map[STATES.ERROR];
    statusBar.className = 'mt-2 px-2 py-1.5 rounded-md text-[10.5px] flex items-center gap-2 transition border ' + m.bar;
    statusIcon.className = m.cls;
    statusIcon.textContent = m.icon;
    statusText.className = 'font-medium truncate flex-1 ' + m.textCls;
    statusText.textContent = opts.text || STATE_LABEL[st] || '';
    if (statusTimer) {
      statusTimer.className = 'tabular-nums font-semibold shrink-0 ' + m.timerCls;
      const txt = typeof opts.timerMs === 'number' ? fmt(opts.timerMs) : (opts.timerText || '');
      statusTimer.textContent = txt;
      try { setOverlayState(st, Object.assign({}, opts, { timerText: txt })); } catch {}
    } else {
      try { setOverlayState(st, opts); } catch {}
    }
  }

  function startTimer() {
    stopTimer();
    CV.startTime = Date.now();
    CV.timerInt = setInterval(() => {
      if (statusTimer) statusTimer.textContent = fmt(Date.now() - CV.startTime);
    }, 200);
  }
  function stopTimer() {
    if (CV.timerInt) { clearInterval(CV.timerInt); CV.timerInt = null; }
  }

  function stopStream() {
    if (CV.vadInt) { clearInterval(CV.vadInt); CV.vadInt = null; }
    stopTimer();
    if (CV.recorder) {
      try { if (CV.recorder.state !== 'inactive') CV.recorder.stop(); } catch {}
      CV.recorder = null;
    }
    if (CV.mediaStream) {
      try { CV.mediaStream.getTracks().forEach(t => t.stop()); } catch {}
      CV.mediaStream = null;
    }
    if (CV.micSource) { try { CV.micSource.disconnect(); } catch {} CV.micSource = null; }
    if (CV.analyser) { try { CV.analyser.disconnect(); } catch {} CV.analyser = null; }
    if (CV.audioCtx) { try { if (CV.audioCtx.state !== 'closed') CV.audioCtx.close(); } catch {} CV.audioCtx = null; }
  }

  function initAudioContext(stream) {
    try {
      const AC = (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      CV.audioCtx = new AC();
      CV.analyser = CV.audioCtx.createAnalyser();
      CV.analyser.fftSize = 1024;
      CV.analyser.smoothingTimeConstant = 0.35;
      CV.micSource = CV.audioCtx.createMediaStreamSource(stream);
      CV.micSource.connect(CV.analyser);
      return true;
    } catch (e) { return false; }
  }

  function _rms() {
    if (!CV.analyser) return 0;
    const buf = new Float32Array(CV.analyser.fftSize);
    CV.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  function _vadTick() {
    const rms = _rms();
    CV.lastVadRms = rms;
    const now = Date.now();

    // Botão listening amplitude visual (opcional via CSS var) + Overlay amplitude visual
    try {
      const amp = Math.min(1, Math.max(0, (rms - CV.vadNoiseFloor) * 22));
      btn.style.setProperty('--voice-amp', amp.toFixed(3));
      setOverlayAmp(amp);
    } catch {}

    // Maquina de estados VAD: detecta fala contínua + silêncio final
    if (!CV.speechStartTs) {
      if (rms > CV.vadRmsThreshold) CV.speechStartTs = now;
      CV.vadSilenceSince = 0;
    } else {
      // está falando
      if (rms > CV.vadRmsThreshold * 0.85) {
        CV.vadSilenceSince = 0;
      } else {
        if (!CV.vadSilenceSince) CV.vadSilenceSince = now;
        const silMs = now - CV.vadSilenceSince;
        const speechMs = now - CV.speechStartTs;
        if (silMs >= CV.vadTailMs && speechMs >= CV.vadMinSpeechMs) {
          // Fim de fala detectado
          CV.speechStartTs = 0;
          CV.vadSilenceSince = 0;
          stopRecordingByVad('silence_end');
        }
      }
    }

    // Interrupção: se usuário fala enquanto IA está falando → corta + volta a escutar
    if (CV.state === STATES.SPEAKING && rms > (CV.vadRmsThreshold * 1.4)) {
      const d = now - (CV._lastInterruptGuardTs || 0);
      if (d > 900) {
        CV._lastInterruptGuardTs = now;
        handleInterrupt('user_spoken_over');
      }
    }
  }

  function handleInterrupt(reason) {
    if (!CV.conversationActive) return;
    if (CV.state !== STATES.SPEAKING) return;
    stopTts(true);
    setTimeout(() => startListening({ onInterrupt: true }), 60);
  }

  async function requestMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      setStateUI(STATES.ERROR, { text: 'Navegador sem suporte a gravação (Chrome/Edge/Safari).' });
      setTimeout(() => setStateUI(STATES.IDLE), 6000);
      showToast('⚠️', 'Navegador sem suporte a gravação.', 'warn');
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
      });
      return stream;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      setStateUI(STATES.ERROR, { text: 'Permissão de microfone negada: ' + msg.slice(0, 90) });
      setTimeout(() => setStateUI(STATES.IDLE), 8000);
      showToast('⚠️', 'Permissão de microfone negada.', 'error');
      return null;
    }
  }

  async function startListening() {
    if (CV.state === STATES.LISTENING) return;
    stopTts(true);

    let stream = CV.mediaStream;
    if (!stream) stream = await requestMic();
    if (!stream) return;
    CV.mediaStream = stream;

    // AudioContext para VAD (se recriar sem contexto válido)
    if (!CV.audioCtx || CV.audioCtx.state === 'closed') {
      const ok = initAudioContext(stream);
      if (!ok) {
        setStateUI(STATES.ERROR, { text: 'Não foi possível inicializar análise de áudio.' });
        return;
      }
    } else {
      try { if (CV.audioCtx.state === 'suspended') await CV.audioCtx.resume(); } catch {}
    }

    // MediaRecorder para upload
    CV.recorderChunks = [];
    let mime = CV.mime;
    if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(mime)) {
      mime = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mime)) mime = '';
    }
    const opts = mime ? { mimeType: mime } : undefined;
    try {
      const rec = new MediaRecorder(stream, opts);
      CV.mime = rec.mimeType || mime || CV.mime;
      CV.recorder = rec;
      rec.ondataavailable = (e) => { if (e && e.data && e.data.size > 0) CV.recorderChunks.push(e.data); };
      rec.onerror = (e) => {
        try {
          setStateUI(STATES.ERROR, { text: 'MediaRecorder erro: ' + ((e && e.error && e.error.message) || 'internal').slice(0, 110) });
          stopStream();
          setTimeout(() => { if (CV.conversationActive) startListening(); else setStateUI(STATES.IDLE); }, 2200);
        } catch {}
      };
      try { rec.start(200); } catch (e) { rec.start(); }
    } catch (e) {
      setStateUI(STATES.ERROR, { text: 'MediaRecorder falhou: ' + String(e.message || e).slice(0,100) });
      stopStream();
      return;
    }

    // Reset VAD
    CV.speechStartTs = 0;
    CV.vadSilenceSince = 0;
    CV.vadRmsThreshold = 0.014;
    CV.vadNoiseFloor = 0.008;

    setStateUI(STATES.LISTENING, { text: 'Escutando… fale agora (detecta o fim automaticamente).' });
    startTimer();

    // Calibra noise floor por 0,7s e inicia VAD tick 30fps
    const calStart = Date.now();
    let calCount = 0; let calSum = 0;
    CV.vadInt = setInterval(() => {
      const r = _rms();
      if (Date.now() - calStart < 700) { calCount++; calSum += r; }
      else if (!CV._vadCalDone) {
        CV._vadCalDone = true;
        const avg = calCount ? calSum / calCount : 0.008;
        CV.vadNoiseFloor = Math.max(0.005, Math.min(0.022, avg));
        CV.vadRmsThreshold = Math.max(0.010, CV.vadNoiseFloor * 1.7 + 0.004);
      }
      _vadTick();
    }, 33);
    CV._vadCalDone = false;
  }

  function stopRecordingByVad(reason) {
    if (CV.state !== STATES.LISTENING) return;
    stopStream();
    const durMs = CV.startTime ? Date.now() - CV.startTime : 0;
    if (!CV.recorderChunks.length || durMs < CV.vadMinSpeechMs) {
      // Curta demais ou vazio → volta a escutar se conversa ativa
      CV.recorderChunks = [];
      if (CV.conversationActive) {
        setTimeout(() => startListening(), 150);
      } else {
        setStateUI(STATES.IDLE);
      }
      return;
    }
    const blobType = CV.mime || 'audio/webm';
    const audioBlob = new Blob(CV.recorderChunks, { type: blobType });
    CV.recorderChunks = [];
    processTurn(audioBlob, durMs);
  }

  function stopRecordingManual() {
    if (CV.state !== STATES.LISTENING) return;
    CV._userStoppedManual = true;
    stopStream();
    const durMs = CV.startTime ? Date.now() - CV.startTime : 0;
    if (!CV.recorderChunks.length || durMs < 400) {
      CV.recorderChunks = [];
      endConversation();
      return;
    }
    const blobType = CV.mime || 'audio/webm';
    const audioBlob = new Blob(CV.recorderChunks, { type: blobType });
    CV.recorderChunks = [];
    CV.conversationActive = false;
    processTurn(audioBlob, durMs);
  }

  async function processTurn(audioBlob, durMs) {
    setStateUI(STATES.PROCESSING, { text: 'Transcrevendo e processando…', timerMs: durMs });
    try {
      const fd = new FormData();
      fd.append('audio', audioBlob, 'voice_command_' + Date.now() + (audioBlob.type.includes('ogg') ? '.ogg' : (audioBlob.type.includes('mp4') ? '.mp4' : '.webm')));
      fd.append('durationMs', String(durMs | 0));
      fd.append('mimeType', audioBlob.type || 'audio/webm');
      fd.append('returnTranscriptOnly', 'true');
      fd.append('source', 'web_ui_conversation');
      const resp = await fetch(VOICE_REST_BASE + '/api/voice/process', { method: 'POST', body: fd });
      const txt = await resp.text();
      let data = null;
      try { data = JSON.parse(txt); } catch { data = { ok: false, raw: txt }; }
      if (!(resp.ok && data && (data.ok || (data.criacao && data.criacao.ok)))) {
        setStateUI(STATES.ERROR, { text: 'Falha processamento voz: ' + String((data && (data.error || data.message)) || txt || 'HTTP ' + resp.status).slice(0,120), timerMs: durMs });
        setTimeout(() => { if (CV.conversationActive) startListening(); else setStateUI(STATES.IDLE); }, 2200);
        return;
      }
      const transcript = String(data.transcript || data.transcricao || data.textoTranscrito || data.stt?.texto || '').trim();
      if (!transcript) {
        setStateUI(STATES.ERROR, { text: 'Transcrição vazia. Tente falar novamente.', timerMs: durMs });
        setTimeout(() => { if (CV.conversationActive) startListening(); else setStateUI(STATES.IDLE); }, 1600);
        return;
      }

      // Insere no input (texto visível)
      if (input) {
        const prev = String(input.value || '').trim();
        input.value = prev ? prev + '\n' + transcript : transcript;
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      }
      showToast('🎙️', 'Transcrição: ' + (transcript.length > 80 ? transcript.slice(0,77)+'…' : transcript), 'ok');

      // Executa agente (envia form como se fosse "play")
      const respostaTexto = await runAgentAndGetAnswer(transcript);
      // Fala a resposta
      if (CV.conversationActive && respostaTexto) {
        await speakResponse(respostaTexto);
      } else {
        // Caso o usuário tenha parado manualmente, não retorna a escutar.
        if (!CV.conversationActive) setStateUI(STATES.IDLE);
      }
    } catch (e) {
      setStateUI(STATES.ERROR, { text: 'Rede: ' + String(e.message || e).slice(0, 140), timerMs: durMs });
      setTimeout(() => { if (CV.conversationActive) startListening(); else setStateUI(STATES.IDLE); }, 2600);
    }
  }

  function runAgentAndGetAnswer(promptText) {
    return new Promise((resolve) => {
      let ws = null;
      try {
        const w = window;
        if (w.__ti_voice_ws && w.__ti_voice_ws.readyState === 1) ws = w.__ti_voice_ws;
        else if (typeof w._ti_getWs === 'function') ws = w._ti_getWs();
        else if (w._ws && w._ws.readyState === 1) ws = w._ws;
        else if (document && document.body) ws = document.body.__ws || null;
      } catch {}
      const fallbackAnswer = promptText ? 'Entendido. Processando solicitação: ' + promptText : '';
      const timeLimit = setTimeout(() => resolve(fallbackAnswer), 26000);

      // Resposta completa = concatena message:ai:delta até agent:done
      let acumulado = '';
      let onDelta = null; let onDone = null; let onMsgAI = null;
      const done = (text) => {
        clearTimeout(timeLimit);
        window.removeEventListener('ti:voice:delta', onDelta);
        window.removeEventListener('ti:voice:done', onDone);
        window.removeEventListener('ti:voice:message', onMsgAI);
        resolve(text && text.length ? text : fallbackAnswer);
      };
      onDelta = (ev) => { if (ev && ev.detail && typeof ev.detail.text === 'string' && !ev.detail.done) acumulado += ev.detail.text; };
      onMsgAI = (ev) => { if (ev && ev.detail && typeof ev.detail.full === 'string') acumulado = ev.detail.full; };
      onDone = (ev) => {
        const t = (ev && ev.detail && typeof ev.detail.text === 'string') ? ev.detail.text : acumulado;
        done(t);
      };
      window.addEventListener('ti:voice:delta', onDelta);
      window.addEventListener('ti:voice:done', onDone);
      window.addEventListener('ti:voice:message', onMsgAI);

      // Dispara execução: 1) submit form  2) envia WS diretamente se tiver ws
      let submitOk = false;
      try {
        if (chatForm && typeof chatForm.requestSubmit === 'function') { chatForm.requestSubmit(); submitOk = true; }
        else if (chatForm) {
          const ev = new Event('submit', { cancelable: true, bubbles: true });
          if (!chatForm.dispatchEvent(ev)) {}
          else chatForm.submit();
          submitOk = true;
        }
      } catch {}
      try {
        if (ws && ws.readyState === 1 && window.__ti_voice_send && typeof window.__ti_voice_send === 'function') {
          window.__ti_voice_send({ type: 'chat:send', text: promptText });
        } else if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'chat:send', text: promptText }));
        }
      } catch {}
      if (!submitOk && !ws) {
        done(fallbackAnswer);
      }
    });
  }

  async function speakResponse(text) {
    const toSpeak = stripMdForSpeak(text);
    if (!toSpeak) { setTimeout(() => { if (CV.conversationActive) startListening(); }, 300); return; }
    setStateUI(STATES.SPEAKING, { text: 'Respondendo: ' + (toSpeak.slice(0, 70).trim() + (toSpeak.length > 70 ? '…' : '')) });
    let blob = null;
    try {
      const resp = await fetch(VOICE_REST_BASE + '/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: toSpeak, voice: 'pt-BR-Neural2-A' }),
      });
      const json = await resp.json();
      if (resp.ok && json && json.ok && (json.audioBase64 || json.mp3Base64 || json.base64)) {
        const b64 = json.audioBase64 || json.mp3Base64 || json.base64;
        blob = b64toBlob(b64, json.mimeType || 'audio/mpeg');
      } else {
        throw new Error(json && json.error ? json.error : 'TTS falhou');
      }
    } catch (e) {
      // Fallback SpeechSynthesis (se o servidor não responder, ainda fala)
      try {
        if ('speechSynthesis' in window && window.SpeechSynthesisUtterance) {
          stopTts(true);
          const u = new SpeechSynthesisUtterance(toSpeak);
          u.lang = 'pt-BR';
          u.rate = 1.05;
          u.onend = () => { if (CV.conversationActive && CV.state === STATES.SPEAKING) startListening(); };
          u.onerror = () => { if (CV.conversationActive && CV.state === STATES.SPEAKING) startListening(); };
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
          CV._ttsUsingSpeechSynthesis = true;
          return;
        }
      } catch {}
      setStateUI(STATES.ERROR, { text: 'TTS falhou: ' + String(e.message || e).slice(0,120) });
      setTimeout(() => { if (CV.conversationActive) startListening(); }, 2200);
      return;
    }
    CV._ttsUsingSpeechSynthesis = false;
    await playTtsBlob(blob);
  }

  function playTtsBlob(blob) {
    return new Promise((resolve) => {
      try {
        if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch {} }
      } catch {}
      stopTts(false);
      CV._stoppingTts = false;
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.preload = 'auto';
      a.autoplay = true;
      a.volume = 1.0;
      CV.ttsAudio = a;
      const finish = (resumeListening) => {
        try { if (url) URL.revokeObjectURL(url); } catch {}
        a.onended = null; a.onerror = null; a.onplaying = null; a.pause();
        CV.ttsAudio = null;
        if (CV._stoppingTts) return resolve({ interrupted: true });
        if (CV.conversationActive && resumeListening) {
          setTimeout(() => startListening(), 220);
        } else if (!CV.conversationActive) {
          setStateUI(STATES.IDLE);
        }
        resolve({ interrupted: false });
      };
      a.onended = () => finish(true);
      a.onerror = () => finish(true);
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => finish(true));
    });
  }

  function stopTts(resetStateToIdleIfNotActive) {
    CV._stoppingTts = true;
    try {
      if (CV.ttsAudio) {
        try { CV.ttsAudio.pause(); } catch {}
        try { if (CV.ttsAudio.src) URL.revokeObjectURL(CV.ttsAudio.src); } catch {}
        CV.ttsAudio = null;
      }
    } catch {}
    try {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    } catch {}
    CV._ttsUsingSpeechSynthesis = false;
  }

  function startConversation() {
    CV.conversationActive = true;
    CV._userStoppedManual = false;
    openOverlayUI();
    startListening();
  }

  function endConversation() {
    CV.conversationActive = false;
    stopTts(true);
    stopStream();
    closeOverlayUI();
    try { setOverlayState(STATES.IDLE, {}); } catch {}
    setStateUI(STATES.IDLE);
  }

  function toggleConversation() {
    if (CV.state === STATES.IDLE) {
      startConversation();
    } else if (CV.state === STATES.LISTENING) {
      // Usuário clicou enquanto escutando: para a gravação manual e finaliza a conversa.
      stopRecordingManual();
    } else if (CV.state === STATES.PROCESSING) {
      // Cancela tudo
      endConversation();
    } else if (CV.state === STATES.SPEAKING) {
      // Clique no ícone enquanto falando = para resposta e volta a escutar (mesmo comportamento interrupção mas direto)
      stopTts(true);
      if (CV.conversationActive) setTimeout(() => startListening(), 60);
      else setStateUI(STATES.IDLE);
    } else if (CV.state === STATES.ERROR) {
      if (CV.conversationActive) setTimeout(() => startListening(), 10);
      else setStateUI(STATES.IDLE);
    }
  }

  // Ligação no botão
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleConversation();
  });

  // Atalho Ctrl+M (mantém comportamento) / ESC
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleConversation();
    }
    if (e.key === 'Escape') {
      if (CV.state !== STATES.IDLE) {
        e.preventDefault();
        endConversation();
      }
    }
  });

  // Hooks para app.js disparar eventos de resposta (emissor em app.js também atualizado com 2 linhas)
  window.__ti_voice_emitDelta = function (text, done, usage) {
    try { window.dispatchEvent(new CustomEvent('ti:voice:delta', { detail: { text, done: !!done, usage } })); } catch {}
  };
  window.__ti_voice_emitDone = function (text, reason) {
    try { window.dispatchEvent(new CustomEvent('ti:voice:done', { detail: { text, reason } })); } catch {}
  };
  window.__ti_voice_emitMessage = function (fullText) {
    try { window.dispatchEvent(new CustomEvent('ti:voice:message', { detail: { full: fullText } })); } catch {}
  };

  // Estado inicial
  setStateUI(STATES.IDLE);
})();
