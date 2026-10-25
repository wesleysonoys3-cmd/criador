// test_groq_tool_schema.mjs · correção Groq HTTP 400 INVALID JSON SCHEMA TOOLS
// Objetivo: confirmar que normalizeToolSchemaForOpenAI / normalizeToolsForGroq
// produzem só tipos lowercase válidos do JSON Schema / OpenAI compat.
//
// Como rodar:
//   ./node-v22.14.0-darwin-x64/bin/node test_groq_tool_schema.mjs > /tmp/groq_ts.log 2>&1; echo EXIT=$?; cat /tmp/groq_ts.log

const TESTS = [];
function T(name, fn) { TESTS.push({ name, fn }); }
let pass = 0, fail = 0;

// Inline igual ao server.js:
const _OPENAI_TYPE_MAP = Object.freeze({
  'OBJECT':'object','STRING':'string','NUMBER':'number','INTEGER':'integer',
  'BOOLEAN':'boolean','ARRAY':'array','NULL':'null'
});
function normalizeToolSchemaForOpenAI(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(s => normalizeToolSchemaForOpenAI(s));
  const out = Object.assign({}, schema);
  if (typeof out.type === 'string') out.type = _OPENAI_TYPE_MAP[out.type] || (out.type.length ? out.type.toLowerCase() : out.type);
  if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    const newProps = {};
    for (const k of Object.keys(out.properties)) newProps[k] = normalizeToolSchemaForOpenAI(out.properties[k]);
    out.properties = newProps;
  }
  if ('items' in out) out.items = normalizeToolSchemaForOpenAI(out.items);
  if ('additionalProperties' in out && typeof out.additionalProperties === 'object') out.additionalProperties = normalizeToolSchemaForOpenAI(out.additionalProperties);
  if (Array.isArray(out.required)) out.required = out.required.slice();
  if (out.anyOf && Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(normalizeToolSchemaForOpenAI);
  if (out.oneOf && Array.isArray(out.oneOf)) out.oneOf = out.oneOf.map(normalizeToolSchemaForOpenAI);
  if (out.allOf && Array.isArray(out.allOf)) out.allOf = out.allOf.map(normalizeToolSchemaForOpenAI);
  return out;
}
function normalizeToolsForGroq(toolDeclarations) {
  if (!Array.isArray(toolDeclarations) || toolDeclarations.length === 0) return [];
  return toolDeclarations.map(td => {
    const params = normalizeToolSchemaForOpenAI((td && td.parameters && typeof td.parameters === 'object') ? td.parameters : {});
    return {
      type: 'function',
      function: {
        name: String((td && td.name) || ''),
        description: (td && typeof td.description === 'string') ? td.description : '',
        parameters: params,
      }
    };
  });
}

function allTypesLower(obj, path = '') {
  if (!obj || typeof obj !== 'object') return [];
  const errors = [];
  if (Array.isArray(obj)) { obj.forEach((o,i) => errors.push(...allTypesLower(o, `${path}[${i}]`))); return errors; }
  if (typeof obj.type === 'string') {
    if (obj.type !== obj.type.toLowerCase()) errors.push(`[${path || 'root'}].type="${obj.type}" não é lowercase`);
  }
  if (obj.properties && typeof obj.properties === 'object') {
    for (const k of Object.keys(obj.properties)) errors.push(...allTypesLower(obj.properties[k], `${path}.properties.${k}`));
  }
  if ('items' in obj) errors.push(...allTypesLower(obj.items, `${path}.items`));
  if (typeof obj.additionalProperties === 'object') errors.push(...allTypesLower(obj.additionalProperties, `${path}.additionalProperties`));
  ['anyOf','oneOf','allOf'].forEach(k => { if (Array.isArray(obj[k])) obj[k].forEach((o,i) => errors.push(...allTypesLower(o, `${path}.${k}[${i}]`))); });
  return errors;
}

