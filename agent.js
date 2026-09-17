import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-3.5-flash-lite';
const WORK_DIR = path.resolve(process.env.WORK_DIR || './workspace');
const MAX_STEPS = parseInt(process.env.MAX_STEPS || '50', 10);
const COMMAND_TIMEOUT_MS = 60000;
const API_VERSION = 'v1beta';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  user: '\x1b[36m',
  ai: '\x1b[33m',
  func: '\x1b[35m',
  result: '\x1b[32m',
  error: '\x1b[31m',
  info: '\x1b[90m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
};

function log(prefix, message, color = COLORS.reset) {
  const ts = new Date().toLocaleTimeString('pt-BR');
  console.log(`${COLORS.info}[${ts}]${COLORS.reset} ${color}${COLORS.bright}${prefix}${COLORS.reset} ${color}${message}${COLORS.reset}`);
}

async function ensureWorkDir() {
  await fs.mkdir(WORK_DIR, { recursive: true });
}

function safeResolve(relativePath) {
  const resolved = path.resolve(WORK_DIR, relativePath || '.');
  if (!resolved.startsWith(WORK_DIR)) {
    throw new Error(`Acesso negado: caminho fora do diretório de trabalho (${WORK_DIR})`);
  }
  return resolved;
}

async function toolReadFile({ path: filePath }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  const fullPath = safeResolve(filePath);
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    return { ok: true, path: filePath, content, size: content.length };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolWriteFile({ path: filePath, content }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  if (typeof content !== 'string') content = String(content ?? '');
  const fullPath = safeResolve(filePath);
  try {
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    const existed = await fs.access(fullPath).then(() => true).catch(() => false);
    await fs.writeFile(fullPath, content, 'utf8');
    return { ok: true, path: filePath, action: existed ? 'updated' : 'created', size: content.length };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolDeleteFile({ path: filePath, recursive }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  const fullPath = safeResolve(filePath);
  try {
    await fs.rm(fullPath, { recursive: !!recursive, force: true });
    return { ok: true, path: filePath, deleted: true };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolRunCommand({ command, timeout_sec, cwd }) {
  if (!command) throw new Error('Parâmetro "command" é obrigatório');
  const timeout = timeout_sec ? Math.min(300, parseInt(timeout_sec, 10)) * 1000 : COMMAND_TIMEOUT_MS;
  let effectiveCwd = WORK_DIR;
  if (cwd) {
    const candidate = safeResolve(cwd);
    const st = await fs.stat(candidate).catch(() => null);
    if (st?.isDirectory()) effectiveCwd = candidate;
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: effectiveCwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      ok: true,
      command,
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-2000),
    };
  } catch (err) {
    return {
      ok: false,
      command,
      error: err.message,
      stdout: (err.stdout || '').slice(-2000),
      stderr: (err.stderr || '').slice(-2000),
    };
  }
}

async function toolListDir({ path: dirPath = '.', depth = 2, exclude }) {
  const base = safeResolve(dirPath);
  const skip = Array.isArray(exclude) ? exclude : ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '__pycache__'];
  const maxDepth = Math.min(5, parseInt(depth || 2, 10));

  async function walk(current, rel, d) {
    const entries = [];
    try {
      const dirEntries = await fs.readdir(current, { withFileTypes: true });
      for (const ent of dirEntries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (skip.includes(ent.name)) continue;
        const full = path.join(current, ent.name);
        const relPath = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          const child = {
            name: ent.name,
            path: relPath,
            type: 'dir',
            children: d < maxDepth ? await walk(full, relPath, d + 1) : undefined,
          };
          entries.push(child);
        } else if (ent.isFile()) {
          try {
            const st = await fs.stat(full);
            entries.push({ name: ent.name, path: relPath, type: 'file', size: st.size });
          } catch {
            entries.push({ name: ent.name, path: relPath, type: 'file', size: 0 });
          }
        }
      }
    } catch (e) { /* ignore */ }
    return entries;
  }

  try {
    const tree = await walk(base, '', 1);
    const count = JSON.stringify(tree).match(/"type":"file"/g)?.length || 0;
    return { ok: true, root: dirPath || '.', tree, files: count };
  } catch (err) {
    return { ok: false, root: dirPath, error: err.message };
  }
}

const TOOLS = {
  read_file: toolReadFile,
  write_file: toolWriteFile,
  delete_file: toolDeleteFile,
  run_command: toolRunCommand,
  list_dir: toolListDir,
};

const TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo completo de um arquivo de texto dentro do diretório de trabalho.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do arquivo (ex: src/index.js, README.md).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo de texto. Cria subdiretórios automaticamente. SEMPRE envie o arquivo COMPLETO (nunca trechos ou placeholders).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do arquivo (ex: src/index.js).' },
        content: { type: 'STRING', description: 'Conteúdo COMPLETO e final do arquivo. NUNCA deixe TODO, placeholder ou "..." cortando o código.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Remove um arquivo ou diretório vazio. Use recursive=true para diretórios com conteúdo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo a remover.' },
        recursive: { type: 'BOOLEAN', description: 'Remove diretório com conteúdo recursivamente. CUIDADO.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Executa um comando shell no diretório de trabalho. Use para instalar pacotes (npm install, pip install), rodar testes, buildar, executar scripts, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Comando shell a executar (ex: npm install express, node -v).' },
        timeout_sec: { type: 'NUMBER', description: 'Timeout em segundos (padrão 60, máx 300).', minimum: 1, maximum: 300 },
        cwd: { type: 'STRING', description: 'Subdiretório de trabalho, se diferente da raiz (ex: frontend/).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_dir',
    description: 'Lista arquivos e subdiretórios de forma hierárquica. Ideal para explorar a estrutura antes de criar arquivos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do diretório (padrão: ".")' },
        depth: { type: 'NUMBER', description: 'Profundidade de subníveis a listar (padrão 2, máx 5).', minimum: 1, maximum: 5 },
        exclude: { type: 'ARRAY', description: 'Nomes de pastas/arquivos a ignorar.' },
      },
    },
  },
];

