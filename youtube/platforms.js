/* =========================================================
 * youtube/platforms.js — Catálogo de redes sociais (PARTE 9 do AutoClips)
 * ---------------------------------------------------------
 * Fonte única de verdade sobre QUAIS redes o AutoClips tenta conectar,
 * com quais escopos, quais variáveis de ambiente são exigidas e se a
 * integração oficial já está implementada NESTE projeto.
 *
 * Regra do projeto (não simular):
 *   - "oauthImplemented: true" significa que o fluxo OAuth oficial foi
 *     realmente implementado aqui e funciona assim que as credenciais
 *     existirem no ambiente.
 *   - Caso contrário, a interface mostra o requisito real da plataforma
 *     (app aprovado, permissões, tipo de conta) sem prometer conexão.
 *
 * Nada aqui chama API externa: é apenas o mapa de capacidades.
 * =======================================================*/

export const PLATFORMS = [
  {
    id: 'youtube',
    label: 'YouTube',
    oauthImplemented: true,
    envVars: ['YT_CLIENT_ID', 'YT_CLIENT_SECRET'],
    scopes: ['youtube.upload', 'youtube.readonly'],
    multiAccount: true,
    accountKind: 'canal',
    publishNote: 'Envio direto de vídeo pela YouTube Data API v3 (upload resumable) para o canal conectado.',
    requirement: 'App OAuth no Google Cloud com as APIs YouTube Data API v3 habilitadas.',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    oauthImplemented: true,
    envVars: ['IG_CLIENT_ID', 'IG_CLIENT_SECRET'],
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    multiAccount: true,
    accountKind: 'conta profissional (Business/Creator)',
    publishNote: 'Reels via Instagram API with Instagram Login. A publicação exige o vídeo em URL pública e app Meta com a permissão de publicação aprovada.',
    requirement: 'App Meta (Instagram API) com IG_CLIENT_ID/IG_CLIENT_SECRET, conta Business/Creator e permissão instagram_business_content_publish aprovada.',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    oauthImplemented: true,
    envVars: ['TT_CLIENT_KEY', 'TT_CLIENT_SECRET'],
    scopes: ['user.info.basic', 'video.publish'],
    multiAccount: true,
    accountKind: 'conta TikTok',
    publishNote: 'Upload direto (FILE_UPLOAD) pela Content Posting API. App não auditado só publica como privado (SELF_ONLY).',
    requirement: 'App TikTok for Developers com TT_CLIENT_KEY/TT_CLIENT_SECRET e produto Content Posting API aprovado (auditoria).',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    oauthImplemented: false,
    envVars: ['FB_CLIENT_ID', 'FB_CLIENT_SECRET'],
    scopes: ['pages_manage_posts', 'pages_read_engagement'],
    multiAccount: true,
    accountKind: 'página',
    publishNote: 'Publicação em Páginas via Graph API exige permissões revisadas pela Meta.',
    requirement: 'App Meta aprovado + permissões de página. Não implementado neste projeto.',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    oauthImplemented: false,
    envVars: ['LI_CLIENT_ID', 'LI_CLIENT_SECRET'],
    scopes: ['w_member_social', 'r_liteprofile'],
    multiAccount: true,
    accountKind: 'perfil/organização',
    publishNote: 'Publicação via LinkedIn Marketing/Share API; vídeo nativo exige permissões específicas.',
    requirement: 'App LinkedIn aprovado com escopo de compartilhamento. Não implementado neste projeto.',
  },
  {
    id: 'x',
    label: 'X',
    oauthImplemented: false,
    envVars: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    scopes: ['tweet.write', 'users.read'],
    multiAccount: true,
    accountKind: 'conta',
    publishNote: 'Publicação de mídia pela X API v2 (OAuth 2.0 PKCE); exige acesso pago/plano adequado.',
    requirement: 'App X aprovado com escopo de escrita. Não implementado neste projeto.',
  },
];

export function byId(id) {
  const s = String(id || '').trim().toLowerCase();
  return PLATFORMS.find((p) => p.id === s) || null;
}

/* Forma pública (sem campos internos) para o frontend. */
export function list() {
  return PLATFORMS.map((p) => ({
    id: p.id,
    label: p.label,
    oauthImplemented: !!p.oauthImplemented,
    envVars: p.envVars.slice(),
    scopes: p.scopes.slice(),
    multiAccount: p.multiAccount !== false,
    accountKind: p.accountKind,
    publishNote: p.publishNote,
    requirement: p.requirement,
  }));
}

export function implementedIds() {
  return PLATFORMS.filter((p) => p.oauthImplemented).map((p) => p.id);
}

export default { PLATFORMS, byId, list, implementedIds };
