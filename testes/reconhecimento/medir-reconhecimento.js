#!/usr/bin/env node
/* Mede o reconhecimento de produtos com as linhas rotuladas de test/reconhecimento.json e a lista real da D'Lu.
   Uso: node test/medir-reconhecimento.js [--conjunto casos|validacao|todos] [--casar arquivo] [--parser arquivo] [--ia local|nuvem|nuvem-sim] [--erros] [--metade par|impar]
   Saída: acerto top-1, ERRO COM CERTEZA (o pior: produto errado sem aviso), pergunta (confira) e não casou. */
'use strict';
const path = require('path'), fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const AQUI = __dirname;
const achar = (...l) => l.find(f => fs.existsSync(f)) || l[0];   // no app (test/) ou na pasta testes/reconhecimento do repositório
const CP = require(path.resolve(arg('casar', achar(path.join(AQUI, '../public/casar-produto.js'), path.join(AQUI, 'casar-produto.js')))));
const parserArq = arg('parser', fs.existsSync(path.join(AQUI, 'parser.js')) ? path.join(AQUI, 'parser.js') : null), Ficha = parserArq ? require(path.resolve(parserArq)) : null;
const PRODS = JSON.parse(fs.readFileSync(path.join(AQUI, 'produtos-dlu.json'), 'utf8')).map((p, i) => ({ id: 'p' + i, nome: p.nome, codigo: p.codigo, unidade: p.unidade }));
const DADOS = JSON.parse(fs.readFileSync(path.join(AQUI, 'reconhecimento.json'), 'utf8'));
const conjunto = arg('conjunto', 'casos');   // casos (usado para ajustar) | validacao (escrito depois, sem ajuste) | todos
let CASOS = conjunto === 'todos' ? DADOS.casos.concat(DADOS.validacao) : DADOS[conjunto];
const metade = arg('metade', null); if (metade) CASOS = CASOS.filter((_, i) => (i % 2 === 0) === (metade === 'par'));
const base = n => String(n || '').replace(/\s*\(c[oó]d\.?\s*\d+\)\s*$/i, '').trim().toUpperCase();
const aceita = (c, nome) => !!c.e && c.e.some(e => base(e) === base(nome));

// extrai nome/quantidade/unidade da linha: a versão nova tem CP.lerLinha; a antiga usava a leitura da Ficha
let FichaAntiga = null;
function extrair(t, pesagem) {
  if (CP.lerLinha) return CP.lerLinha(t, { pesagem });
  if (!FichaAntiga) FichaAntiga = require(path.resolve(arg('extrator', parserArq)));   // só na medição da versão antiga
  const r = FichaAntiga.parse(t, { catalog: [] }); const it = r.itens[0];
  return it ? { nome: it.bruto, quantidade: it.quantidade, unidade: it.unidade } : { nome: t };
}

function classifica(c, nome, conf) {
  if (!nome) return c.e ? 'naoCasou' : 'certo';
  const ok = aceita(c, nome);
  if (conf === 'alta') return ok ? (c.amb ? 'certezaIndevida' : 'certo') : 'erradoComCerteza';
  return ok ? 'certoPergunta' : 'erradoPergunta';
}

async function medir(nomeModo, casos, prever) {
  const R = { certo: 0, certoPergunta: 0, certezaIndevida: 0, erradoComCerteza: 0, erradoPergunta: 0, naoCasou: 0 }, erros = [];
  let ms = 0;
  for (const c of casos) {
    const t0 = process.hrtime.bigint();
    const { nome, conf, extra } = await prever(c);
    ms += Number(process.hrtime.bigint() - t0) / 1e6;
    const k = classifica(c, nome, conf); R[k]++;
    if (k !== 'certo' && k !== 'certoPergunta') erros.push({ k, t: c.t, ctx: c.ctx, veio: nome || '-', conf: conf || '', esperado: c.e ? c.e.join(' | ') : '(nenhum)', extra });
  }
  const N = casos.length, pc = x => (100 * x / N).toFixed(1) + '%';
  const top1 = R.certo + R.certoPergunta + R.certezaIndevida;
  console.log(`\n== ${nomeModo}: ${N} linhas (${(ms / N).toFixed(2)} ms/linha)`);
  console.log(`  top-1 certo ............ ${pc(top1)}  (sem aviso ${pc(R.certo)}, com "confira" ${pc(R.certoPergunta)})`);
  console.log(`  ERRADO COM CERTEZA ..... ${pc(R.erradoComCerteza)}  (${R.erradoComCerteza})`);
  console.log(`  ambígua com certeza .... ${pc(R.certezaIndevida)}  (${R.certezaIndevida}; produto aceitável, mas devia perguntar)`);
  console.log(`  errado com "confira" ... ${pc(R.erradoPergunta)}  (${R.erradoPergunta})`);
  console.log(`  não casou (pergunta) ... ${pc(R.naoCasou)}  (${R.naoCasou})`);
  if (arg('erros')) for (const e of erros) console.log(`   [${e.k}] (${e.ctx}) "${e.t}" -> ${e.veio} ${e.conf} | esperado: ${e.esperado}${e.extra ? ' | ' + e.extra : ''}`);
  return { modo: nomeModo, N, top1: top1 / N, erradoComCerteza: R.erradoComCerteza / N, R, msLinha: ms / N };
}

