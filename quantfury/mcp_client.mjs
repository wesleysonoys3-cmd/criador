import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { QUANTFURY_CFG } from './config.mjs';

let _msgIdCounter = 0;
const nextMsgId = () => `qf_${Date.now().toString(36)}_${(++_msgIdCounter).toString(36)}`;

export class McpClientError extends Error {
  constructor(message, { code = -1, data = null, cause = null, httpStatus = null } = {}) {
    super(message);
    this.name = 'McpClientError';
    this.code = code;
    this.data = data;
    this.cause = cause;
    this.httpStatus = httpStatus;
  }
}

export const MCP_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AUTHORIZATION_REQUIRED: -32000,
  AUTHORIZATION_PENDING: -32001,
  AUTHORIZATION_DENIED: -32002,
  SESSION_EXPIRED: -32003,
  RATE_LIMITED: -32004,
  SERVICE_UNAVAILABLE: -32005,
});

const BLOCKED_METHODS_OUTBOUND = new Set([
  'tools/call',
]);

export class McpStreamableHttpClient {
  constructor({ mcpUrl = QUANTFURY_CFG.MCP_URL, readOnly = QUANTFURY_CFG.READ_ONLY, timeoutMs = QUANTFURY_CFG.REQUEST_TIMEOUT_MS, userAgent = QUANTFURY_CFG.USER_AGENT } = {}) {
    this.mcpUrl = mcpUrl;
    this.readOnly = Boolean(readOnly);
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
    this.userAgent = userAgent;
    this._sessionHeaders = {};
    this._initialized = false;
    this._serverInfo = null;
    this._serverCapabilities = Object.freeze({});
    this._disposed = false;
  }

  isInitialized() {
    return this._initialized;
  }

  getServerInfo() {
    return this._serverInfo ? { ...this._serverInfo } : null;
  }

  getServerCapabilities() {
    return { ...this._serverCapabilities };
  }

  dispose() {
    this._disposed = true;
    this._sessionHeaders = {};
    this._initialized = false;
  }

  async initialize({ extraClientCapabilities = {} } = {}) {
    if (this._disposed) throw new McpClientError('Client disposed');
    const payload = {
      jsonrpc: '2.0',
      id: nextMsgId(),
      method: 'initialize',
      params: {
        protocolVersion: QUANTFURY_CFG.PROTOCOL_VERSION,
        capabilities: Object.freeze({ ...extraClientCapabilities }),
        clientInfo: {
          name: QUANTFURY_CFG.CLIENT_NAME,
          version: QUANTFURY_CFG.CLIENT_VERSION,
        },
      },
    };
    const res = await this._rpcRoundTrip(payload);
    const result = res.result || {};
    this._serverInfo = Object.freeze({ ...(result.serverInfo || {}) });
    this._serverCapabilities = Object.freeze({ ...(result.capabilities || {}) });
    this._initialized = true;
    try {
      await this.notify('notifications/initialized', {}).catch(() => {});
    } catch (_) { /* notifications não esperam resposta */ }
    return { serverInfo: this.getServerInfo(), capabilities: this.getServerCapabilities() };
  }

  async notify(method, params = {}) {
    if (this._disposed) throw new McpClientError('Client disposed');
    const payload = { jsonrpc: '2.0', method, params: Object.freeze({ ...params }) };
    await this._rawRequest(payload, { noWaitForResponse: true }).catch(() => {});
    return true;
  }

  async toolsList() {
    if (this._disposed) throw new McpClientError('Client disposed');
    if (!this._initialized) await this.initialize();
    const payload = { jsonrpc: '2.0', id: nextMsgId(), method: 'tools/list', params: {} };
    const res = await this._rpcRoundTrip(payload);
    const tools = Array.isArray(res?.result?.tools) ? res.result.tools : [];
    return tools.map(t => Object.freeze({ ...t }));
  }

  async resourcesList() {
    if (this._disposed) throw new McpClientError('Client disposed');
    if (!this._initialized) await this.initialize();
    const payload = { jsonrpc: '2.0', id: nextMsgId(), method: 'resources/list', params: {} };
    const res = await this._rpcRoundTrip(payload);
    const resources = Array.isArray(res?.result?.resources) ? res.result.resources : [];
    return resources.map(r => Object.freeze({ ...r }));
  }