const SYSTEM_INSTRUCTION = `Você é um agente autônomo de programação de nível SÊNIOR, estilo TiAi IA.
Diretório de trabalho: ${WORK_DIR}.

=== MANIFESTO DE COMPORTAMENTO (NUNCA SAIA DESSE PADRÃO) ===

1. PENSAMENTO CONCISO (1-2 linhas máximo). Seja direto, objetivo.
   NUNCA escreva parágrafos longos de "vou fazer isso, depois aquilo".
   Exemplo BOM: "Listarei a pasta, então criarei index.html completo."
   Exemplo RUIM: "Olá! Vou começar analisando os requisitos que você pediu..."

2. AÇÃO DIRETA. Não peça permissão. Planeje internamente e execute.
   Não faça: "Posso criar o arquivo agora?"
   Faça: Crie o arquivo.

3. CÓDIGO COMPLETO. NUNCA envie trechos. NUNCA use "...", "// restante igual", "TODO".
   O usuário deve poder copiar o arquivo gerado e rodar SEM alterações.

4. VALIDAÇÃO PRÓ-ATIVA. Depois de escrever código, VALIDE:
   - Projetos Node: instale deps, rode build/test.
   - HTML/CSS: confirme que não há placeholders vazios.
   - Python: execute o script pelo menos uma vez.
   - APIs: teste um curl POST/GET.

5. AUTO-CORREÇÃO. Se uma ferramenta retornar erro:
   - LEIA o erro (não ignore).
   - Corrija o código.
   - Re-tente no máximo 3x antes de pedir ajuda.

6. FLUXO PADRÃO (passos 0-5 internos):
   Passo 0 — list_dir para entender a estrutura atual.
   Passo 1 — Planeje (na cabeça, não escreva um texto longo).
   Passo 2 — Crie/atualize arquivos com write_file (COMPLETO).
   Passo 3 — Instale dependências se houver (npm install, pip, etc).
   Passo 4 — Valide (build, test, execute).
   Passo 5 — Resumo final curto.

=== REGRAS DE ARQUITETURA ===
- Separe responsabilidades: rotas, modelos, controllers, middlewares quando fizer sentido.
- Prefira Tailwind CSS via CDN para protótipos HTML (como pedido).
- Use boas práticas: sem segredos hardcoded, tratamento de erros, tipagens razoáveis.
- SEMPRE valide caminhos — nunca escreva fora do diretório de trabalho.

=== COMUNICAÇÃO ===
- Fale em português.
- Sem títulos gigantes, sem emojis excessivos.
- Ao finalizar: um resumo curto com (a) objetivo atingido, (b) arquivos criados/alterados, (c) como rodar.
- Quando a tarefa estiver 100% pronta e validada, PARE de chamar ferramentas.

Boa sorte — seja rápido e correto.`;