// ====== Fixtures no estilo GEMINI (uppercase types) ======
const T_READ_FILE = {
  name: 'read_file',
  description: 'Lê o conteúdo de um arquivo de texto dentro do diretório de trabalho.',
  parameters: {
    type: 'OBJECT',
    properties: { path: { type: 'STRING', description: 'Caminho relativo do arquivo.' } },
    required: ['path'],
  },
};
const T_WITH_STRING = {
  name: 'search_docs',
  description: 'Busca docs.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, lang: { type: 'string' } }, required: ['query'] },
};
const T_NESTED_OBJ = {
  name: 'complex_config',
  parameters: {
    type: 'OBJECT',
    properties: {
      db: { type: 'OBJECT', properties: { host: { type: 'STRING' }, port: { type: 'INTEGER' } } },
      flags: { type: 'OBJECT', properties: { debug: { type: 'BOOLEAN' } } },
    },
    required: ['db'],
  },
};
const T_WITH_ARRAY_ITEMS = {
  name: 'bulk_op',
  parameters: {
    type: 'OBJECT',
    properties: {
      paths: { type: 'ARRAY', items: { type: 'STRING' } },
      matrix: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
    },
    required: ['paths'],
  },
};
const T_REQUIRED = {
  name: 'op_x',
  parameters: { type: 'OBJECT', properties: { a:{type:'STRING'}, b:{type:'INTEGER'}, c:{type:'BOOLEAN'} }, required: ['a','b','c'] },
};
const T_DEEP_NESTED = {
  name: 'deep',
  parameters: {
    type: 'OBJECT',
    properties: {
      level1: {
        type: 'OBJECT',
        properties: {
          level2: {
            type: 'OBJECT',
            properties: {
              tags: { type: 'ARRAY', items: { type: 'STRING' } },
              meta: {
                type: 'OBJECT',
                properties: {
                  score: { type: 'NUMBER' },
                  extra: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, ids: { type: 'ARRAY', items: { type: 'INTEGER' } } } }
                },
                required: ['score'],
              },
            },
            required: ['tags'],
          },
        },
      },
    },
  },
};

T('T1 · read_file gera wrapper {type:"function", function.parameters.type="object"} e path type string', () => {
  const out = normalizeToolsForGroq([T_READ_FILE])[0];
  if (!out || out.type !== 'function') throw new Error('não tem type:function: '+JSON.stringify(out));
  if (!out.function) throw new Error('sem .function: '+JSON.stringify(out));
  if (out.function.name !== 'read_file') throw new Error('name incorreto: '+out.function.name);
  if (!out.function.parameters || out.function.parameters.type !== 'object') throw new Error('parameters.type não é object lowercase: '+out.function.parameters?.type);
  const p = out.function.parameters.properties.path;
  if (!p || p.type !== 'string') throw new Error('path.type não é string lowercase: '+JSON.stringify(p));
  if (!Array.isArray(out.function.parameters.required) || out.function.parameters.required[0] !== 'path') throw new Error('required ausente: '+JSON.stringify(out.function.parameters.required));
  return true;
});

T('T2 · Ferramenta com STRING uppercase e já string lowercase: ambas saem lowercase.', () => {
  const out = normalizeToolsForGroq([T_WITH_STRING])[0];
  if (out.function.parameters.properties.query.type !== 'string') throw new Error('query uppercase não virou lowercase');
  if (out.function.parameters.properties.lang.type !== 'string') throw new Error('lang já lowercase deveria permanecer: '+out.function.parameters.properties.lang.type);
  const errs = allTypesLower(out.function.parameters);
  if (errs.length) throw new Error('tipos com uppercase encontrados: '+errs.join('; '));
  return true;
});

T('T3 · OBJECT aninhado + INTEGER + BOOLEAN → tudo lowercase.', () => {
  const out = normalizeToolsForGroq([T_NESTED_OBJ])[0];
  const errs = allTypesLower(out.function.parameters);
  if (errs.length) throw new Error(errs.join('; '));
  if (out.function.parameters.properties.db.properties.port.type !== 'integer') throw new Error('port não é integer: '+out.function.parameters.properties.db.properties.port.type);
  if (out.function.parameters.properties.flags.properties.debug.type !== 'boolean') throw new Error('debug não é boolean');
  return true;
});

