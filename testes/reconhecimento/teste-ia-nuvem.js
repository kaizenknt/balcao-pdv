#!/usr/bin/env node
/* IA na nuvem contra um servidor falso da Anthropic: o que vai no pedido, o que volta, tempo máximo de 5 s e custo. */
'use strict';
const http = require('http'), assert = require('assert'), path = require('path');
const recebidos = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b); recebidos.push({ headers: req.headers, j });
    const txt = j.messages[0].content, linhas = txt.split('\n').slice(2).map(l => l.replace(/^\d+\. /, ''));
    if (/demora/.test(txt)) return setTimeout(() => { try { res.end('{}'); } catch { } }, 7000);
    if (/chave ruim/.test(txt)) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
    const quer = /colorau/.test(txt) ? 'COLORAL CASEIRO' : /arroz/.test(txt) ? null : linhas[0];
    const n = quer ? linhas.indexOf(quer) + 1 : 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'escolher', input: { escolha: n } }], usage: { input_tokens: 320, output_tokens: 22 } }));
  });
});
srv.listen(0, '127.0.0.1', async () => {
  process.env.BALCAO_IA_URL = `http://127.0.0.1:${srv.address().port}/v1/messages`;
  const fs = require('fs'), achar = (...l) => l.find(f => fs.existsSync(f)) || l[0];
  const IA = require(achar(path.join(__dirname, '../ia-produto.js'), path.join(__dirname, 'ia-produto.js'))), CP = require(achar(path.join(__dirname, '../public/casar-produto.js'), path.join(__dirname, 'casar-produto.js')));
  const PRODS = require('./produtos-dlu.json').map((p, i) => ({ id: 'p' + i, ...p }));
  const K = 'sk-ant-teste-0000000000000000000000';
  // 1) linha em dúvida: vai só o texto do item e os nomes; volta como "media" e "ia-nuvem"
  let it = CP.lerLinha('colorau 1kg', { pesagem: true }), r = CP.casar(it, PRODS, [], { pesagem: true });
  assert.notStrictEqual(r.conf, 'alta');
  let f = await IA.refinar(it, r, PRODS, { pesagem: true, chave: K, local: false });
  assert.strictEqual(f.p.nome, 'COLORAL CASEIRO'); assert.strictEqual(f.conf, 'media'); assert.strictEqual(f.ia, 'nuvem');
  const q = recebidos[0];
  assert.strictEqual(q.j.model, 'claude-haiku-5-5'); assert.strictEqual(q.j.temperature, 0); assert.strictEqual(q.j.tool_choice.name, 'escolher');
  assert.strictEqual(q.headers['x-api-key'], K); assert.ok(q.headers['anthropic-version']);
  assert.ok(/^Item do pedido: "colorau"\nProdutos:\n1\. /.test(q.j.messages[0].content), q.j.messages[0].content);
  assert.ok(q.j.messages[0].content.split('\n').length <= 12, 'no máximo 10 candidatos');
  // 2) linha com certeza alta: não vai para a nuvem
  const antes = recebidos.length; it = CP.lerLinha('pimenta calabresa 500g', { pesagem: true }); r = CP.casar(it, PRODS, [], { pesagem: true });
  f = await IA.refinar(it, r, PRODS, { pesagem: true, chave: K, local: false }); assert.strictEqual(recebidos.length, antes); assert.strictEqual(f, r);
  // 3) "nenhum": a sugestão sai e a tela pede para escolher
  it = CP.lerLinha('arroz 5kg', { pesagem: true }); r = CP.casar(it, PRODS, [], { pesagem: true });
  f = await IA.refinar(it, r, PRODS, { pesagem: true, chave: K, local: false }); assert.strictEqual(f.p, null); assert.strictEqual(f.motivo, 'ia-nenhum');
  // 4) sem resposta em 5 s: fica como estava
  it = CP.lerLinha('demora cominho 1kg', { pesagem: true }); r = CP.casar(it, PRODS, [], { pesagem: true });
  const t0 = Date.now(); f = await IA.refinar(it, r, PRODS, { pesagem: true, chave: K, local: false });
  const ms = Date.now() - t0; assert.ok(ms >= 4900 && ms < 6500, 'timeout ' + ms); assert.strictEqual(f, r); assert.ok(/5 s/.test(IA.nuvem.ultimoErro));
  // 5) chave recusada: fica como estava, com o erro guardado
  it = { nome: 'chave ruim colorau' }; r = CP.casar(it, PRODS, [], { pesagem: true });
  f = await IA.refinar(it, r, PRODS, { pesagem: true, chave: K, local: false }); assert.strictEqual(f, r); assert.ok(/invalid x-api-key/.test(IA.nuvem.ultimoErro));
  // custo: 342 tokens por pergunta respondida
  assert.ok(Math.abs(IA.nuvem.custo - 2 * (320 * 0.10 + 22 * 0.50) / 1e6) < 1e-9, IA.nuvem.custo);
  console.log(`IA na nuvem (servidor falso): ok · ${recebidos.length} perguntas · custo estimado US$ ${IA.nuvem.custo.toFixed(6)} · timeout ${ms} ms`);
  srv.close(); process.exit(0);
});
