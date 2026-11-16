/* =========================================================
 * youtube/providers/index.js — Registro de provedores OAuth
 * ---------------------------------------------------------
 * Mapeia o id da rede (igual ao de platforms.js) para o módulo
 * provedor que implementa o fluxo oficial. O YouTube NÃO está aqui:
 * ele é tratado pelo caminho nativo já existente (oauth.js/client.js),
 * preservando 100% do comportamento atual.
 * =======================================================*/
import * as instagram from './instagram.js';
import * as tiktok from './tiktok.js';

const REGISTRY = { instagram, tiktok };

export function providerFor(platform) {
  return REGISTRY[String(platform || '').trim().toLowerCase()] || null;
}

export function isProviderPlatform(platform) {
  return !!providerFor(platform);
}

export function providerIds() {
  return Object.keys(REGISTRY);
}

export default { providerFor, isProviderPlatform, providerIds };
