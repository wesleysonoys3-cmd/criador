import { McpStreamableHttpClient, McpClientError, MCP_ERROR_CODES, extractAuthFlow } from './mcp_client.mjs';
import { QUANTFURY_CFG, QUANTFURY_READ_ONLY_BLOCKLIST_PATTERNS, QUANTFURY_READ_TOOL_HINTS } from './config.mjs';

const SVC_STATE = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  AUTHORIZING: 'authorizing',
  CONNECTED: 'connected',
  EXPIRED: 'expired',
  ERROR: 'error',
});

class QuantfuryService {
  constructor() {
    this._state = SVC_STATE.DISCONNECTED;
    this._stateMessage = 'Não conectado';
    this._client = null;
    this._availableTools = [];
    this._availableResources = [];
    this._availablePrompts = [];
    this._readTools = [];
    this._writeToolsDetected = [];
    this._lastError = null;
    this._lastAuthFlow = null;
    this._lastRefresh = null;
    this._cachePositions = null;
    this._cacheAccount = null;
    this._cacheTs = 0;
    this._discoveredReadFunctions = Object.freeze({});
  }

  getState() {
    return {
      state: this._state,
      message: this._stateMessage,
      connected: this._state === SVC_STATE.CONNECTED,
      requiresAuth: this._state === SVC_STATE.AUTHORIZING || this._state === SVC_STATE.EXPIRED,
      authFlow: this._lastAuthFlow ? { ...this._lastAuthFlow, raw: undefined } : null,
      lastError: this._lastError ? { message: String(this._lastError.message || this._lastError), code: this._lastError.code || null, httpStatus: this._lastError.httpStatus || null } : null,
      lastRefreshAt: this._lastRefresh ? new Date(this._lastRefresh).toISOString() : null,
      tools: {
        total: this._availableTools.length,
        readOnlyEnabled: this._readTools.map(t => ({ name: t.name, description: t.description || '' })),
        writeDetectedBlocked: this._writeToolsDetected.map(t => ({ name: t.name, description: t.description || '' })),
      },
      readOnly: QUANTFURY_CFG.READ_ONLY,
    };
  }

  _setState(state, message = null, err = null) {
    this._state = state;
    if (message) this._stateMessage = message;
    if (err) {
      const msg = String(err?.message || err || '');
      const isAuthErr = state === SVC_STATE.AUTHORIZING || state === SVC_STATE.EXPIRED;
      let sanitized = msg;
      if (isAuthErr) {
        sanitized = sanitized.replace(/(cookie|session|token|jwt|authorization|bearer|cf_clearance|__cf_bm|__secure|set-cookie|header)[^\s;]*/gi, (m) => `[${String(m || 'x').slice(0, 1).toUpperCase()} REDACTED]`);
      }
      this._lastError = {
        message: sanitized,
        code: err?.code || null,
        httpStatus: err?.httpStatus || null,
      };
      if (this._lastAuthFlow) {
        this._lastAuthFlow.raw = undefined;
        if (this._lastAuthFlow.instructions) {
          this._lastAuthFlow.instructions = String(this._lastAuthFlow.instructions).replace(/(cookie|session|token|jwt|authorization|bearer|cf_clearance|__cf_bm|__secure|set-cookie|header)[^\s;]*/gi, (m) => `[${String(m || 'x').slice(0, 1).toUpperCase()} REDACTED]`);
        }
      }
    } else {
      this._lastError = null;
    }
  }

