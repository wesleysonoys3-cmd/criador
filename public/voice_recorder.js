(function () {
  // RC22.4 · Se o novo módulo de conversa contínua (voice_conversation.js) estiver carregado → no-op.
  // O voice_recorder.js serve como fallback legado "clique-clique" caso conversation não exista.
  if (window.__TI_USE_VOICE_CONVERSATION__) return;

  const VOICE_REST_BASE =
    (window.__TI_CONFIG__ && typeof window.__TI_CONFIG__.VOICE_REST_URL === 'string' && String(window.__TI_CONFIG__.VOICE_REST_URL).replace(/\/+$/, '')) ||
    (window.VOICE_REST_URL && String(window.VOICE_REST_URL).replace(/\/+$/, '')) ||
    'http://127.0.0.1:3005';

  const btn = document.getElementById('voice-mic-btn');
  const svg = document.getElementById('voice-mic-svg');
  const dot = document.getElementById('voice-mic-dot');
  const statusBar = document.getElementById('voice-status-bar');
  const statusIcon = document.getElementById('voice-status-icon');
  const statusText = document.getElementById('voice-status-text');
  const statusTimer = document.getElementById('voice-status-timer');
  const input = document.getElementById('trae-message-input');
  const chatForm = document.getElementById('trae-chat-form');

  if (!btn) return;

  let state = {
    recording: false,
    mediaStream: null,
    recorder: null,
    chunks: [],
    startTime: 0,
    timerInt: null,
    mime: 'audio/webm;codecs=opus',
  };

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  function setStatus(kind, text, timerMs) {
    if (!statusBar) return;
    if (kind === 'hidden') {
      statusBar.classList.add('hidden');
      return;
    }
    statusBar.classList.remove('hidden');
    const map = {
      recording: { icon: '🎙️', cls: 'text-amber-400', textCls: 'text-amber-200', timerCls: 'text-amber-300/80', bar: 'border-amber-500/20 bg-amber-500/10' },
      processing: { icon: '⏳', cls: 'text-brand-400 animate-pulse', textCls: 'text-brand-200', timerCls: 'text-brand-300/80', bar: 'border-brand-500/25 bg-brand-500/10' },
      success: { icon: '✅', cls: 'text-emerald-400', textCls: 'text-emerald-200', timerCls: 'text-emerald-300/80', bar: 'border-emerald-500/20 bg-emerald-500/10' },
      error: { icon: '⚠️', cls: 'text-red-400', textCls: 'text-red-200', timerCls: 'text-red-300/80', bar: 'border-red-500/25 bg-red-500/10' },
    };
    const m = map[kind] || map.error;
    statusBar.className = 'mt-2 px-2 py-1.5 rounded-md text-[10.5px] flex items-center gap-2 transition border ' + m.bar;
    statusIcon.className = m.cls;
    statusIcon.textContent = m.icon;
    statusText.className = 'font-medium truncate flex-1 ' + m.textCls;
    statusText.textContent = text || '';
    if (statusTimer) {
      statusTimer.className = 'tabular-nums font-semibold shrink-0 ' + m.timerCls;
      statusTimer.textContent = typeof timerMs === 'number' ? fmt(timerMs) : '';
    }
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

  function setRecordingUi(on) {
    state.recording = !!on;
    if (on) {
      btn.classList.add('bg-red-500/15', 'text-red-400', 'border', 'border-red-500/30');
      btn.classList.remove('text-slate-400', 'hover:text-white');
      if (dot) dot.classList.remove('hidden');
      btn.title = 'Parar gravação e enviar para processamento';
    } else {
      btn.classList.remove('bg-red-500/15', 'text-red-400', 'border', 'border-red-500/30');
      btn.classList.add('text-slate-400', 'hover:text-white');
      if (dot) dot.classList.add('hidden');
      btn.title = 'Gravar comando de voz (clicar para iniciar / parar)';
    }
  }

  function stopStream() {
    if (state.mediaStream) {
      try { state.mediaStream.getTracks().forEach(t => t.stop()); } catch {}
      state.mediaStream = null;
    }
    if (state.timerInt) {
      clearInterval(state.timerInt);
      state.timerInt = null;
    }
  }

  async function startRecording() {
    if (state.recording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      setStatus('error', 'Seu navegador não suporta gravação de áudio (MediaRecorder). Tente Chrome/Edge/Safari recente.');
      setTimeout(() => setStatus('hidden'), 6000);
      showToast('⚠️', 'Navegador sem suporte a gravação.', 'warn');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      state.mediaStream = stream;
      let mime = state.mime;
      if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(mime)) {
        mime = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mime)) mime = '';
      }
      state.chunks = [];
      const opts = mime ? { mimeType: mime } : undefined;
      const rec = new MediaRecorder(stream, opts);
      state.mime = rec.mimeType || mime || state.mime;
      state.recorder = rec;
      rec.ondataavailable = (e) => { if (e && e.data && e.data.size > 0) state.chunks.push(e.data); };
      rec.onstop = onRecordingFinished;
      state.startTime = Date.now();
      rec.start(250);
      setRecordingUi(true);
      setStatus('recording', 'Gravando… fale agora (clique no microfone para parar).', 0);
      state.timerInt = setInterval(() => {
        if (statusTimer) statusTimer.textContent = fmt(Date.now() - state.startTime);
      }, 250);
    } catch (e) {
      stopStream();
      setRecordingUi(false);
      const msg = String(e && e.message ? e.message : e);
      setStatus('error', 'Erro ao acessar microfone: ' + msg.slice(0, 120) + '. Dê permissão de microfone no navegador.');
      setTimeout(() => setStatus('hidden'), 8000);
      showToast('⚠️', 'Permissão de microfone negada.', 'error');
    }
  }

  function stopRecording() {
    if (!state.recording || !state.recorder) return;
    try {
      if (state.recorder.state !== 'inactive') state.recorder.stop();
    } catch (e) {
      onRecordingFinished(e);
    }
  }

  async function onRecordingFinished(_err) {
    setRecordingUi(false);
    stopStream();
    const durMs = state.startTime ? Date.now() - state.startTime : 0;
    if (_err || !state.chunks.length || durMs < 400) {
      if (durMs < 400 && !_err) {
        setStatus('error', 'Gravação muito curta (< 0,4s). Tente novamente.');
        setTimeout(() => setStatus('hidden'), 4000);
      } else if (_err) {
        setStatus('error', 'Erro na gravação: ' + String(_err.message || _err).slice(0, 120));
        setTimeout(() => setStatus('hidden'), 6000);
      }
      state.chunks = [];
      return;
    }
    const blobType = state.mime || 'audio/webm';
    const audioBlob = new Blob(state.chunks, { type: blobType });
    state.chunks = [];
    await uploadAudioForProcessing(audioBlob, durMs);
  }

  async function uploadAudioForProcessing(blob, durMs) {
    setStatus('processing', 'Processando voz… transcrevendo e gerando agente/automação.', durMs);
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice_command_' + Date.now() + (blob.type.includes('ogg') ? '.ogg' : (blob.type.includes('mp4') ? '.mp4' : '.webm')));
      fd.append('durationMs', String(durMs | 0));
      fd.append('mimeType', blob.type || 'audio/webm');
      fd.append('returnTranscriptOnly', 'true');
      fd.append('source', 'web_ui_mic');
      const resp = await fetch(VOICE_REST_BASE + '/api/voice/process', {
        method: 'POST',
        body: fd,
      });
      const txt = await resp.text();
      let data = null;
      try { data = JSON.parse(txt); } catch { data = { ok: false, raw: txt }; }
      if (resp.ok && data && (data.ok || (data.criacao && data.criacao.ok))) {
        const transcript = String(data.transcript || data.transcricao || data.textoTranscrito || data.stt?.texto || '').trim();
        if (transcript) {
          if (input) {
            const prev = String(input.value || '').trim();
            input.value = prev ? prev + '\n' + transcript : transcript;
            try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
          }
          const slug = (data.criacao && data.criacao.projectSlug) ? data.criacao.projectSlug : null;
          const msg = transcript.length > 80 ? transcript.slice(0, 77) + '…' : transcript;
          setStatus('success', slug
            ? `✅ Voz processada · agente criado: ${slug}. Transcrição: ${msg}`
            : `✅ Transcrição ok: ${msg}`, durMs);
          showToast('✅', slug ? ('Agente criado: ' + slug) : 'Transcrição inserida no campo.', 'ok');
          if (chatForm && data && data.ok && data.criacao && data.criacao.ok) {
            // Não submete o form automaticamente — build já foi disparado via voice_processor.
          }
        } else {
          setStatus('error', 'Sem transcrição retornada: ' + String(data.error || data.message || 'vazio').slice(0, 100), durMs);
          showToast('⚠️', 'Transcrição vazia.', 'warn');
        }
      } else {
        const errMsg = String((data && (data.error || data.message)) || txt || 'HTTP ' + resp.status).slice(0, 150);
        setStatus('error', 'Erro processamento: ' + errMsg, durMs);
        showToast('⚠️', 'Processamento de voz falhou.', 'error');
      }
    } catch (e) {
      const errMsg = String(e && e.message ? e.message : e).slice(0, 160);
      setStatus('error', 'Falha de rede ao enviar áudio: ' + errMsg, durMs);
      showToast('⚠️', 'Rede / servidor de voz indisponível.', 'error');
    }
    setTimeout(() => setStatus('hidden'), 9000);
  }

  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (state.recording) stopRecording(); else startRecording();
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      if (state.recording) stopRecording(); else startRecording();
    }
    if (e.key === 'Escape' && state.recording) {
      e.preventDefault();
      stopRecording();
    }
  });
})();
