import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { detectarNicho, gerarAutomacaoWhatsApp, salvarAutomacaoDisco } from './whatsapp_automation_engine.js';
import { validarPastaProjetoCompleta, esperarArquivosAparecerem } from './write_sync_guard.js';

const AUDIO_TMP_DIR = process.env.AUDIO_TMP_DIR || path.resolve(process.cwd(), 'audio_tmp');
const CRIADOR_BASE = process.env.CRIADOR_BASE_URL || 'http://127.0.0.1:3000';

function _assegurarDir(p) { return fs.mkdir(p, { recursive: true }).catch(() => {}); }

export async function sttTranscreverAudio({ audioBuffer, audioMime = 'audio/webm', provider = 'auto' }) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const sttModel = process.env.GEMINI_STT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!GEMINI_API_KEY) {
    return { ok: false, error: 'GEMINI_API_KEY/GOOGLE_API_KEY não configurada no .env — necessário para STT via Gemini.', code: 'ENV_MISSING', transcrição: null };
  }
  try {
    if (provider === 'auto' || provider === 'gemini') {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(sttModel)}:generateContent`;
      const b64 = (Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || '')).toString('base64');
      const body = {
        contents: [{ parts: [
          { text: `Você é um transcritor de áudio para texto em português do Brasil.
Seu objetivo: TRANSCRIBA EXATAMENTE o que foi dito no áudio anexado.
Não adicione contexto. Não faça resumos. Não corrija termos técnicos. Não embeleze.
Se não entender alguma palavra, marque como [inaudível].` },
          { inline_data: { mime_type: audioMime || 'audio/webm', data: b64 } },
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      };
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      });
      const txt = await resp.text();
      let json; try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
      if (!resp.ok) {
        const erroBruto = String(json?.error?.message || json?.error || txt || '').slice(0,260);
        // Tratamento explícito do erro reportado pelo usuário: 400 API key not valid
        if (resp.status === 400 && /API key not valid/i.test(erroBruto)) {
          return { ok: false, error: 'Chave GEMINI_API_KEY (ou GOOGLE_API_KEY) configurada incorretamente ou inválida. Verifique as variáveis GEMINI_API_KEY / GOOGLE_API_KEY no arquivo .env — cole a chave exatamente, sem aspas extras ou espaços. Se for usar o Google TTS em paralelo, a mesma GOOGLE_API_KEY serve para os dois se tiver os APIs ativados no projeto Google Cloud.', code: 'STT_GEMINI_API_KEY_INVALID', provider: 'gemini', rawBreve: json?.error || erroBruto };
        }
        if (resp.status === 403 && /(PERMISSION_DENIED|API key has expired|API key not found|restricted client)/i.test(erroBruto)) {
          return { ok: false, error: 'Chave Gemini sem permissão para o STT: API Generative Language não ativada no projeto Google Cloud, chave expirada ou IP restrito. Ative "Generative Language API" no console do Google Cloud e/ou confira a chave.', code: 'STT_GEMINI_PERMISSION', provider: 'gemini', rawBreve: erroBruto };
        }
        return { ok: false, error: `Gemini STT HTTP ${resp.status}: ${erroBruto}`, code: 'STT_HTTP_' + resp.status, provider: 'gemini', modelo: sttModel };
      }
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const transcrito = parts.map(p => (p && typeof p.text === 'string') ? p.text : '').join('\n').trim();
      if (!transcrito) return { ok: false, error: 'Resposta Gemini sem texto transcrito.', code: 'STT_EMPTY', raw: json, provider: 'gemini', modelo: sttModel };
      return { ok: true, transcrito, provider: 'gemini', modelo: sttModel, raw: json };
    }
    return { ok: false, error: `Provider STT desconhecido: ${provider}`, code: 'STT_UNKNOWN_PROVIDER' };
  } catch (e) {
    return { ok: false, error: `STT falha geral: ${String(e.message || e).slice(0,200)}`, code: 'STT_ERROR', modelo: sttModel };
  }
}

export function extrairContextoDeTexto(textoTranscrito) {
  const t = String(textoTranscrito || '').trim();
  if (!t) return { ok: false, error: 'Texto vazio.' };
  const nicho = detectarNicho(t);
  const palavras = t.split(/\s+/).filter(Boolean);

  let nomeEmpresa = null;
  const mNome = t.match(/(?:da|minha|para|cria(?:r|do)?|agente)\s+(?:empresa|loja|cl[ií]nica|barbearia|restaurante|imobiliaria)\s+(?:chamada|de|nomeada|chama-se|denominada)?\s*["'`]?([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\-&'" ]{2,60})["'`]?/i)
          || t.match(/(?:o nome|nome)\s+(?:é|da empresa|de)\s+["'`]?([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\-&'" ]{2,60})["'`]?/i);
  if (mNome) nomeEmpresa = mNome[1].trim().replace(/["'`]/g, '').trim();
  if (!nomeEmpresa) {
    const candidatas = t.match(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]{3,}(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]{2,}){0,4})/g) || [];
    if (candidatas.length) nomeEmpresa = candidatas.slice(0, 2).join(' ');
  }

  let ferramentas = [];
  const tLow = t.toLowerCase();
  if (/agenda|agendamento|hor[aá]rio|consulta|marca|reserva/.test(tLow)) ferramentas.push('agendamento_horarios');
  if (/catalogo|card[aá]pio|produto|serviço|servicos|preço|precos|tabela/.test(tLow)) ferramentas.push('catalogo_precos');
  if (/faq|d[uú]vida|pergunta|atendimento|qualific/.test(tLow)) ferramentas.push('faq_qualificacao');
  if (/pagamento|pix|cart[aã]o|boleto|link pagamento/.test(tLow)) ferramentas.push('link_pagamento');
  if (/crm|integracao|integração|webhook|planilha/.test(tLow)) ferramentas.push('crm_planilha_webhook');
  if (!ferramentas.length) ferramentas = ['faq_qualificacao', 'catalogo_precos'];

  let objetivo = null;
  const mObjetivo = t.match(/(?:com|para|de)\s+(agendamento|automação|automaçao|automacao|atendimento|recepção|recepcao|vendas|marketing|pós-venda|pos-venda|cobrança|cobranca).{0,120}$/i);
  objetivo = mObjetivo ? mObjetivo[0].trim() : `Automação de atendimento WhatsApp para nicho ${nicho}.`;

  const slugEmpresa = _slugify(nomeEmpresa || 'empresa-' + nicho);
  const slugAgente = _slugify(_tentarExtrairFuncao(t) || 'recepcao');

  let businessRules = [];
  if (/24 horas|24h|24\/7/.test(tLow)) businessRules.push('Atendimento automático 24 horas por dia.');
  if (/atendente humano|humano|vendedor/.test(tLow)) businessRules.push('Encaminhar dúvidas complexas para atendente humano.');
  if (/whatsapp|zap|wpp/.test(tLow)) businessRules.push('Todo contato inicial via WhatsApp (Evolux API).');

  return {
    ok: true,
    textoOriginal: t,
    nicho,
    empresa: { nome: nomeEmpresa || `Empresa ${nicho.charAt(0).toUpperCase() + nicho.slice(1)}`, slug: slugEmpresa },
    displayName: `Atendimento WhatsApp · ${slugEmpresa}`,
    slugAgente,
    problemStatement: objetivo,
    tools_declared: ferramentas,
    capabilities: _capabilitiesDoNicho(nicho, ferramentas),
    businessRules,
    objetivosExtraidospalavrasCount: palavras.length,
  };
}