T('T4 · ARRAY + items (incluindo array de arrays de numbers) → tudo lowercase.', () => {
  const out = normalizeToolsForGroq([T_WITH_ARRAY_ITEMS])[0];
  const errs = allTypesLower(out.function.parameters);
  if (errs.length) throw new Error(errs.join('; '));
  if (out.function.parameters.properties.paths.type !== 'array') throw new Error('paths.type não é array');
  if (out.function.parameters.properties.paths.items.type !== 'string') throw new Error('paths items.type não é string');
  if (out.function.parameters.properties.matrix.items.type !== 'array') throw new Error('matrix items.type não é array');
  if (out.function.parameters.properties.matrix.items.items.type !== 'number') throw new Error('matrix.items.items.type não é number');
  return true;
});

T('T5 · required é preservado sem remover itens.', () => {
  const out = normalizeToolsForGroq([T_REQUIRED])[0];
  const req = out.function.parameters.required;
  if (!Array.isArray(req) || req.length !== 3 || req.join(',') !== 'a,b,c') throw new Error('required incorreto: '+JSON.stringify(req));
  const errs = allTypesLower(out.function.parameters);
  if (errs.length) throw new Error(errs.join('; '));
  return true;
});

T('T6 · nesting profundo 3 níveis + ARRAY items + required aninhado.', () => {
  const out = normalizeToolsForGroq([T_DEEP_NESTED])[0];
  const errs = allTypesLower(out.function.parameters);
  if (errs.length) throw new Error(errs.join('; '));
  const deep = out.function.parameters.properties.level1.properties.level2;
  if (deep.properties.tags.type !== 'array' || deep.properties.tags.items.type !== 'string') throw new Error('deep.tags não array<string>');
  if (!Array.isArray(deep.required) || deep.required[0] !== 'tags') throw new Error('deep required ausente');
  if (deep.properties.meta.properties.score.type !== 'number') throw new Error('meta.score não é number');
  if (deep.properties.meta.properties.extra.properties.ok.type !== 'boolean') throw new Error('extra.ok não é boolean');
  if (deep.properties.meta.properties.extra.properties.ids.items.type !== 'integer') throw new Error('extra.ids.items não é integer');
  return true;
});

T('T7 · TOOL_DECLARATIONS real read_file (Gemini OBJECT → OpenAI object). Só pra confirmar usando a estrutura exata do server.js.', () => {
  // Replicar a declaração real do server.js TOOL_DECLARATIONS[0] read_file para garantir
  const REAL_READ_FILE = {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo de texto dentro do diretório de trabalho.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Caminho relativo do arquivo (ex: src/index.js).' } },
      required: ['path'],
    },
  };
  const out = normalizeToolsForGroq([REAL_READ_FILE])[0];
  // Não pode ter nenhum type UPPERCASE em nenhum nível.
  const errs = allTypesLower(out.function.parameters);
  if (errs.length) throw new Error('read_file real ainda tem uppercase: '+errs.join('; '));
  // Ajusta para a estrutura exata do exemplo do usuário:
  const wanted = { type: 'function', function: { name: 'read_file', description: REAL_READ_FILE.description, parameters: { type: 'object', properties: { path: { type: 'string', description: REAL_READ_FILE.parameters.properties.path.description } }, required: ['path'] } } };
  const a = JSON.stringify(out); const b = JSON.stringify(wanted);
  if (a !== b) throw new Error('read_file estrutura final não bate com OpenAI compat: \nATUAL : ' + a + '\nQUERIA: ' + b);
  return true;
});

async function run() {
  for (const t of TESTS) {
    try {
      await t.fn();
      console.log('✅ PASS ' + t.name);
      pass++;
    } catch (e) {
      console.log('❌ FAIL ' + t.name + ' · ' + (e.message || String(e)));
      fail++;
    }
  }
  console.log(`\nResumo GroqToolSchema: ${pass}/${pass+fail} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(e => { console.error('[FATAL]', e); process.exit(1); });