  async connect({ force = false } = {}) {
    if (this._state === SVC_STATE.CONNECTED && !force) return this.getState();
    if (this._state === SVC_STATE.CONNECTING) {
      throw new McpClientError('Já conectando, aguarde.', { code: -32098 });
    }
    this._setState(SVC_STATE.CONNECTING, 'Conectando ao Quantfury MCP…');
    this._lastError = null;
    try {
      if (this._client) try { this._client.dispose(); } catch (_) {}
      this._client = new McpStreamableHttpClient({
        mcpUrl: QUANTFURY_CFG.MCP_URL,
        readOnly: QUANTFURY_CFG.READ_ONLY,
        timeoutMs: QUANTFURY_CFG.REQUEST_TIMEOUT_MS,
      });
      await this._client.initialize();
      await this._discoverAll();
      this._setState(SVC_STATE.CONNECTED, 'Conectado');
      return this.getState();
    } catch (err) {
      if (err instanceof McpClientError) {
        const code = err.code;
        const httpStatus = err.httpStatus || null;
        if (code === MCP_ERROR_CODES.AUTHORIZATION_REQUIRED || code === MCP_ERROR_CODES.AUTHORIZATION_PENDING) {
          const flow = extractAuthFlow(err);
          if (flow) this._lastAuthFlow = flow;
          this._setState(SVC_STATE.AUTHORIZING, flow?.instructions || 'Autenticação Quantfury necessária. Autorize o TiAgente para acessar sua conta Quantfury pelo MCP oficial.', err);
        } else if (httpStatus === 403 || httpStatus === 401 || code === MCP_ERROR_CODES.AUTHORIZATION_DENIED || code === MCP_ERROR_CODES.SESSION_EXPIRED) {
          this._lastAuthFlow = {
            url: 'https://ai.quantfury.com/mcp',
            userCode: null,
            expiresIn: null,
            interval: null,
            instructions: 'Autenticação Quantfury necessária. O servidor Quantfury (MCP) retornou HTTP 401/403 — autorização pendente ou sessão expirada. Autorize o TiAgente como conector MCP Streamable HTTP usando a URL oficial do MCP abaixo, ou configure em Claude Code, Cursor, Codex, ChatGPT etc. e depois clique em "Já autorizei · Verificar conexão" para revalidar.',
            raw: null,
          };
          if (code === MCP_ERROR_CODES.SESSION_EXPIRED) {
            this._setState(SVC_STATE.EXPIRED, 'Sessão Quantfury expirou. Autorize novamente o conector MCP oficial.', err);
          } else {
            this._setState(SVC_STATE.AUTHORIZING, 'Autenticação Quantfury necessária (HTTP 401/403). Autorize o conector MCP oficial.', err);
          }
        } else {
          this._setState(SVC_STATE.ERROR, 'Não foi possível conectar ao Quantfury agora.', err);
        }
      } else {
        this._setState(SVC_STATE.ERROR, 'Não foi possível conectar ao Quantfury agora.', err);
      }
      return this.getState();
    }
  }

  async disconnect() {
    if (this._client) try { this._client.dispose(); } catch (_) {}
    this._client = null;
    this._availableTools = [];
    this._availableResources = [];
    this._availablePrompts = [];
    this._readTools = [];
    this._writeToolsDetected = [];
    this._lastAuthFlow = null;
    this._cachePositions = null;
    this._cacheAccount = null;
    this._discoveredReadFunctions = Object.freeze({});
    this._setState(SVC_STATE.DISCONNECTED, 'Não conectado');
    return this.getState();
  }

  async _discoverAll() {
    if (!this._client || !this._client.isInitialized()) throw new McpClientError('Not initialized');
    const [tools, resources, prompts] = await Promise.all([
      this._client.toolsList().catch(e => { console.warn('[QF] tools/list erro:', e?.message || e); return []; }),
      this._client.resourcesList().catch(e => { console.warn('[QF] resources/list erro:', e?.message || e); return []; }),
      this._client.promptsList().catch(e => { console.warn('[QF] prompts/list erro:', e?.message || e); return []; }),
    ]);
    this._availableTools = tools;
    this._availableResources = resources;
    this._availablePrompts = prompts;
    const { read, write } = this._classifyTools(tools);
    this._readTools = read;
    this._writeToolsDetected = write;
    this._discoveredReadFunctions = Object.freeze(this._buildReadToolIndex(read));
  }

  _classifyTools(tools) {
    const read = [];
    const write = [];
    for (const t of tools || []) {
      const name = String(t.name || '').toLowerCase();
      const desc = String(t.description || '').toLowerCase();
      const combined = name + ' ' + desc;
      let isWrite = false;
      for (const pat of QUANTFURY_READ_ONLY_BLOCKLIST_PATTERNS) {
        if (pat.test(combined)) { isWrite = true; break; }
      }
      if (!isWrite) {
        for (const hint of QUANTFURY_READ_TOOL_HINTS) {
          if (combined.includes(hint.toLowerCase())) { read.push(t); isWrite = false; break; }
        }
        if (read[read.length - 1] !== t) read.push(t);
      } else {
        write.push(t);
      }
    }
    return { read, write };
  }