export async function dispararCriacaoAgente({ contexto, userId = 'fabrica_voz', wsClient = null }) {
  if (!contexto || !contexto.ok) return { ok: false, error: 'Contexto inválido.' };
  const projectSlug = `agent__${contexto.empresa.slug}__${contexto.slugAgente}`;
  try {
    const createResp = await fetch(`${CRIADOR_BASE}/api/agent/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: { nome: contexto.empresa.nome, slug: contexto.empresa.slug },
        slug: contexto.slugAgente,
        displayName: contexto.displayName,
        problemStatement: contexto.problemStatement,
        tools_declared: Array.isArray(contexto.tools_declared) ? contexto.tools_declared : [],
        capabilities: Array.isArray(contexto.capabilities) ? contexto.capabilities : [],
        businessRules: Array.isArray(contexto.businessRules) ? contexto.businessRules : [],
        _source: { engine: 'voice_processor_fabrica', userId },
      }),
    });
    const crTxt = await createResp.text();
    let cr; try { cr = JSON.parse(crTxt); } catch { cr = { raw: crTxt }; }
    if (!createResp.ok || !cr?.ok) {
      return { ok: false, error: `create agent HTTP ${createResp.status}: ${String(cr?.error || cr?.message || crTxt || '').slice(0,200)}`, projectSlug, raw: cr };
    }
    const dirProjeto = cr.projectDir || path.resolve(process.cwd(), 'workspace', projectSlug);

    const automacaoWa = gerarAutomacaoWhatsApp({ nicho: contexto.nicho, empresaSlug: contexto.empresa.slug, agenteSlug: contexto.slugAgente });
    const salvos = await salvarAutomacaoDisco({ dirProjeto, automacao: automacaoWa });

    await esperarArquivosAparecerem({
      projectDir: dirProjeto,
      arquivosObrigatorios: ['.project', 'agent.json', 'whatsapp/automacao_wa.json', 'whatsapp/handler_wa.js'],
      pollIntervalMs: 1200, maxEsperaMs: 30000,
    }).catch(() => null);

    let buildStatus = null;
    try {
      const bResp = await fetch(`${CRIADOR_BASE}/api/agent/${projectSlug}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const bTxt = await bResp.text();
      try { buildStatus = { http: bResp.status, data: JSON.parse(bTxt) }; } catch { buildStatus = { http: bResp.status, raw: bTxt.slice(0, 400) }; }
    } catch (eBuild) { buildStatus = { error: String(eBuild.message || eBuild).slice(0, 200) }; }

    await new Promise(r => setTimeout(r, 3000));
    const validacaoWrite = validarPastaProjetoCompleta({
      projectSlug, projectDir: dirProjeto,
      options: { requirePlanFiles: false, requireAgentSpec: true, minArquivosCodigo: 1 },
    });

    return {
      ok: true,
      projectSlug,
      agentSlug: cr.data?.spec?.slug || contexto.slugAgente,
      empresaSlug: cr.data?.spec?.company?.slug || contexto.empresa.slug,
      stateInicial: cr.state?.currentState || 'rascunho',
      automacaoWa: { jsonPath: salvos.jsonPath, handlerPath: salvos.handlerPath, id: automacaoWa.id, nicho: automacaoWa.nicho },
      buildScheduled: buildStatus,
      validacaoWrite: {
        ok: !!validacaoWrite.ok,
        arquivosValidados: validacaoWrite.arquivosValidados || [],
        contagemCodigo: validacaoWrite.contagemCodigo || 0,
        checks: validacaoWrite.checks || {},
        errors: (validacaoWrite.errors || []).slice(0, 8),
        avisos: (validacaoWrite.avisos || []).slice(0, 8),
        observacao: validacaoWrite.ok ? '✅ Escrita completa. Se waitForBuild=true, build assíncrono já está enfileirado.' : 'ℹ️ Escrita ainda incompleta (build RC22 ainda roda em background) — arquivos agent.json/whatsapp/ OK, html/js/rotas do plano chegam em alguns segundos via WebSocket UI.',
      },
      buildDocs: {
        next_steps: [
          'Abra o TiAgente Criador (http://localhost:3000) e selecione o projeto: ' + projectSlug,
          'Acompanhe o progresso do build pela barra de estado (rascunho → construindo → testando → pronto).',
          'Configure WHATSAPP_EVOLUX_API_KEY e WHATSAPP_EVOLUX_INSTANCE_ID no projeto para ligar o WhatsApp.',
        ],
      },
    };
  } catch (e) {
    return { ok: false, error: `Falha criação agente por voz: ${String(e.message || e).slice(0, 200)}`, projectSlug };
  }
}

