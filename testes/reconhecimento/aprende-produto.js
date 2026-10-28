/* IA local que aprende com a loja (Balcão PDV e Ficha de Pesagem; o mesmo arquivo nos dois). Leve: sem download, sem nada nativo.
   1) Parecença por pedaços de palavra (trigramas) e palavras, pesados pela raridade na lista de produtos da própria loja,
      incluindo os textos que a loja já corrigiu ("colorau" -> COLORAL CASEIRO vira um apelido a mais do produto).
   2) Um reordenador pequeno (regressão logística) que junta: nota do casamento normal, parecença, votos aprendidos,
      contradições e o que a loja mais vende. Começa com pesos treinados no conjunto de teste e se ajusta com as correções.
   3) Aprende sozinho: cada correção conta voto para "texto -> produto". Com 2 votos e nenhuma contradição vira certeza
      ("aprendido"); uma correção para outro produto conta contradição e volta a pedir "confira".
   Regra de segurança: o reordenador sozinho nunca dá "alta". Só o mapeamento confirmado pela loja dá. */
(function (raiz) {
  'use strict';
  let CP = null;
  try { CP = (typeof require === 'function') ? require('./casar-produto.js') : raiz.CasarProduto; } catch (e) { CP = raiz.CasarProduto || null; }
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // chave do produto que vale nos dois apps: código quando tem, senão o nome
  const kProd = p => p ? (p.codigo ? 'c:' + String(p.codigo) : 'n:' + norm(String(p.nome || '').replace(/\s*\(c[oó]d\.?\s*\d+\)\s*$/i, '')).replace(/\s+/g, ' ').trim()) : '';
  // chave do texto do pedido (sem quantidade): "Colorau 500g" e "colorau 1kg" são o mesmo texto
  function chaveTexto(t) { if (!CP) return norm(t).trim(); const l = CP.lerLinha ? CP.lerLinha(t, { pesagem: true }) : { nome: t }; return CP.chave(l.nome || t); }
  function canon(t, linha) { if (!CP || !CP._analisar) return norm(t); return CP._analisar(t, !!linha).toks.map(x => x.c).join(' '); }
  function grams(t) { const s = ' ' + t + ' ', g = new Map(); for (let i = 0; i + 3 <= s.length; i++) { const k = s.substr(i, 3); if (k.trim().length) g.set(k, (g.get(k) || 0) + 1); } for (const w of t.split(' ')) if (w.length > 1) g.set('#' + w, (g.get('#' + w) || 0) + 2); return g; }

  /* memória: { textos: {chave: {v: {prodKey: votos}, x: {prodKey: contradições}, u: ms}}, pop: {prodKey: vendas}, pesos: [...], stats: {dia: [ok, erro]} } */
  const PESOS0 = [-6.63, 3.7, 3.77, 2.09, 1.6, -2.4, 0.35, 1.9];   // bias, nota do casamento, 1º do casamento, parecença, votos, contradições, vendas, parecença com apelidos aprendidos
  function novaMemoria() { return { textos: {}, pop: {}, pesos: PESOS0.slice(), stats: {}, v: 1 }; }

  /* ---------- índice (uma vez por lista de produtos + memória) ---------- */
  let IDX = null;
  function indice(produtos, mem) {
    const P = (produtos || []).filter(p => p && p.ativo !== false && p.nome);
    const ass = P.length + '|' + (P[0] && P[0].nome) + '|' + (P[P.length - 1] && P[P.length - 1].nome) + '|' + ((mem && mem._ver) || 0);
    if (IDX && IDX.ref === produtos && IDX.ass === ass) return IDX;
    const df = new Map(), vecs = new Map(), porK = new Map(), inv = new Map();
    const docs = P.map(p => { const g = grams(canon(p.nome)); for (const k of g.keys()) df.set(k, (df.get(k) || 0) + 1); return [p, g]; });
    const N = P.length + 1, idf = k => Math.log(N / ((df.get(k) || 0) + 1)) + 1;
    const vet = g => { const v = new Map(); let n = 0; for (const [k, c] of g) { const w = c * idf(k); v.set(k, w); n += w * w; } n = Math.sqrt(n) || 1; for (const [k, w] of v) v.set(k, w / n); return v; };
    for (const [p, g] of docs) { const v = vet(g); vecs.set(p, v); porK.set(kProd(p), p); for (const k of v.keys()) { let l = inv.get(k); if (!l) inv.set(k, l = []); l.push(p); } }
    // apelidos aprendidos: os textos que a loja ligou a cada produto
    const alias = new Map();
    for (const [t, e] of Object.entries((mem && mem.textos) || {})) for (const [pk, n] of Object.entries(e.v || {})) { const p = porK.get(pk); if (!p || n <= ((e.x || {})[pk] || 0)) continue; let l = alias.get(p); if (!l) alias.set(p, l = []); l.push(vet(grams(canon(t, true)))); }
    IDX = { ref: produtos, ass, vecs, porK, inv, alias, vet, P };
    return IDX;
  }
  const cos = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [k, w] of x) { const z = y.get(k); if (z) s += w * z; } return s; };

  function feats(c, top, lv, X, ent, mem) {
    const p = c.p, pk = kProd(p), v = ent ? (ent.v || {})[pk] || 0 : 0, x = ent ? (ent.x || {})[pk] || 0 : 0;
    const al = (X.alias.get(p) || []).reduce((m, a) => Math.max(m, cos(lv, a)), 0);
    const pop = (mem && mem.pop && mem.pop[pk]) || 0;
    return [1, c.sc || 0, c === top ? 1 : 0, cos(lv, X.vecs.get(p) || new Map()), Math.log1p(v), Math.log1p(x), Math.log1p(pop) / 4, al];
  }
  const sig = z => 1 / (1 + Math.exp(-z));
  const nota = (w, f) => sig(f.reduce((s, x, i) => s + x * (w[i] || 0), 0));

  /* refina o resultado do casar-produto. opc: {pesagem}. Devolve o mesmo formato, com ia:'local' quando a IA mudou algo. */
  function refinar(it, r, produtos, mem, opc) {
    opc = opc || {}; mem = mem || novaMemoria();
    if (!r || ['lembrado', 'apelido', 'codigo'].includes(r.motivo)) return r;
    const X = indice(produtos, mem), ch = chaveTexto(it.nome), ent = mem.textos[ch] || null, w = mem.pesos || PESOS0;
    const coerente = p => !(opc.pesagem && p.unidade !== 'kg');
    const lv = X.vet(grams(canon(it.nome, true)));
    // candidatos: os do casamento + os mais parecidos pelos trigramas + os que a loja já ligou a este texto
    const C = new Map(); (r.candidatos || []).forEach(c => c.p && C.set(c.p, { p: c.p, sc: c.score }));
    if (r.p && !C.has(r.p)) C.set(r.p, { p: r.p, sc: r.score || 0 });
    const cnt = new Map(); for (const k of lv.keys()) for (const p of (X.inv.get(k) || [])) cnt.set(p, (cnt.get(p) || 0) + lv.get(k));
    [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([p]) => { if (!C.has(p)) C.set(p, { p, sc: 0 }); });
    if (ent) for (const pk of Object.keys(ent.v || {})) { const p = X.porK.get(pk); if (p && !C.has(p)) C.set(p, { p, sc: 0 }); }
    const L = [...C.values()].filter(c => coerente(c.p));
    if (!L.length) return r;
    const top = L.find(c => c.p === r.p) || null;
    L.forEach(c => { c.f = feats(c, top, lv, X, ent, mem); c.n = nota(w, c.f); });
    L.sort((a, b) => b.n - a.n);
    const b1 = L[0], b2 = L[1], out = { ...r, candidatos: L.slice(0, 10).map(c => ({ p: c.p, score: Math.round(c.n * 1000) / 1000 })), _feats: L.slice(0, 10).map(c => ({ p: c.p, f: c.f })) };
    // mapeamento confirmado pela loja (2 votos, nenhuma contradição): certeza
    if (ent) {
      const pks = Object.entries(ent.v || {}).filter(([pk, n]) => n >= 2 && !((ent.x || {})[pk] > 0)).sort((a, b) => b[1] - a[1]);
      const outros = Object.entries(ent.v || {}).filter(([pk, n]) => n > 0 && pks.length && pk !== pks[0][0]).length;
      const p = pks.length && !outros ? X.porK.get(pks[0][0]) : null;
      if (p && coerente(p)) return { ...out, p, conf: 'alta', motivo: 'aprendido', ia: p === r.p ? undefined : 'local', alternativas: L.filter(c => c.p !== p).slice(0, 2).map(c => c.p) };
    }
    if (r.p && r.conf === 'alta') return { ...out, p: r.p };   // o reordenador sozinho nunca tira uma certeza do casamento
    const folga = b2 ? b1.n - b2.n : 1;
    if (r.p && b1.p !== r.p) {
      const atual = L.find(c => c.p === r.p);
      if (b1.n >= 0.6 && b1.n - (atual ? atual.n : 0) >= 0.12) return { ...out, p: b1.p, conf: b1.n >= 0.85 && folga >= 0.2 ? 'media' : 'baixa', motivo: 'ia-local', ia: 'local', alternativas: L.slice(1, 3).map(c => c.p) };
      return { ...out, alternativas: L.filter(c => c.p !== r.p).slice(0, 2).map(c => c.p) };
    }
    if (r.p) return { ...out, alternativas: L.filter(c => c.p !== r.p).slice(0, 2).map(c => c.p) };   // a confiança fica a do casamento
    // o casamento não achou nada: só sugere com a IA bem segura
    if (b1.n >= 0.9 && folga >= 0.3) return { ...out, p: b1.p, conf: 'baixa', motivo: 'ia-local', ia: 'local', alternativas: L.slice(1, 3).map(c => c.p) };
    return out;
  }

  /* aprende uma escolha. peso: 2 = correção feita pela pessoa (já confirma), 1 = aceitou/usou a sugestão (precisa de 2).
     sugerido: o produto que o app tinha sugerido (se a pessoa trocou, ele ganha uma contradição). Devolve a entrada alterada. */
  function aprender(mem, texto, produto, opc) {
    opc = opc || {}; const ch = chaveTexto(texto); if (!ch || !produto) return null;
    const pk = kProd(produto), e = mem.textos[ch] || (mem.textos[ch] = { v: {}, x: {}, u: 0 });
    const peso = opc.peso == null ? 1 : opc.peso;
    e.v[pk] = Math.min(20, (e.v[pk] || 0) + peso); e.u = Date.now();
    if (e.x[pk]) e.x[pk] = Math.max(0, e.x[pk] - (peso >= 2 ? e.x[pk] : 0.5));                 // a pessoa escolheu de novo: perdoa
    if (opc.sugerido && kProd(opc.sugerido) !== pk) { const sk = kProd(opc.sugerido); e.x[sk] = (e.x[sk] || 0) + 1; if (e.v[sk]) e.v[sk] = Math.max(0, e.v[sk] - 1); }
    // ajuste fino do reordenador (passo pequeno): o escolhido é positivo, os outros oferecidos são negativos
    if (opc.feats && opc.feats.length) {
      const w = mem.pesos || (mem.pesos = PESOS0.slice()), lr = 0.05;
      for (const c of opc.feats) { const y = kProd(c.p) === pk ? 1 : 0, g = y - nota(w, c.f); c.f.forEach((x, i) => { w[i] = Math.max(-8, Math.min(8, w[i] + lr * g * x)); }); }
    }
    if (opc.acertou != null) { const d = new Date().toISOString().slice(0, 10), s = mem.stats[d] || (mem.stats[d] = [0, 0]); s[opc.acertou ? 0 : 1]++; }
    mem._ver = (mem._ver || 0) + 1;
    return { chave: ch, entrada: e };
  }
  // tira um texto aprendido (botão "desfazer" em Ajustes)
  function esquecer(mem, chave) { delete mem.textos[chave]; mem._ver = (mem._ver || 0) + 1; }
  // o que a loja mais vende (desempate): [{produto, qtd}]
  function popularidade(mem, contagem) { mem.pop = {}; for (const [pk, n] of Object.entries(contagem || {})) mem.pop[pk] = n; mem._ver = (mem._ver || 0) + 1; }
  // acerto dos últimos dias (sugestão do app = o que ficou)
  function acerto(mem, dias) { const lim = new Date(Date.now() - (dias || 30) * 864e5).toISOString().slice(0, 10); let ok = 0, er = 0; for (const [d, [a, b]] of Object.entries(mem.stats || {})) if (d >= lim) { ok += a; er += b; } return { ok, erro: er, pct: ok + er ? ok / (ok + er) : null }; }
  // junta duas memórias (Ficha <-> Balcão): votos e contradições ficam com o maior de cada lado
  function juntar(a, b) {
    for (const [ch, e] of Object.entries((b && b.textos) || {})) { const d = a.textos[ch] || (a.textos[ch] = { v: {}, x: {}, u: 0 });
      for (const [k, n] of Object.entries(e.v || {})) d.v[k] = Math.max(d.v[k] || 0, n); for (const [k, n] of Object.entries(e.x || {})) d.x[k] = Math.max(d.x[k] || 0, n); d.u = Math.max(d.u || 0, e.u || 0); }
    if (b && b.pop) a.pop = { ...a.pop, ...b.pop }; a._ver = (a._ver || 0) + 1; return a;
  }
  // id do documento de um texto aprendido (o mesmo no Balcão e na Ficha)
  function idTexto(ch) { let h = 5381; for (let i = 0; i < ch.length; i++) h = ((h * 33) ^ ch.charCodeAt(i)) >>> 0; return 'a' + h.toString(36) + ch.length.toString(36); }
  // memória a partir dos documentos guardados [{id, chave, v, x, u}] e do documento "modelo" {pesos, stats}
  function deDocs(docs, modelo, base) {
    const m = base || novaMemoria(); m.textos = {};
    for (const d of docs || []) if (d && d.chave && d.id !== 'modelo') m.textos[d.chave] = { v: d.v || {}, x: d.x || {}, u: d.u || 0 };
    if (modelo && Array.isArray(modelo.pesos) && modelo.pesos.length === PESOS0.length) m.pesos = modelo.pesos.slice();
    if (modelo && modelo.stats) m.stats = { ...modelo.stats };
    m._ver = (m._ver || 0) + 1; return m;
  }
  // vendas (últimos 90 dias) -> o que a loja mais vende
  function contarVendas(vendas, prodPorId) { const c = {}, lim = new Date(Date.now() - 90 * 864e5).toISOString();
    for (const v of vendas || []) { if (v.status === 'cancelada' || (v.data || '') < lim) continue; for (const i of v.itens || []) { const p = prodPorId(i.pid); if (!p) continue; const k = kProd(p); c[k] = (c[k] || 0) + 1; } }
    return c; }
  const api = { refinar, aprender, esquecer, popularidade, acerto, juntar, novaMemoria, chaveTexto, kProd, PESOS0, idTexto, deDocs, contarVendas };
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.AprendeProduto = api;
})(typeof window !== 'undefined' ? window : this);
