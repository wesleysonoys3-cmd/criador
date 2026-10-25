// remote-agent/sandbox.mjs · Isolamento de workspace / path safety
// NÃO é sandbox forte (docker/jails). Implementa isolamento de diretório + allowlist.
// Limitação documentada: sem cgroups, sem namespaces; proteção a nível de path prefix + allowlist.

import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from './config.mjs';

export function resolveSafeWorkspace(workspaceName) {
  const name = String(workspaceName || '').trim().replace(/[^\w.\-]/g, '');
  if (!name) throw new Error('SANDBOX: workspace name inválido');
  if (CONFIG.allowedWorkspaces.size > 0 && !CONFIG.allowedWorkspaces.has('*') && !CONFIG.allowedWorkspaces.has(name)) {
    throw new Error('SANDBOX: workspace não autorizado: ' + name);
  }
  const root = path.resolve(CONFIG.workspaceRoot);
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('SANDBOX: path traversal detectado (fora de workspaceRoot)');
  }
  // Garante criação inicial do diretório autorizado:
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return Object.freeze({
    name,
    path: target,
    root,
  });
}

export function safeJoin(workspacePath, ...parts) {
  const base = path.resolve(String(workspacePath || ''));
  const candidate = path.resolve(base, ...parts);
  const root = path.resolve(CONFIG.workspaceRoot);
  if (!candidate.startsWith(root + path.sep) && candidate !== root) {
    throw new Error('SANDBOX: path fora de workspaceRoot: ' + candidate);
  }
  if (!candidate.startsWith(base + path.sep) && candidate !== base) {
    throw new Error('SANDBOX: path fora do workspace autorizado (traversal detectado): ' + candidate);
  }
  return candidate;
}

// Validação forte de comandos permitidos NÃO aceitando shell arbitrário
export function assertCommandSafe(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('SANDBOX: argv vazio');
  const binary = path.basename(String(argv[0]));
  // Allowlist explícita. NÃO permitimos shell genérico (bash/sh/zsh).
  const SAFE_BINARIES = new Set([
    'node','npm','npx','jest','pnpm','yarn','tsc','eslint','prettier',
    'python3','python','uv','ruff','pytest','git',
    process.platform === 'win32' ? 'node.exe' : null,
  ].filter(Boolean));
  if (!SAFE_BINARIES.has(binary)) {
    throw new Error('SANDBOX: binário não permitido: ' + binary);
  }
  // Flags proibidas: -e / --eval do node (execução arbitrária em string)
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i]);
    if (/^(--eval=?|--print=?|-e\s*|-p\s*|-c\s*)/i.test(a)) {
      throw new Error('SANDBOX: flag proibida detectada: ' + a.slice(0, 40));
    }
    // NÃO permitimos redirecionamentos/pipes na argv (deve ser invocado via spawn sem shell)
    if (/[|&;`<>()$]/.test(a)) throw new Error('SANDBOX: metacaracter proibido no argumento');
  }
  return true;
}

export const SANDBOX_LIMITATIONS = Object.freeze({
  forte:       false,
  descricao:   'Isolamento de diretório + allowlist de workspaces + allowlist binários. Não usa cgroups, namespaces, containers.',
  necessario:  'Para isolamento forte: Docker (--cap-drop), Firejail, ou systemd-nspawn como wrapper externo futuro.',
});