async function genAIStream(contents, onChunk) {
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GOOGLE_MODEL}:streamGenerateContent?key=${GOOGLE_API_KEY}&alt=sse`;
  const body = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.15, topP: 0.95, maxOutputTokens: 16384 },
  };

  let retries = 0;
  while (retries <= 2) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if ((res.status === 429 || res.status >= 500) && retries < 2) {
        retries++;
        await new Promise(r => setTimeout(r, 500 * retries * retries));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 250)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let combined = { textParts: [], funcCallParts: [], thoughtSignature: undefined };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }
          const candidate = parsed?.candidates?.[0];
          if (!candidate) continue;
          if (candidate.thoughtSignature) combined.thoughtSignature = candidate.thoughtSignature;
          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (typeof part.text === 'string') {
              combined.textParts.push(part.text);
              if (onChunk) onChunk({ type: 'text', delta: part.text });
            }
            if (part.functionCall) {
              combined.funcCallParts.push(part);
              if (onChunk) onChunk({ type: 'fn', call: part.functionCall });
            }
          }
        }
      }
      const lastText = combined.textParts.join('');
      return {
        text: lastText,
        functionCalls: combined.funcCallParts,
        thoughtSignature: combined.thoughtSignature,
        finishReason: 'OK',
      };
    } catch (err) {
      if (retries < 2 && (err.name === 'TimeoutError' || /429|5\d\d/.test(err.message))) {
        retries++;
        await new Promise(r => setTimeout(r, 700 * retries));
        continue;
      }
      throw err;
    }
  }
}

async function runAgentLoop(userPrompt, onStream) {
  const contents = [{ role: 'user', parts: [{ text: userPrompt }] }];

  for (let step = 1; step <= MAX_STEPS; step++) {
    log('PASSO', `${step}/${MAX_STEPS}`, COLORS.info);

    let aiText = '';
    let streamResp;
    try {
      streamResp = await genAIStream(contents, (chunk) => {
        if (chunk.type === 'text' && chunk.delta) {
          aiText += chunk.delta;
          process.stdout.write(`${COLORS.ai}${chunk.delta}${COLORS.reset}`);
          if (onStream) onStream({ step, ...chunk });
        }
      });
      if (aiText && !aiText.endsWith('\n')) process.stdout.write('\n');
    } catch (err) {
      log('ERRO', `Chamada à API falhou: ${err.message}`, COLORS.error);
      return;
    }

    const textReply = streamResp.text;
    const funcCalls = streamResp.functionCalls;

    if (textReply && aiText === '') log('IA', textReply, COLORS.ai);
    if (streamResp.thoughtSignature && !textReply && funcCalls.length === 0) {
      log('INFO', '(modelo gerou apenas raciocínio interno)', COLORS.dim);
    }

    if (!funcCalls || funcCalls.length === 0) {
      if (streamResp.finishReason === 'OK' || textReply) {
        log('CONCLUÍDO', 'Tarefa finalizada com sucesso.', COLORS.result);
      } else {
        log('INFO', `Finalizado por motivo: ${streamResp.finishReason || 'desconhecido'}`, COLORS.warn);
      }
      return;
    }

    const modelParts = [];
    if (textReply) modelParts.push({ text: textReply });
    modelParts.push(...funcCalls);
    contents.push({ role: 'model', parts: modelParts });

    const responseParts = [];
    for (const fc of funcCalls) {
      const call = fc.functionCall;
      const name = call.name;
      const args = call.args || {};
      const argsPreview = JSON.stringify(args).replace(/[\n\r]/g, ' ').slice(0, 220);
      log('FERRAMENTA', `${name}(${argsPreview})`, COLORS.func);

      const toolFn = TOOLS[name];
      let result;
      if (!toolFn) {
        result = { ok: false, error: `Ferramenta desconhecida: ${name}` };
      } else {
        try {
          result = await toolFn(args);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
      }

      const preview = JSON.stringify(result).replace(/[\n\r]/g, ' ').slice(0, 320);
      log(result.ok ? 'OK' : 'FALHA', preview, result.ok ? COLORS.result : COLORS.error);

      responseParts.push({
        functionResponse: {
          name,
          id: call.id,
          response: result,
        },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  log('LIMITE', `Número máximo de passos (${MAX_STEPS}) atingido.`, COLORS.error);
}

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, answer => resolve(answer)));
}

async function main() {
  if (!GOOGLE_API_KEY || GOOGLE_API_KEY.includes('sua_chave')) {
    log('ERRO', 'GOOGLE_API_KEY não definida. Preencha o arquivo .env.', COLORS.error);
    process.exit(1);
  }

  await ensureWorkDir();

  console.log(`