(async () => {
  const ia = arg('ia', null); let IA = null;   // local | nuvem (precisa ANTHROPIC_API_KEY) | nuvem-sim | local+nuvem-sim
  if (ia) { IA = require(achar(path.join(AQUI, '../ia-produto.js'), path.join(AQUI, 'ia-produto.js'))); await IA.preparar({ modo: ia, produtos: PRODS, simular: ia === 'nuvem-sim' }); }
  const casarUm = async (c) => {
    const pesagem = c.ctx === 'ficha', it = extrair(c.t, pesagem);
    let r = CP.casar(it, PRODS, [], { pesagem });
    if (IA) {
      const o = { pesagem, modo: ia, local: /local/.test(ia), esperarVetores: true };
      // nuvem simulada (sem chave): responde como um Claude perfeito — o produto certo se estiver entre os 10 candidatos, senão "nenhum"
      if (/nuvem-sim/.test(ia)) o.simular = async (linha, nomes) => { enviadas++; return nomes.find(n => aceita(c, n)) || null; };
      if (/nuvem$/.test(ia)) { o.chave = process.env.ANTHROPIC_API_KEY; enviadas++; }
      r = await IA.refinar(it, r, PRODS, o);
    }
    return { nome: r.p && r.p.nome, conf: r.p ? r.conf : '', extra: r.motivo + (r.ia ? ' ia:' + r.ia : '') };
  };
  let enviadas = 0;
  const out = [await medir('Balcão (casar-produto)' + (ia ? ' + IA ' + ia : ''), CASOS, casarUm)];
  if (ia && /nuvem/.test(ia)) { const custo = enviadas * (330 * IA.PRECO.entrada + 25 * IA.PRECO.saida); console.log(`  linhas mandadas à nuvem: ${enviadas} de ${CASOS.length} · custo estimado US$ ${custo.toFixed(4)} (≈330 tokens de entrada e 25 de saída por linha; real: US$ ${IA.nuvem.custo.toFixed(4)})`); }
  if (Ficha) {
    // a lista como a Ficha guarda depois de sincronizar com o Balcão: um nome por grafia sem acento, o de quilo primeiro
    const nomes = [], unidades = {};
    for (const p of [...PRODS].sort((a, b) => (a.unidade === 'kg' ? 0 : 1) - (b.unidade === 'kg' ? 0 : 1))) { const k = Ficha.norm(p.nome.trim()); if (k in unidades) continue; unidades[k] = p.unidade === 'kg' ? 'kg' : 'un'; nomes.push(p.nome); }
    out.push(await medir('Ficha (leitura do WhatsApp)', CASOS.filter(c => c.ctx === 'ficha'), async c => {
      const r = Ficha.parse(c.t, { catalog: nomes, unidades });
      if (!r.itens.length) return { nome: null };
      if (r.itens.length > 1) return { nome: r.itens.map(i => i.produto).join(' + '), conf: 'alta', extra: 'virou ' + r.itens.length + ' itens' };
      const i = r.itens[0];
      if (i.alerta) return { nome: null, extra: i.produto };
      return { nome: i.produto, conf: i.conf || 'alta' };   // a Ficha antiga imprime sem aviso tudo o que achou
    }));
  }
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 1));
})();