  async promptsList() {
    if (this._disposed) throw new McpClientError('Client disposed');
    if (!this._initialized) await this.initialize();
    const payload = { jsonrpc: '2.0', id: nextMsgId(), method: 'prompts/list', params: {} };
    const res = await this._rpcRoundTrip(payload);
    const prompts = Array.isArray(res?.result?.prompts) ? res.result.prompts : [];
    return prompts.map(p => Object.freeze({ ...p }));
  }

  async toolCall(name, args = {}, { allowWriteOverride = false } = {}) {
    if (this._disposed) throw new McpClientError('Client disposed');
    if (!this._initialized) await this.initialize();
    if (this.readOnly && !allowWriteOverride) {
      const isLikelyWrite = this._methodLikelyWrites(name);
      if (isLikelyWrite) {
        throw new McpClientError(
          `READ_ONLY mode blocked tool "${name}" (detected as write-capable)`,
          { code: -32099, data: { tool: name, reason: 'READ_ONLY' } },
        );
      }
    }
    const payload = {
      jsonrpc: '2.0',
      id: nextMsgId(),
      method: 'tools/call',
      params: { name, arguments: Object.freeze({ ...args }) },
    };
    const res = await this._rpcRoundTrip(payload);
    return res.result || null;
  }

  _methodLikelyWrites(toolName) {
    const n = String(toolName || '').toLowerCase();
    const writeWords = ['open','close','buy','sell','place','cancel','order','trade','execute',
      'withdraw','transfer','deposit','leverage','modify','update_position','set_position',
      'create_','delete_','remove_','submit','send_order'];
    for (const w of writeWords) if (n.includes(w)) return true;
    const readWords = ['get_','list_','fetch_','read_','query_','balance','account','position',
      'history','pnl','profit','loss','price','quote','status','overview','summary','equity',
      'margin','exposure','risk','performance'];
    for (const w of readWords) if (n.includes(w)) return false;
    return false;
  }

  async _rpcRoundTrip(payload) {
    const { msgId, httpStatus, frames, contentType } = await this._rawRequest(payload);
    const envelopes = this._parseFramesToJsonRpc(frames, contentType);
    const related = envelopes.find(e => e && e.id && String(e.id) === String(msgId));
    const firstAuth = envelopes.find(e => e && e.error && (
      e.error.code === MCP_ERROR_CODES.AUTHORIZATION_REQUIRED ||
      e.error.code === MCP_ERROR_CODES.AUTHORIZATION_PENDING ||
      e.error.code === MCP_ERROR_CODES.AUTHORIZATION_DENIED ||
      e.error.code === MCP_ERROR_CODES.SESSION_EXPIRED
    ));
    if (related?.error) {
      throw new McpClientError(related.error.message || `MCP error ${related.error.code}`, {
        code: related.error.code,
        data: related.error.data || null,
        httpStatus,
      });
    }
    if (firstAuth && (!related || !related.result)) {
      throw new McpClientError(firstAuth.error.message || 'Authorization required', {
        code: firstAuth.error.code,
        data: firstAuth.error.data || null,
        httpStatus,
      });
    }
    if (related) return related;
    if (httpStatus && httpStatus >= 400) {
      throw new McpClientError(`HTTP ${httpStatus} from MCP`, { httpStatus });
    }
    throw new McpClientError('No JSON-RPC response matched request id', { httpStatus });
  }

  _parseFramesToJsonRpc(frames, contentType) {
    const out = [];
    const tryParse = (line) => {
      if (!line) return;
      let trimmed = String(line).trim();
      if (!trimmed) return;
      if (trimmed.startsWith('data:')) trimmed = trimmed.slice(5).trim();
      if (!trimmed || trimmed === '[DONE]') return;
      if (trimmed.startsWith('event:') || /^[a-z_]+:/i.test(trimmed)) return;
      try { out.push(JSON.parse(trimmed)); } catch (_) { /* silencioso */ }
    };
    if (Array.isArray(frames)) {
      for (const raw of frames) {
        const lines = String(raw).split(/\r?\n|\r/);
        for (const l of lines) tryParse(l);
      }
    } else {
      const lines = String(frames || '').split(/\r?\n|\r/);
      for (const l of lines) tryParse(l);
    }
    return out;
  }