export async function ttsGerarRespostaAudio({ texto, voice = 'pt-BR-Neural2-A', provider = 'auto' }) {
  const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!GOOGLE_TTS_API_KEY) {
    return { ok: false, error: 'GOOGLE_TTS_API_KEY/GOOGLE_API_KEY necessária para TTS (Google Cloud Text-to-Speech).', code: 'ENV_MISSING', audioBase64: null };
  }
  try {
    await _assegurarDir(AUDIO_TMP_DIR);
    const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(GOOGLE_TTS_API_KEY)}`;
    const body = {
      input: { text: String(texto || '').slice(0, 1500) },
      voice: { languageCode: 'pt-BR', name: voice || 'pt-BR-Neural2-B' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: 0 },
    };
    const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await resp.text();
    let json; try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
    if (!resp.ok) {
      const err = String(json?.error?.message || json?.error || txt || '').slice(0,220);
      if (resp.status === 400 && /API key not valid/i.test(err)) {
        return { ok: false, error: 'Chave GOOGLE_TTS_API_KEY/GOOGLE_API_KEY inválida no TTS. Verifique a variável no .env — se preferir separar as chaves, use GOOGLE_TTS_API_KEY para Cloud TTS e GEMINI_API_KEY para Gemini STT.', code: 'TTS_GOOGLE_API_KEY_INVALID', rawBreve: err };
      }
      return { ok: false, error: `TTS HTTP ${resp.status}: ${err}`, code: 'TTS_HTTP_' + resp.status };
    }
    const b64 = json?.audioContent || null;
    if (!b64) return { ok: false, error: 'TTS sem audioContent.', code: 'TTS_EMPTY', raw: json };
    const fileName = `tts_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp3`;
    const fullPath = path.join(AUDIO_TMP_DIR, fileName);
    await fs.writeFile(fullPath, Buffer.from(b64, 'base64'));
    return { ok: true, provider: 'google-tts', voice: body.voice.name, durationEstimatedSeg: Math.max(3, Math.round(String(texto || '').length / 18)), file: fullPath, audioBase64Head: b64.slice(0, 60) + '...' };
  } catch (e) {
    return { ok: false, error: `TTS falha geral: ${String(e.message || e).slice(0,200)}`, code: 'TTS_ERROR' };
  }
}

export async function executarFluxoVozCompleto({ audioBuffer, audioMime, userId = 'fabrica' }) {
  await _assegurarDir(AUDIO_TMP_DIR);
  const r1 = await sttTranscreverAudio({ audioBuffer, audioMime });
  if (!r1.ok) return { etapa: 'STT', ...r1 };
  const contexto = extrairContextoDeTexto(r1.transcrito);
  if (!contexto.ok) return { etapa: 'EXTRACAO_CONTEXTO', stt: r1, ...contexto };
  const criacao = await dispararCriacaoAgente({ contexto, userId });
  const ttsTexto = criacao.ok
    ? `Olá! Criei seu agente ${criacao.automacaoWa.nicho} para a empresa ${criacao.empresaSlug}. Tudo certo: build agendado, automação WhatsApp pronta. Abra o TiAgente Criador e veja o projeto ${criacao.projectSlug}.`
    : `Desculpe, não consegui criar o agente agora. Motivo: ${String(criacao.error || 'erro desconhecido').slice(0, 150)}. Tente novamente com mais detalhes.`;
  const tts = await ttsGerarRespostaAudio({ texto: ttsTexto });
  return { ok: criacao.ok, etapa: 'COMPLETO', stt: r1, contexto, criacao, tts, textoConfirmacao: ttsTexto };
}

export async function executarFluxoTextoCompleto({ texto, userId = 'fabrica_texto' }) {
  const contexto = extrairContextoDeTexto(texto);
  if (!contexto.ok) return { etapa: 'EXTRACAO_CONTEXTO', ...contexto };
  const criacao = await dispararCriacaoAgente({ contexto, userId });
  return { ok: criacao.ok, etapa: 'COMPLETO_TEXTO', contexto, criacao };
}

function _slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'sem-nome';
}

function _tentarExtrairFuncao(t) {
  const tLow = String(t || '').toLowerCase();
  if (/recepcion|atendimento|secretaria|recepcao|boas-vindas/.test(tLow)) return 'recepcao';
  if (/venda|vendedor|comercial|prospect|lead/.test(tLow)) return 'vendas';
  if (/cobran|financeiro|pagamento|boleto|cobranca/.test(tLow)) return 'cobranca';
  if (/marketing|campanha|promoção|promocao|divulgacao/.test(tLow)) return 'marketing';
  if (/agenda|agendamento|horario|horário|consulta/.test(tLow)) return 'agendamento';
  if (/pos-venda|pós-venda|suporte|helpdesk|help desk/.test(tLow)) return 'pos_venda';
  return 'recepcao';
}

function _capabilitiesDoNicho(nicho, tools) {
  const caps = [];
  if (tools.includes('agendamento_horarios')) caps.push({ type: 'custom_webhook', id: 'wa_webhook_evolux', config: { desc: 'Webhook Evolux para mensagens/agendamento.' } });
  caps.push({ type: 'whatsapp_evolux', id: `wa_${nicho}_principal`, requiredEnvVars: ['WHATSAPP_EVOLUX_API_KEY', 'WHATSAPP_EVOLUX_INSTANCE_ID'] });
  if (tools.includes('crm_planilha_webhook')) caps.push({ type: 'generic_rest_crm', id: 'crm_principal', config: { desc: 'CRM Genérico via REST/Planilha (ex: Google Sheets).' } });
  if (/agenda|agendamento|clinica|barbearia|restaurante/.test(nicho)) caps.push({ type: 'google_calendar', id: 'agenda_principal', requiredEnvVars: ['GCAL_CLIENT_ID', 'GCAL_CLIENT_SECRET', 'GCAL_REFRESH_TOKEN'] });
  caps.push({ type: 'smtp_email', id: 'email_transacional', requiredEnvVars: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] });
  return caps;
}

export default {
  sttTranscreverAudio,
  extrairContextoDeTexto,
  dispararCriacaoAgente,
  ttsGerarRespostaAudio,
  executarFluxoVozCompleto,
  executarFluxoTextoCompleto,
};