  _buildReadToolIndex(readTools) {
    const idx = {
      account: null, balance: null, positions: null, history: null,
      pnl: null, price: null, quote: null, status: null, overview: null,
    };
    const nameList = readTools.map(t => String(t.name || '').toLowerCase());
    const matchExact = (cands) => {
      for (const c of cands) {
        const i = nameList.indexOf(c.toLowerCase());
        if (i >= 0) return readTools[i];
      }
      return null;
    };
    idx.account = matchExact(['get_account','account_info','account_summary','account_overview','getAccount','account','accountInfo','get_account_info','account_details']);
    idx.balance = matchExact(['get_balance','balances','account_balance','equity','getBalance','balance','getBalances','wallet_balance','balances_list','list_balances']);
    idx.positions = matchExact(['get_positions','positions','open_positions','get_positions_list','list_positions','getOpenPositions','positions_list','portfolio_positions','getPositions']);
    idx.pnl = matchExact(['get_pnl','pnl','profit_loss','profit_and_loss','performance','getPnl','realized_pnl','unrealized_pnl','getPerformance']);
    idx.history = matchExact(['history','trade_history','transaction_history','order_history','get_history','get_trades','trades','list_history']);
    idx.price = matchExact(['get_price','price','quote','get_quote','market_price','ticker','getTicker','asset_price']);
    idx.overview = matchExact(['overview','summary','portfolio','get_portfolio','portfolio_summary','getOverview','getSummary','account_overview']);
    idx.status = matchExact(['status','ping','health','get_status','connection_status']);
    return idx;
  }

  async refreshAll({ force = false } = {}) {
    if (!this._client || this._state !== SVC_STATE.CONNECTED) {
      await this.connect({ force: true });
      if (this._state !== SVC_STATE.CONNECTED) return this.getState();
    }
    const now = Date.now();
    try {
      const promises = [];
      const fns = this._discoveredReadFunctions;
      const argsSafe = {};
      if (fns.positions) promises.push((async () => { try { return { key:'positions', value: await this._client.toolCall(fns.positions.name, argsSafe) }; } catch(e){ return { key:'positions', value: null, error: e }; } })());
      if (fns.balance)   promises.push((async () => { try { return { key:'balance', value: await this._client.toolCall(fns.balance.name, argsSafe) }; } catch(e){ return { key:'balance', value: null, error: e }; } })());
      if (fns.account)   promises.push((async () => { try { return { key:'account', value: await this._client.toolCall(fns.account.name, argsSafe) }; } catch(e){ return { key:'account', value: null, error: e }; } })());
      if (fns.overview)  promises.push((async () => { try { return { key:'overview', value: await this._client.toolCall(fns.overview.name, argsSafe) }; } catch(e){ return { key:'overview', value: null, error: e }; } })());
      if (fns.pnl)       promises.push((async () => { try { return { key:'pnl', value: await this._client.toolCall(fns.pnl.name, argsSafe) }; } catch(e){ return { key:'pnl', value: null, error: e }; } })());
      const results = await Promise.all(promises);
      const bag = {};
      let firstAuthErr = null;
      for (const r of results) {
        if (r.error && r.error instanceof McpClientError && (
          r.error.code === MCP_ERROR_CODES.SESSION_EXPIRED ||
          r.error.code === MCP_ERROR_CODES.AUTHORIZATION_REQUIRED ||
          r.error.code === MCP_ERROR_CODES.AUTHORIZATION_DENIED
        )) { firstAuthErr = firstAuthErr || r.error; }
        bag[r.key] = r.value;
      }
      if (firstAuthErr) {
        const code = firstAuthErr.code;
        if (code === MCP_ERROR_CODES.SESSION_EXPIRED) {
          this._setState(SVC_STATE.EXPIRED, 'Autorização da Quantfury expirou. Reconecte.', firstAuthErr);
        } else {
          this._setState(SVC_STATE.AUTHORIZING, 'Autorize o TiAgente para acessar sua conta Quantfury.', firstAuthErr);
        }
        return this.getState();
      }
      this._cacheAccount = Object.freeze({
        account: bag.account || null,
        balance: bag.balance || null,
        overview: bag.overview || null,
        pnl: bag.pnl || null,
      });
      this._cachePositions = bag.positions || null;
      this._cacheTs = now;
      this._lastRefresh = now;
      return this.getState();
    } catch (err) {
      this._setState(SVC_STATE.ERROR, 'Não foi possível obter posições neste momento.', err);
      return this.getState();
    }
  }

  getCachedData() {
    return {
      account: this._cacheAccount ? { ...this._cacheAccount } : null,
      positions: this._cachePositions,
      refreshedAt: this._lastRefresh ? new Date(this._lastRefresh).toISOString() : null,
    };
  }