${COLORS.bright}╔════════════════════════════════════════════════════════╗
║        AGENTE AUTÔNOMO · CLI · ESTILO TIAI IA         ║
╠════════════════════════════════════════════════════════╣
║  Modelo  : ${GOOGLE_MODEL.padEnd(41)}║
║  Workdir : ${(WORK_DIR.length > 41 ? WORK_DIR.slice(0, 38) + '...' : WORK_DIR).padEnd(41)}║
║  Passos  : ${String(MAX_STEPS).padEnd(41)}║
╚════════════════════════════════════════════════════════╝${COLORS.reset}
 ${COLORS.dim}Comandos:  sair  ·  limpar  ·  help${COLORS.reset}
`);

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    const input = await question(rl, `\n${COLORS.user}${COLORS.bright}Você > ${COLORS.reset}`);
    const trimmed = input.trim();
    if (!trimmed) continue;
    if (['sair', 'exit', 'quit', 'q'].includes(trimmed.toLowerCase())) {
      console.log('Até logo! 👋');
      rl.close();
      process.exit(0);
    }
    if (['limpar', 'clear', 'cls'].includes(trimmed.toLowerCase())) {
      console.clear();
      continue;
    }
    if (['help', 'ajuda', '?'].includes(trimmed.toLowerCase())) {
      console.log(`
${COLORS.bright}5 FERRAMENTAS DISPONÍVEIS:${COLORS.reset}
  ${COLORS.func}• read_file${COLORS.reset} path                — Lê arquivo completo
  ${COLORS.func}• write_file${COLORS.reset} path + content       — Cria/atualiza arquivo (COMPLETO)
  ${COLORS.func}• delete_file${COLORS.reset} path [recursive]    — Remove arquivo/pasta
  ${COLORS.func}• run_command${COLORS.reset} cmd [timeout,cwd]   — Executa comando shell
  ${COLORS.func}• list_dir${COLORS.reset}    [path,depth]        — Lista árvore de diretórios
`);
      continue;
    }
    try {
      await runAgentLoop(trimmed);
    } catch (err) {
      const msg = err.stack || err.message;
      log('FATAL', msg, COLORS.error);
    }
  }
}

main().catch(err => {
  const msg = err.stack || err.message;
  console.log(`${COLORS.error}${COLORS.bright}FATAL${COLORS.reset}${COLORS.error} ${msg}${COLORS.reset}`);
  process.exit(1);
});
