/* IA na nuvem para reconhecer produtos (Balcão PDV e Ficha de Pesagem; o mesmo arquivo nos dois). Opcional e desligada.
   Com a chave da Anthropic que o dono põe em Ajustes, só as linhas em dúvida vão para o Claude junto com os nomes dos
   10 candidatos. Vai SÓ o texto do item e os nomes dos produtos (nada do cliente: nome, telefone, endereço).
   Tempo máximo 5 s; se não responder, fica como estava. A resposta volta como "sugerido pela IA".
   (A IA local agora é a aprende-produto.js: leve, sem download, aprende com as correções da loja.) */
'use strict';
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

/* r = resultado do casar-produto (já refinado pela IA local). Só mexe quando não teve certeza. Nunca devolve "alta".
   opc: {chave: 'sk-ant-...', simular: fn(linha, nomes) -> nome (testes sem chave), timeoutMs} */
async function refinar(it, r, produtos, opc) {
  opc = opc || {};
  if (r && r.p && r.conf === 'alta') return r;
  if (r && ['lembrado', 'apelido', 'codigo', 'aprendido'].includes(r.motivo)) return r;
  const cands = (r && r.candidatos || []).map(c => ({ p: c.p, sc: c.score }));
  let saida = r;
  if ((opc.chave || opc.simular) && cands.length) {
    const nomes = cands.slice(0, 10).map(c => c.p.nome);
    const resp = opc.simular ? { nome: await opc.simular(it.nome, nomes) } : await perguntarClaude(it.nome, nomes, opc.chave, opc);
    if (resp.nome) { const p = cands.find(c => c.p.nome === resp.nome).p; saida = { ...saida, p, conf: 'media', motivo: 'ia-nuvem', ia: 'nuvem', iaCusto: resp.custo }; }
    else if (!resp.erro) saida = { ...saida, p: null, conf: '', motivo: 'ia-nenhum', ia: 'nuvem', sugestao: null, iaCusto: resp.custo };   // a IA disse que nenhum serve: a tela pede para escolher
  }
  return saida;
}
async function preparar() {}
module.exports = { nuvem, PRECO, perguntarClaude, refinar, preparar };