  _rawRequest(payload, { noWaitForResponse = false } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.mcpUrl);
        const lib = url.protocol === 'https:' ? https : http;
        const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream, application/x-ndjson, application/mcp+json, */*;q=0.6',
          'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
          'User-Agent': this.userAgent,
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Origin': 'https://quantfury.com',
          'Referer': 'https://quantfury.com/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site',
          'MCP-Version': QUANTFURY_CFG.PROTOCOL_VERSION,
          'X-MCP-Transport': 'streamable-http',
          ...this._sessionHeaders,
        };
        const opts = {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + (url.search || ''),
          headers,
          timeout: this.timeoutMs,
          maxHeaderSize: 16384,
        };
        const req = lib.request(opts, (res) => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie) {
            try {
              const jar = (Array.isArray(setCookie) ? setCookie : [setCookie])
                .map(c => c.split(';')[0].trim())
                .filter(Boolean);
              if (jar.length) {
                const prev = (this._sessionHeaders['Cookie'] || '').split(';').map(s => s.trim()).filter(Boolean);
                const merged = new Map();
                for (const p of prev) { const [k] = p.split('='); if (k) merged.set(k, p); }
                for (const p of jar) { const [k] = p.split('='); if (k) merged.set(k, p); }
                this._sessionHeaders['Cookie'] = Array.from(merged.values()).join('; ');
              }
            } catch (_) { /* não propagar erro de cookie */ }
          }
          const chunks = [];
          let msgId = payload && payload.id ? payload.id : null;
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const bodyText = chunks.map(c => c.toString('utf8')).join('');
            resolve({ msgId, httpStatus: res.statusCode || null, frames: bodyText, contentType: res.headers['content-type'] || '' });
          });
          res.on('error', (e) => reject(new McpClientError('Response read error', { cause: e })));
          if (noWaitForResponse) {
            setTimeout(() => resolve({ msgId: payload?.id || null, httpStatus: res.statusCode || null, frames: '', contentType: res.headers?.['content-type'] || '' }), 0);
          }
        });
        req.on('error', (e) => {
          if ((e && e.code === 'ECONNRESET') || /timeout/i.test(e?.message || '')) {
            reject(new McpClientError('Não foi possível conectar ao Quantfury agora.', { cause: e, code: MCP_ERROR_CODES.SERVICE_UNAVAILABLE }));
          } else {
            reject(new McpClientError('Network error to Quantfury MCP', { cause: e, code: MCP_ERROR_CODES.SERVICE_UNAVAILABLE }));
          }
        });
        req.on('timeout', () => {
          req.destroy(new Error('timeout'));
        });
        req.write(body);
        req.end();
      } catch (e) {
        reject(new McpClientError('Request builder error', { cause: e }));
      }
    });
  }
}

export function extractAuthFlow(errorOrData) {
  const data = errorOrData && errorOrData.data ? errorOrData.data : (errorOrData || null);
  if (!data || typeof data !== 'object') return null;
  const out = {};
  for (const k of ['authorizationUrl', 'verificationUri', 'verificationUriComplete',
    'userCode', 'deviceCode', 'expiresIn', 'interval', 'message', 'instructions', 'authUrl']) {
    if (typeof data[k] === 'string') out[k] = data[k];
  }
  const url = out.authorizationUrl || out.verificationUri || out.verificationUriComplete || out.authUrl || null;
  return {
    url,
    userCode: out.userCode || null,
    expiresIn: Number(out.expiresIn) || null,
    interval: Number(out.interval) || null,
    instructions: out.message || out.instructions || (url ? `Abra a URL abaixo no navegador para autorizar: ${url}` : null),
    raw: data,
  };
}