  async analyzePosition({ assetSymbol = null } = {}) {
    const cache = this.getCachedData();
    if (!cache.account && !cache.positions) {
      const refreshed = await this.refreshAll({ force: false });
      if (!refreshed.connected) throw new McpClientError(refreshed.message || 'Sem dados para analisar');
    }
    const c = this.getCachedData();
    const positions = Array.isArray(c.positions) ? c.positions :
                     (c.positions && Array.isArray(c.positions.positions) ? c.positions.positions :
                      (c.positions && Array.isArray(c.positions.data) ? c.positions.data : []));
    const filtered = assetSymbol
      ? positions.filter(p => this._matchAsset(p, assetSymbol))
      : positions;
    return {
      generatedAt: new Date().toISOString(),
      account: c.account ? this._sanitizeAccount(c.account) : null,
      positions: filtered.map(p => this._normalizePosition(p)),
    };
  }

  _matchAsset(pos, sym) {
    if (!pos || !sym) return false;
    const s = String(sym).toLowerCase();
    const field = [pos.symbol, pos.asset, pos.ticker, pos.instrument, pos.name, pos.pair]
      .map(x => x ? String(x).toLowerCase() : '').join('|');
    return field.includes(s);
  }

  _normalizePosition(p) {
    if (!p || typeof p !== 'object') return null;
    const pick = (...keys) => {
      for (const k of keys) {
        if (p[k] !== undefined && p[k] !== null) return p[k];
        const K = k.split(/(?=[A-Z])/).map((w,i)=>i?w.charAt(0).toUpperCase()+w.slice(1):w).join('');
        if (p[K] !== undefined) return p[K];
      }
      return null;
    };
    const asset = pick('symbol','asset','ticker','instrument','pair','name','code');
    const directionRaw = String(pick('side','direction','position_side','type','positionType') || '').toLowerCase();
    let direction = '—';
    if (/long|buy|^call|^bull|positiva|compra/i.test(directionRaw)) direction = 'LONG';
    else if (/short|sell|^put|^bear|negativa|venda/i.test(directionRaw)) direction = 'SHORT';
    else if (directionRaw) direction = String(directionRaw).toUpperCase().slice(0, 12);
    const entry = this._toNum(pick('entry_price','entryPrice','avgEntry','averagePrice','avg_price','open_price','price'));
    const current = this._toNum(pick('current_price','currentPrice','markPrice','mark_price','lastPrice','last_price','price','spotPrice'));
    const pnl = this._toNum(pick('pnl','unrealized_pnl','unrealizedPnl','profit_loss','profitLoss','PnL','profit'));
    const size = this._toNum(pick('size','quantity','qty','amount','position_size','units','contracts','exposure'));
    const leverage = this._toNum(pick('leverage','leverageSize','lev'));
    return Object.freeze({
      asset: asset ? String(asset) : '—',
      direction,
      entryPrice: entry,
      currentPrice: current,
      pnl,
      size,
      leverage,
      raw: p,
    });
  }

  _sanitizeAccount(a) {
    if (!a || typeof a !== 'object') return null;
    const equity = this._toNum(a.equity ?? a.total_equity ?? a.totalEquity ?? a.net_value ?? a.account_value);
    const balance = this._toNum(a.balance ?? a.available_balance ?? a.cash_balance ?? a.free_balance ?? a.wallet_balance);
    const margin = this._toNum(a.used_margin ?? a.margin_used ?? a.total_margin);
    const pnl = this._toNum(a.total_pnl ?? a.pnl_total ?? a.realized_pnl ?? a.unrealized_pnl);
    return Object.freeze({ equity, balance, usedMargin: margin, pnl });
  }

  _toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-+eE]/g,''));
    return Number.isFinite(n) ? n : null;
  }

  async genericReadToolCall(toolName, args = {}) {
    if (!this._client || this._state !== SVC_STATE.CONNECTED) {
      await this.connect({ force: true });
      if (this._state !== SVC_STATE.CONNECTED) {
        throw new McpClientError(this._stateMessage || 'Sem conexão');
      }
    }
    const tool = this._readTools.find(t => t.name === toolName);
    if (!tool) throw new McpClientError(`Ferramenta de leitura "${toolName}" não encontrada ou bloqueada por READ_ONLY`);
    return await this._client.toolCall(toolName, args || {});
  }
}

export const QuantfurySvc = new QuantfuryService();
export { SVC_STATE as QUANTFURY_STATE };
