#!/usr/bin/env node
/* Mede a IA local que aprende (aprende-produto.js) no conjunto de validação (linhas que não foram usadas para ajustar).
   Modos: casamento normal; + IA fria (sem nada aprendido); + depois de aprender 50 correções sorteadas do conjunto de ajuste
   (comparado com o aprendizado antigo, só por apelido exato). Uso: node test/medir-aprendizado.js [--treinar] [--n 50] [--semente 7]
   --treinar: recalcula os pesos iniciais do reordenador no conjunto de ajuste e imprime (para colar em PESOS0). */
'use strict';
const path = require('path'), fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const achar = (...l) => l.find(f => fs.existsSync(f)) || l[0];
const CP = require(achar(path.join(__dirname, '../public/casar-produto.js'), path.join(__dirname, 'casar-produto.js')));
const AP = require(achar(path.join(__dirname, '../public/aprende-produto.js'), path.join(__dirname, 'aprende-produto.js')));
const PRODS = JSON.parse(fs.readFileSync(path.join(__dirname, 'produtos-dlu.json'), 'utf8')).map((p, i) => ({ id: 'p' + i, nome: p.nome, codigo: p.codigo, unidade: p.unidade }));
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'reconhecimento.json'), 'utf8'));
const base = n => String(n || '').replace(/\s*\(c[oó]d\.?\s*\d+\)\s*$/i, '').trim().toUpperCase();
const aceita = (c, nome) => !!c.e && c.e.some(e => base(e) === base(nome));
let rnd = Number(arg('semente', 7)); const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;

function prever(c, mem, apelidos) {
  const pesagem = c.ctx === 'ficha', it = CP.lerLinha(c.t, { pesagem });
  let r = CP.casar(it, PRODS, apelidos || [], { pesagem });
  if (mem) r = AP.refinar(it, r, PRODS, mem, { pesagem });
  return { it, r };
}
function medir(nome, casos, mem, apelidos) {
  const R = { certo: 0, certoPergunta: 0, certezaIndevida: 0, erradoComCerteza: 0, erradoPergunta: 0, naoCasou: 0 }; let ms = 0;
  for (const c of casos) { const t0 = process.hrtime.bigint(); const { r } = prever(c, mem, apelidos); ms += Number(process.hrtime.bigint() - t0) / 1e6;
    const nm = r.p && r.p.nome, conf = r.p ? r.conf : '';
    let k; if (!nm) k = c.e ? 'naoCasou' : 'certo'; else { const ok = aceita(c, nm); k = conf === 'alta' ? (ok ? (c.amb ? 'certezaIndevida' : 'certo') : 'erradoComCerteza') : ok ? 'certoPergunta' : 'erradoPergunta'; }
    R[k]++; }
  const N = casos.length, pc = x => (100 * x / N).toFixed(1).padStart(5) + '%';
  console.log(`${nome.padEnd(44)} top-1 ${pc(R.certo + R.certoPergunta + R.certezaIndevida)} | sem aviso ${pc(R.certo)} | confira ${pc(R.certoPergunta + R.erradoPergunta)} | ERRADO c/ certeza ${pc(R.erradoComCerteza)} (${R.erradoComCerteza}) | não casou ${pc(R.naoCasou)} | ${(ms / N).toFixed(2)} ms/linha`);
  return R;
}

if (arg('treinar')) {
  // regressão logística nos candidatos do conjunto de ajuste (votos e vendas ficam em zero aqui: esses pesos são fixos)
  const mem = AP.novaMemoria(), amostras = [];
  for (const c of D.casos) { if (c.amb) continue; const { it, r } = prever(c, mem); for (const x of (r._feats || [])) amostras.push([x.f, c.e && aceita(c, x.p.nome) ? 1 : 0]); }
  const w = AP.PESOS0.slice(), livres = [0, 1, 2, 3];
  for (let ep = 0; ep < 400; ep++) { const g = w.map(() => 0); for (const [f, y] of amostras) { const p = 1 / (1 + Math.exp(-f.reduce((s, x, i) => s + x * w[i], 0))); livres.forEach(i => { g[i] += (y - p) * f[i]; }); } livres.forEach(i => { w[i] += 0.5 * g[i] / amostras.length; }); }
  console.log('amostras', amostras.length, 'pesos:', JSON.stringify(w.map(x => Math.round(x * 100) / 100)));
  process.exit(0);
}
const V = D.validacao, n = Number(arg('n', 50));
console.log(`Validação: ${V.length} linhas (não usadas para ajustar)\n`);
medir('1) casamento normal (1.34)', V, null);
medir('2) + IA local fria (nada aprendido)', V, AP.novaMemoria());
// 50 correções sorteadas do conjunto de ajuste (a pessoa escolhe o produto certo onde o app errou ou pediu confira)
const pool = D.casos.filter(c => c.e);
const corr = []; const usados = new Set(); while (corr.length < n && usados.size < pool.length) { const i = Math.floor(rand() * pool.length); if (usados.has(i)) continue; usados.add(i); corr.push(pool[i]); }
const mem = AP.novaMemoria(), apelidos = [];
for (const c of corr) { const { it, r } = prever(c, mem); const alvo = PRODS.find(p => base(p.nome) === base(c.e[0]) && (c.ctx !== 'ficha' || p.unidade === 'kg')) || PRODS.find(p => base(p.nome) === base(c.e[0]));
  AP.aprender(mem, c.t, alvo, { peso: 2, sugerido: r.p, feats: r._feats, acertou: !!(r.p && aceita(c, r.p.nome)) });
  apelidos.push({ texto: CP.chave(it.nome), pid: alvo.id }); }
console.log('');
medir(`3) casamento + ${n} correções só como apelido (antes)`, V, null, apelidos);
medir(`4) + IA local depois de aprender ${n} correções`, V, mem, apelidos);
// a mesma loja de novo: as linhas que ela corrigiu voltam (pedido repetido do mesmo cliente)
console.log('');
medir(`5) linhas corrigidas voltando (as ${n}), só apelido`, corr, null, apelidos);
medir(`6) linhas corrigidas voltando (as ${n}), IA local`, corr, mem, apelidos);
const t0 = process.hrtime.bigint(); for (let k = 0; k < 10; k++) prever(V[k], mem, apelidos); const ped = Number(process.hrtime.bigint() - t0) / 1e6;
const tam = fs.statSync(achar(path.join(__dirname, '../public/aprende-produto.js'), path.join(__dirname, 'aprende-produto.js'))).size;
console.log(`\npedido de 10 linhas: ${ped.toFixed(1)} ms · arquivo da IA: ${(tam / 1024).toFixed(1)} KB · memória aprendida: ${(JSON.stringify(mem).length / 1024).toFixed(1)} KB · heap usado: ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
