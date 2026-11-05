/* =========================================================
 * curriculos/render.js — Blocos, HTML (7 modelos) e PDF
 * ---------------------------------------------------------
 * Os "blocks" são a única fonte de verdade: alimentam o DOCX (docx.js)
 * e o HTML/PDF. Assim PDF, DOCX e pré-visualização ficam idênticos.
 * =======================================================*/
import { normalizeProfile, resolveSectionOrder, SECTION_DEFS, TEMPLATES } from './profile.js';

export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const s = (v) => String(v === null || v === undefined ? '' : v).trim();

function dateRange(x) {
  const start = s(x.start), end = x.current ? 'Atual' : s(x.end);
  if (!start && !end) return '';
  return [start, end].filter(Boolean).join(' – ');
}

/** Converte o perfil em blocos neutros (compartilhados por PDF e DOCX). */
export function buildBlocks(profile, { templateId = 'moderno', sectionOrder = null } = {}) {
  const p = normalizeProfile(profile);
  const order = Array.isArray(sectionOrder) && sectionOrder.length ? sectionOrder : resolveSectionOrder(p, templateId);
  const blocks = [];

  blocks.push({ type: 'title', text: p.fullName || 'Currículo' });
  if (p.headline) blocks.push({ type: 'subtitle', text: p.headline });

  const contacts = [p.email, p.phone, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean);
  if (contacts.length) blocks.push({ type: 'contact', text: contacts.join('  ·  ') });
  if (p.links?.length) blocks.push({ type: 'contact', text: p.links.map(l => (l.label && l.label !== 'Link' ? `${l.label}: ${l.url}` : l.url)).join('  ·  ') });

  const sections = {
    resumo: () => {
      if (!p.summary) return null;
      return { title: 'Resumo Profissional', blocks: [{ type: 'p', text: p.summary }] };
    },
    objetivo: () => {
      if (!p.objective) return null;
      return { title: 'Objetivo', blocks: [{ type: 'p', text: p.objective }] };
    },
    experiencia: () => {
      if (!p.experiences.length) return null;
      const out = [];
      for (const e of p.experiences) {
        const head = [e.role, e.company].filter(Boolean).join(' — ');
        out.push({ type: 'h2', text: head || e.company });
        const meta = [dateRange(e), e.location].filter(Boolean).join('  ·  ');
        if (meta) out.push({ type: 'meta', text: meta });
        for (const b of e.bullets) out.push({ type: 'bullet', text: b });
        for (const r of e.results) out.push({ type: 'bullet', text: r });
        if (e.technologies?.length) out.push({ type: 'meta', text: 'Tecnologias: ' + e.technologies.join(', ') });
      }
      return { title: 'Experiência Profissional', blocks: out };
    },
    projetos: () => {
      if (!p.projects.length) return null;
      const out = [];
      for (const pr of p.projects) {
        out.push({ type: 'h2', text: pr.name || 'Projeto' });
        if (pr.description) out.push({ type: 'p', text: pr.description });
        for (const b of pr.bullets) out.push({ type: 'bullet', text: b });
        if (pr.link) out.push({ type: 'meta', text: pr.link });
      }
      return { title: 'Projetos', blocks: out };
    },
    formacao: () => {
      if (!p.education.length) return null;
      const out = [];
      for (const e of p.education) {
        out.push({ type: 'h2', text: [e.course, e.institution].filter(Boolean).join(' — ') });
        const meta = [[e.level, e.status].filter(Boolean).join(' · '), dateRange(e)].filter(Boolean).join('  ·  ');
        if (meta) out.push({ type: 'meta', text: meta });
      }
      return { title: 'Formação Acadêmica', blocks: out };
    },
    cursos: () => {
      const items = [
        ...p.courses.map(c => [c.name, [c.institution, c.year, c.hours].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')),
        ...p.certifications.map(c => [c.name, [c.issuer, c.year].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')),
      ].filter(Boolean);
      if (!items.length) return null;
      return { title: 'Cursos e Certificações', blocks: items.map(t => ({ type: 'bullet', text: t })) };
    },
    competencias: () => {
      const list = [...p.skills.technical, ...p.skills.tools];
      if (!list.length) return null;
      return { title: 'Competências Técnicas', blocks: [{ type: 'p', text: list.join(' • ') }] };
    },
    comportamentais: () => {
      if (!p.skills.behavioral.length) return null;
      return { title: 'Habilidades Comportamentais', blocks: [{ type: 'p', text: p.skills.behavioral.join(' • ') }] };
    },
    idiomas: () => {
      if (!p.languages.length) return null;
      return { title: 'Idiomas', blocks: [{ type: 'p', text: p.languages.map(l => (l.level ? `${l.name} — ${l.level}` : l.name)).join(' • ') }] };
    },
    resultados: () => {
      if (!p.achievements.length) return null;
      return { title: 'Resultados e Conquistas', blocks: p.achievements.map(t => ({ type: 'bullet', text: t })) };
    },
  };

  const usedTitles = new Set();
  for (const id of order) {
    const fn = sections[id];
    if (!fn) continue;
    const section = fn();
    if (!section) continue;
    if (usedTitles.has(section.title)) continue;
    usedTitles.add(section.title);
    blocks.push({ type: 'h1', text: section.title });
    blocks.push(...section.blocks);
  }

  return blocks;
}

/* ---------------- Modelos visuais ---------------- */
const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; color: #1f2937; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 15mm; margin: 0 auto; background: #fff; }
  .title { font-size: 22pt; font-weight: 800; line-height: 1.15; margin: 0 0 2mm; letter-spacing: -0.2pt; }
  .subtitle { font-size: 11.5pt; font-weight: 600; margin: 0 0 1.5mm; }
  .contact { font-size: 9.5pt; color: #4b5563; margin: 0 0 1mm; word-break: break-word; }
  .header-rule { height: 2px; margin: 3mm 0 4mm; }
  h1.section { font-size: 11pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6pt; margin: 5mm 0 2mm; padding-bottom: 1mm; page-break-after: avoid; }
  h2.item { font-size: 10.5pt; font-weight: 700; margin: 3mm 0 0.5mm; page-break-after: avoid; }
  .meta { font-size: 9pt; color: #6b7280; margin: 0 0 1.2mm; }
  p.body { font-size: 10pt; line-height: 1.5; margin: 0 0 1.5mm; text-align: justify; }
  ul { margin: 0 0 1.5mm; padding-left: 5mm; }
  li { font-size: 10pt; line-height: 1.45; margin-bottom: 0.8mm; }
  .block { page-break-inside: avoid; }
  @page { size: A4; margin: 12mm 10mm; }
  @media print { .page { width: auto; min-height: auto; padding: 0; } }
`;

const THEMES = {
  moderno: { accent: '#4c1d95', titleColor: '#4c1d95', font: "'Segoe UI', Arial, sans-serif", rule: true, headerAlign: 'left' },
  executivo: { accent: '#1f2937', titleColor: '#111827', font: "Georgia, 'Times New Roman', serif", rule: true, headerAlign: 'left' },
  minimalista: { accent: '#111827', titleColor: '#000000', font: 'Arial, Helvetica, sans-serif', rule: false, headerAlign: 'left' },
  'primeiro-emprego': { accent: '#0e7490', titleColor: '#0e7490', font: "'Segoe UI', Arial, sans-serif", rule: true, headerAlign: 'left' },
  tecnico: { accent: '#0f766e', titleColor: '#0f766e', font: "'Segoe UI', Arial, sans-serif", rule: true, headerAlign: 'left' },
  academico: { accent: '#1e3a8a', titleColor: '#1e3a8a', font: "Georgia, 'Times New Roman', serif", rule: true, headerAlign: 'left' },
  criativo: { accent: '#db2777', titleColor: '#ffffff', font: "'Segoe UI', Arial, sans-serif", rule: false, headerAlign: 'left', headerBlock: '#db2777' },
};

/** Gera o HTML completo (pré-visualização e base do PDF). */
export function renderHtml(profile, { templateId = 'moderno', sectionOrder = null, forPrint = true } = {}) {
  const theme = THEMES[templateId] || THEMES.moderno;
  const blocks = buildBlocks(profile, { templateId, sectionOrder });
  const parts = [];
  let headerOpen = false;

  const inHeaderBlock = !!theme.headerBlock;

  for (const b of blocks) {
    if (b.type === 'title' || b.type === 'subtitle' || b.type === 'contact') {
      if (inHeaderBlock && !headerOpen) { parts.push(`<div class="head-block">`); headerOpen = true; }
      if (b.type === 'title') parts.push(`<div class="title">${escapeHtml(b.text)}</div>`);
      else if (b.type === 'subtitle') parts.push(`<div class="subtitle">${escapeHtml(b.text)}</div>`);
      else parts.push(`<div class="contact">${escapeHtml(b.text)}</div>`);
      continue;
    }
    if (headerOpen) {
      parts.push('</div>');
      if (theme.rule) parts.push(`<div class="header-rule"></div>`);
      headerOpen = false;
    }
    if (b.type === 'h1') parts.push(`<h1 class="section">${escapeHtml(b.text)}</h1>`);
    else if (b.type === 'h2') parts.push(`<h2 class="item">${escapeHtml(b.text)}</h2>`);
    else if (b.type === 'meta') parts.push(`<div class="meta">${escapeHtml(b.text)}</div>`);
    else if (b.type === 'bullet') parts.push(`<ul><li>${escapeHtml(b.text)}</li></ul>`);
    else parts.push(`<p class="body">${escapeHtml(b.text)}</p>`);
  }
  if (headerOpen) { parts.push('</div>'); if (theme.rule) parts.push(`<div class="header-rule"></div>`); }

  const css = `
  ${BASE_CSS}
  body { font-family: ${theme.font}; }
  .title { color: ${theme.titleColor}; text-align: ${theme.headerAlign}; }
  .subtitle { color: ${theme.accent}; }
  .header-rule { background: ${theme.accent}; }
  h1.section { color: ${theme.accent}; border-bottom: 1px solid ${theme.accent}44; }
  h2.item { color: #111827; }
  .head-block { background: ${theme.headerBlock || 'transparent'}; padding: ${theme.headerBlock ? '6mm 5mm' : '0'}; margin-bottom: ${theme.headerBlock ? '4mm' : '0'}; }
  .head-block .title, .head-block .subtitle, .head-block .contact { color: ${theme.headerBlock ? '#ffffff' : 'inherit'}; }
  `;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(normalizeProfile(profile).fullName || 'Currículo')}</title>
<style>${css}</style></head>
<body${forPrint ? '' : ' class="screen"'}><div class="page">${parts.join('\n')}</div></body></html>`;
}

/* ---------------- PDF ---------------- */
let _browserPromise = null;

async function getBrowser() {
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    const { chromium } = await import('playwright');
    return chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  })().catch((e) => { _browserPromise = null; throw e; });
  return _browserPromise;
}

export async function closeBrowser() {
  if (!_browserPromise) return;
  try { const b = await _browserPromise; await b.close(); } catch {}
  _browserPromise = null;
}

/** Converte o HTML do currículo em PDF real (A4, acentos, margens e quebras). */
export async function htmlToPdf(html) {
  let browser;
  try { browser = await getBrowser(); }
  catch (e) {
    return { ok: false, error: 'Gerador de PDF indisponível no servidor (navegador de renderização ausente).', detail: String(e?.message || e) };
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
      preferCSSPageSize: false,
    });
    return { ok: true, buffer: buf };
  } catch (e) {
    return { ok: false, error: 'Falha ao gerar o PDF.', detail: String(e?.message || e) };
  } finally {
    try { await page.close(); } catch {}
    try { await ctx.close(); } catch {}
  }
}

export function templateList() {
  return TEMPLATES.map(t => ({ id: t.id, name: t.name, desc: t.desc }));
}

export default { buildBlocks, renderHtml, htmlToPdf, templateList, closeBrowser, escapeHtml, SECTION_DEFS };
