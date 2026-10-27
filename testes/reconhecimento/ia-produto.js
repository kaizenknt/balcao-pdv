/* IA para reconhecer produtos nos pedidos (usada pelo Balcão PDV e pela Ficha de Pesagem; o mesmo arquivo nos dois apps).
   1) Local, sem internet e de graça: um modelo pequeno de frases (multilingue) roda no próprio computador e compara o texto
      do pedido com os nomes dos produtos. Só reordena os candidatos que o casamento normal já achou (ou acha parecidos quando
      ele não achou nada) e nunca dá "certeza": o que ele sugere vai como "confira".
      O modelo é baixado uma vez (com progresso e conferência do sha256) para a pasta de dados do app; sem ele tudo continua igual.
   2) Na nuvem, opcional e desligada: com a chave da Anthropic que o dono põe em Ajustes, só as linhas em dúvida vão para o
      Claude junto com os nomes dos 10 candidatos. Vai SÓ o texto do item e os nomes dos produtos (nada do cliente: nome,
      telefone, endereço). Tempo máximo 5 s; se não responder, fica como estava. A resposta volta como "sugerido pela IA". */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

/* ---------- arquivos do modelo local (versões fixas, conferidas pelo sha256) ---------- */
const MODELO = {
  id: 'multilingual-e5-small-q8',
  prefixo: 'query: ',
  arquivos: [
    { nome: 'model_quantized.onnx', url: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx/model_quantized.onnx', sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193', tamanho: 118308185 },
    { nome: 'tokenizer.json', url: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/tokenizer.json', sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39', tamanho: 17082730 },
    { nome: 'ort.wasm.min.js', url: 'https://raw.githubusercontent.com/kaizenknt/balcao-pdv/main/ia/onnxruntime-web-1.20.1/ort.wasm.min.js', reserva: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.js', sha256: 'e66568724f8848e57cc2a56e4bea3a5b86ce3ff81b2da11eac8ed7ab02b27bd4', tamanho: 49026 },
    { nome: 'ort-wasm-simd-threaded.mjs', url: 'https://raw.githubusercontent.com/kaizenknt/balcao-pdv/main/ia/onnxruntime-web-1.20.1/ort-wasm-simd-threaded.mjs', reserva: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.mjs', sha256: '745eb7c0ce6f18a6aa521971b2877babc7ffb27eecb58ab3bc6e5ef4692672e8', tamanho: 24618 },
    { nome: 'ort-wasm-simd-threaded.wasm', url: 'https://raw.githubusercontent.com/kaizenknt/balcao-pdv/main/ia/onnxruntime-web-1.20.1/ort-wasm-simd-threaded.wasm', reserva: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.wasm', sha256: '207d02be4591c156b0a98f024f3d58005b5b04c92274d759fb390338c63559ea', tamanho: 11246032 }
  ]
};

/* ---------- separador de palavras do modelo (SentencePiece "unigram") ---------- */
function criarTokenizador(json) {
  const vocab = json.model.vocab, mapa = new Map();
  let maxLen = 1;
  vocab.forEach(([p, s], id) => { if (id < 4) return; mapa.set(p, [id, s]); if (p.length > maxLen) maxLen = p.length; });
  maxLen = Math.min(maxLen, 24);
  const UNK = json.model.unk_id != null ? json.model.unk_id : 3;
  function palavra(w, out) {
    const n = w.length, melhor = new Float64Array(n + 1).fill(-Infinity), de = new Int32Array(n + 1), qual = new Int32Array(n + 1);
    melhor[0] = 0;
    for (let i = 0; i < n; i++) {
      if (melhor[i] === -Infinity) continue;
      let algum = false;
      for (let j = i + 1; j <= Math.min(n, i + maxLen); j++) {
        const x = mapa.get(w.slice(i, j)); if (!x) continue; algum = algum || j === i + 1;
        const s = melhor[i] + x[1]; if (s > melhor[j]) { melhor[j] = s; de[j] = i; qual[j] = x[0]; }
      }
      if (!algum && melhor[i] - 20 > melhor[i + 1]) { melhor[i + 1] = melhor[i] - 20; de[i + 1] = i; qual[i + 1] = UNK; }
    }
    const ids = []; for (let j = n; j > 0; j = de[j]) ids.push(qual[j]);
    for (let k = ids.length - 1; k >= 0; k--) out.push(ids[k]);
  }
  return {
    encode(texto, max) {
      const out = [0];
      for (const w of String(texto).normalize('NFKC').replace(/\s+/g, ' ').trim().split(' ')) if (w) palavra('▁' + w, out);
      if (out.length > (max || 48) - 1) out.length = (max || 48) - 1;
      out.push(2); return out;
    }
  };
}

/* ---------- IA local ---------- */
const local = { estado: 'desligada', erro: '', progresso: 0, pasta: '', sessao: null, tok: null, ort: null, cache: new Map(), cacheArq: '', sujo: false, carregando: null };
function pastaModelo(base) { return path.join(base, 'ia', MODELO.id); }
function sha256Arq(arq) { return new Promise((ok, erro) => { const h = crypto.createHash('sha256'); fs.createReadStream(arq).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', erro); }); }
function modeloBaixado(base) { const p = pastaModelo(base); return MODELO.arquivos.every(a => { try { return fs.statSync(path.join(p, a.nome)).size === a.tamanho; } catch { return false; } }); }

/* baixa os arquivos uma vez: progresso de 0 a 1 em local.progresso; confere tamanho e sha256 */
async function baixarModelo(base, aoProgresso) {
  const p = pastaModelo(base); fs.mkdirSync(p, { recursive: true });
  const total = MODELO.arquivos.reduce((s, a) => s + a.tamanho, 0); let feito = 0;
  local.estado = 'baixando'; local.erro = '';
  try {
    for (const a of MODELO.arquivos) {
      const dest = path.join(p, a.nome);
      if (fs.existsSync(dest) && fs.statSync(dest).size === a.tamanho && (!a.sha256 || await sha256Arq(dest) === a.sha256)) { feito += a.tamanho; continue; }
      let r = null, falha = '';
      for (const u of [a.url, a.reserva].filter(Boolean)) { try { r = await fetch(u, { redirect: 'follow' }); if (r.ok && r.body) break; falha = 'HTTP ' + r.status; } catch (e) { falha = e.message; } r = null; }
      if (!r) throw new Error(`não consegui baixar ${a.nome} (${falha}). Confira a internet e tente de novo.`);
      const tmp = dest + '.baixando', f = fs.createWriteStream(tmp), h = crypto.createHash('sha256');
      let n = 0;
      for await (const pedaco of r.body) {
        const b = Buffer.from(pedaco); h.update(b); n += b.length;
        if (!f.write(b)) await new Promise(ok => f.once('drain', ok));
        local.progresso = (feito + n) / total; if (aoProgresso) aoProgresso(local.progresso);
      }
      await new Promise((ok, erro) => f.end(e => e ? erro(e) : ok()));
      const sha = h.digest('hex');
      if (n !== a.tamanho || (a.sha256 && sha !== a.sha256)) { try { fs.unlinkSync(tmp); } catch { } throw new Error(`${a.nome} veio diferente do esperado (download corrompido). Tente de novo.`); }
      fs.renameSync(tmp, dest); feito += a.tamanho;
    }
    local.progresso = 1; local.estado = 'baixado';
    return true;
  } catch (e) { local.estado = 'erro'; local.erro = e.message; throw e; }
}

async function carregarLocal(base) {
  if (local.sessao) return true;
  if (local.carregando) return local.carregando;
  local.carregando = (async () => {
    try {
      if (!modeloBaixado(base)) { local.estado = 'sem-modelo'; return false; }
      local.estado = 'carregando'; local.pasta = pastaModelo(base);
      const ort = require(path.join(local.pasta, 'ort.wasm.min.js'));
      ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = local.pasta + path.sep; ort.env.logLevel = 'error';
      local.tok = criarTokenizador(JSON.parse(fs.readFileSync(path.join(local.pasta, 'tokenizer.json'), 'utf8')));
      local.sessao = await ort.InferenceSession.create(fs.readFileSync(path.join(local.pasta, 'model_quantized.onnx')), { graphOptimizationLevel: 'all' });
      local.ort = ort;
      local.cacheArq = path.join(base, 'ia', MODELO.id + '-produtos.json');
      try { const c = JSON.parse(fs.readFileSync(local.cacheArq, 'utf8')); for (const [k, v] of Object.entries(c)) { const b = Buffer.from(v, 'base64'), f = new Float32Array(b.length / 2); for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32767; local.cache.set(k, f); } } catch { }
      local.estado = 'pronta'; return true;
    } catch (e) { local.estado = 'erro'; local.erro = e.message; local.sessao = null; return false; }
    finally { local.carregando = null; }
  })();
  return local.carregando;
}
const textoModelo = s => MODELO.prefixo + String(s).toLowerCase().replace(/\s*\(c[oó]d\.?\s*\d+\)\s*$/i, '').replace(/\s+/g, ' ').trim();
async function vetores(textos) {
  const ort = local.ort, saida = [];
  for (let i = 0; i < textos.length; i += 16) {
    const lote = textos.slice(i, i + 16).map(t => local.tok.encode(t, 40)), L = Math.max(...lote.map(x => x.length));
    const ids = new BigInt64Array(lote.length * L), msk = new BigInt64Array(lote.length * L);
    lote.forEach((x, r) => x.forEach((id, c) => { ids[r * L + c] = BigInt(id); msk[r * L + c] = 1n; }));
    const T = a => new ort.Tensor('int64', a, [lote.length, L]);
    const o = await local.sessao.run({ input_ids: T(ids), attention_mask: T(msk), token_type_ids: T(new BigInt64Array(lote.length * L)) });
    const h = o.last_hidden_state.data, D = o.last_hidden_state.dims[2];
    lote.forEach((x, r) => {
      const v = new Float32Array(D);
      for (let c = 0; c < x.length; c++) for (let d = 0; d < D; d++) v[d] += h[(r * L + c) * D + d];
      let n = 0; for (let d = 0; d < D; d++) n += v[d] * v[d]; n = Math.sqrt(n) || 1; for (let d = 0; d < D; d++) v[d] /= n;
      saida.push(v);
    });
  }
  return saida;
}
// vetores dos nomes de produto ficam guardados (memória e disco): só os nomes novos são calculados
async function vetoresProdutos(nomes) {
  const faltam = [...new Set(nomes.filter(n => !local.cache.has(n)))];
  if (faltam.length) { const v = await vetores(faltam.map(textoModelo)); faltam.forEach((n, i) => local.cache.set(n, v[i])); local.sujo = true; }
  return nomes.map(n => local.cache.get(n));
}
// calcula os vetores de todos os produtos aos poucos (lotes pequenos, para o caixa não travar); uma vez por lista
let aquecendo = null;
function aquecer(nomes) {
  if (aquecendo || !local.sessao) return aquecendo;
  const faltam = [...new Set(nomes.filter(n => n && !local.cache.has(n)))];
  if (!faltam.length) return null;
  aquecendo = (async () => {
    for (let i = 0; i < faltam.length; i += 4) { await vetoresProdutos(faltam.slice(i, i + 4)); await new Promise(ok => setTimeout(ok, 30)); }
    salvarCacheLocal();
  })().catch(e => { local.erro = e.message; }).finally(() => { aquecendo = null; });
  return aquecendo;
}
function salvarCacheLocal() {
  if (!local.sujo || !local.cacheArq) return; local.sujo = false;
  const o = {}; for (const [k, v] of local.cache) { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), i * 2)); o[k] = b.toString('base64'); }
  try { fs.writeFileSync(local.cacheArq, JSON.stringify(o)); } catch { }
}
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/* ---------- IA na nuvem (Claude) ---------- */
const PRECO = { entrada: 0.10 / 1e6, saida: 0.50 / 1e6 };   // US$ por token, claude-haiku-5-5
const nuvem = { chamadas: 0, tokensEntrada: 0, tokensSaida: 0, custo: 0, erros: 0, ultimoErro: '' };
/* manda só a linha do pedido e os nomes candidatos; devolve {nome|null, ms} */
async function perguntarClaude(linha, nomes, chave, opc) {
  opc = opc || {};
  const lista = nomes.slice(0, 10).map((n, i) => `${i + 1}. ${n}`).join('\n');
  const corpo = {
    model: opc.modelo || 'claude-haiku-5-5', max_tokens: 60, temperature: 0,
    system: 'Você ajuda uma loja de temperos a reconhecer itens de pedidos escritos por clientes (com erros, abreviações e sinônimos: colorau = colorífico, açafrão-da-terra = cúrcuma). Escolha o produto da lista que o cliente mais provavelmente quis dizer, ou 0 (nenhum) se nenhum produto da lista é o que ele pediu. Responda chamando a ferramenta.',
    tools: [{ name: 'escolher', description: 'Informa o produto escolhido.', input_schema: { type: 'object', properties: { escolha: { type: 'integer', description: 'Número do produto na lista, ou 0 para nenhum' } }, required: ['escolha'] } }],
    tool_choice: { type: 'tool', name: 'escolher' },
    messages: [{ role: 'user', content: `Item do pedido: "${String(linha).slice(0, 120)}"\nProdutos:\n${lista}` }]
  };
  const t0 = Date.now(), ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), opc.timeoutMs || 5000);
  try {
    const r = await (opc.fetch || fetch)(opc.url || process.env.BALCAO_IA_URL || 'https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
    const u = j.usage || {}; nuvem.chamadas++; nuvem.tokensEntrada += u.input_tokens || 0; nuvem.tokensSaida += u.output_tokens || 0;
    const custo = (u.input_tokens || 0) * PRECO.entrada + (u.output_tokens || 0) * PRECO.saida; nuvem.custo += custo;
    const uso = (j.content || []).find(c => c.type === 'tool_use'), n = uso && uso.input ? Number(uso.input.escolha) : 0;
    return { nome: n >= 1 && n <= Math.min(10, nomes.length) ? nomes[n - 1] : null, ms: Date.now() - t0, custo, tokens: (u.input_tokens || 0) + (u.output_tokens || 0) };
  } catch (e) { nuvem.erros++; nuvem.ultimoErro = e.name === 'AbortError' ? 'sem resposta em 5 s' : e.message; return { nome: null, erro: nuvem.ultimoErro, ms: Date.now() - t0 }; }
  finally { clearTimeout(tm); }
}

/* ---------- juntar tudo ---------- */
let PESO_LOCAL = +(process.env.IA_PESO || 0.3), RESGATE_LOCAL = +(process.env.IA_RESGATE || 0.94);
/* r = resultado do casar-produto. Só mexe quando ele não teve certeza. Devolve um resultado novo (nunca "alta" vindo da IA).
   opc: {pesagem, local: bool, chave: 'sk-ant-...' (nuvem), simular: fn(linha, nomes) -> nome (testes sem chave)} */
async function refinar(it, r, produtos, opc) {
  opc = opc || {};
  if (r && r.p && r.conf === 'alta') return r;
  if (r && ['lembrado', 'apelido', 'codigo'].includes(r.motivo)) return r;
  let cands = (r && r.candidatos || []).map(c => ({ p: c.p, sc: c.score }));
  const coerente = p => !(opc.pesagem && p.unidade !== 'kg');
  let saida = r;
  // local: mistura a nota do casamento com a parecença do modelo
  if (opc.local !== false && local.sessao) {
    try {
      const [vl] = await vetores([textoModelo(it.nome)]);
      if (!cands.length || !r.p) {   // não achou nada: procura entre todos os produtos coerentes os mais parecidos pelo modelo
        const P0 = produtos.filter(p => p && p.ativo !== false && coerente(p));
        if (!opc.esperarVetores && P0.some(p => !local.cache.has(p.nome))) aquecer(produtos.filter(p => p && p.ativo !== false).map(p => p.nome));   // ainda calculando: procura só nos que já têm vetor
        const P = opc.esperarVetores ? P0 : P0.filter(p => local.cache.has(p.nome)), V = await vetoresProdutos(P.map(p => p.nome));
        const viz = P.map((p, i) => ({ p, s: cos(vl, V[i]) })).sort((a, b) => b.s - a.s).slice(0, 10);
        cands = viz.map(x => ({ p: x.p, sc: 0, sim: x.s }));
      } else {
        const V = await vetoresProdutos(cands.map(c => c.p.nome)); cands.forEach((c, i) => { c.sim = cos(vl, V[i]); });
      }
      const nota = c => (c.sc || 0) + PESO_LOCAL * ((c.sim || 0) - 0.8);
      cands.sort((a, b) => nota(b) - nota(a));
      const t = cands[0], s2 = cands[1];
      if (t) {
        const forte = r.p ? true : (t.sim >= RESGATE_LOCAL && (!s2 || t.sim - s2.sim >= 0.02));   // sem candidato do casamento só sugere quando o modelo está bem seguro
        if (forte) saida = { ...r, p: t.p, conf: r.p && t.p === r.p ? r.conf : 'baixa', motivo: r.p && t.p === r.p ? r.motivo : 'ia-local', ia: t.p === (r.p || null) ? undefined : 'local', candidatos: cands.map(c => ({ p: c.p, score: c.sc })) };
      }
    } catch (e) { local.erro = e.message; }
  }
  // nuvem: só para o que ainda está em dúvida
  if ((opc.chave || opc.simular) && cands.length) {
    const nomes = cands.slice(0, 10).map(c => c.p.nome);
    const resp = opc.simular ? { nome: await opc.simular(it.nome, nomes) } : await perguntarClaude(it.nome, nomes, opc.chave, opc);
    if (resp.nome) { const p = cands.find(c => c.p.nome === resp.nome).p; saida = { ...saida, p, conf: 'media', motivo: 'ia-nuvem', ia: 'nuvem', iaCusto: resp.custo }; }
    else if (!resp.erro) saida = { ...saida, p: null, conf: '', motivo: 'ia-nenhum', ia: 'nuvem', sugestao: null, iaCusto: resp.custo };   // a IA disse que nenhum serve: a tela pede para escolher
  }
  return saida;
}

/* para a medição (test/medir-reconhecimento.js) */
async function preparar(o) {
  if (o.modo === 'local' || o.modo === 'local+nuvem-sim') { const ok = await carregarLocal(o.base || process.env.BALCAO_IA_BASE || path.join(require('os').homedir(), '.balcao-ia')); if (!ok) throw new Error('modelo local não carregou: ' + local.erro); }
}
module.exports = { MODELO, local, nuvem, PRECO, modeloBaixado, baixarModelo, carregarLocal, salvarCacheLocal, aquecer, vetores, vetoresProdutos, perguntarClaude, refinar, preparar, criarTokenizador };
