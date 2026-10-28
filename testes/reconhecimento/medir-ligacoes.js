#!/usr/bin/env node
/* Ligar produtos ao site: sugestão para cada produto do site da D'Lu contra a lista real do Balcão.
   Uso: node test/medir-ligacoes.js [--site caminho/catalogo.js] [--antes caminho/site.js antigo] [--lista] */
'use strict';
const path = require('path'), fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const achar = (...l) => l.find(f => fs.existsSync(f)) || l[0];
const S = require(achar(path.join(__dirname, '../site.js'), path.join(__dirname, 'site.js')))._teste;
const cat = S.lerCatalogoSite(fs.readFileSync(arg('site', achar('/home/claude/site-loja/dados/catalogo.js', path.join(__dirname, '../../../site-loja/dados/catalogo.js'))), 'utf8')), lista = S.produtosDaLoja(cat, 'dlu');
const prods = require('./produtos-dlu.json').map((p, i) => ({ id: 'p' + i, nome: p.nome, codigo: p.codigo, unidade: p.unidade, ativo: true }));
const nome = id => (prods.find(p => p.id === id) || {}).nome, porNome = n => prods.find(p => p.nome === n);
function rodar(rot, sugerir, ctx) {
  const C = { alta: 0, media: 0, baixa: 0, '': 0 }, L = new Map();
  for (const sp of lista) for (const op of sp.tipo === 'kg' ? [''] : sp.opcoes) { const g = sugerir(sp, op, prods, ctx); const k = g ? g.conf : ''; C[k]++; L.set(sp.nome + (sp.marca ? ' ' + sp.marca : '') + (op ? ' · ' + op : ' (granel)'), g ? [nome(g.pid), k] : ['-', 'nenhuma']); }
  console.log(`${rot.padEnd(46)} alta ${C.alta} · média ${C.media} · baixa ${C.baixa} · sem sugestão ${C['']}  (de ${[...L].length})`); return L;
}
const antes = arg('antes') ? rodar('antes (1.34.4)', require(path.resolve(arg('antes')))._teste ? require(path.resolve(arg('antes')))._teste.sugerir : require(path.resolve(arg('antes'))).sugerir) : null;
const novo = rodar('agora, sem nenhuma ligação feita', S.sugerir, S.contextoLigacoes(lista, {}, prods));
// o dono ligou à mão "Bicarbonato de sódio" -> BICARBONATO: a ligação ensina ("sódio" é descrição)
const sb = lista.find(sp => sp.nome === 'Bicarbonato de sódio' && sp.tipo === 'kg'), lig = { [sb.chave]: { tipo: 'kg', pid: porNome('BICARBONATO').id } };
const ctx = S.contextoLigacoes(lista, lig, prods);
const depois = rodar('agora, depois da ligação do bicarbonato', S.sugerir, ctx);
console.log('palavras de descrição aprendidas das ligações:', ctx.aprendidas.join(', ') || '(nenhuma)');
console.log('\nPares pedidos:');
for (const q of ['Bicarbonato', 'Percarbonato', 'Ácido cítrico', 'Açúcar mascavo', 'Canela em pau', 'Colorau']) for (const [r, v] of depois) if (r.startsWith(q)) console.log(`  ${r.padEnd(58)} antes: ${antes ? (antes.get(r) || ['?', '?']).join(' (') + ')' : '-'}  →  agora: ${v[0]} (${v[1]})`);
if (process.argv.includes('--lista')) { console.log('\nAinda sem sugestão de confiança alta (depois):'); for (const [r, v] of depois) if (v[1] !== 'alta') console.log(`  ${r} -> ${v[0]} (${v[1]})`); }
