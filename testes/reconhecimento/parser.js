/* Leitura de pedidos de temperos escritos no WhatsApp. Usado pelo app (detecção) e pela tela (ficha). */
(function (root) {
  function norm(s){ return String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase(); }

  /* ---------- correção de nomes pela lista ---------- */
  function lev(a,b){
    const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
    let prev=Array.from({length:n+1},(_,j)=>j);
    for(let i=1;i<=m;i++){ const cur=[i];
      for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      prev=cur; }
    return prev[n];
  }
  function sim(a,b){
    if(a===b) return 1;
    if(a.length>=4 && b.startsWith(a)) return .9;
    if(b.length>=4 && a.startsWith(b)) return .9;
    if(Math.abs(a.length-b.length) > .3*Math.max(a.length,b.length)) return 0;   // nunca chega a .7: nem calcula
    return 1 - lev(a,b)/Math.max(a.length,b.length);
  }
  const STOP = new Set(["de","da","do","das","dos","em","e","com","sem","o","a","os","as"]);
  function words(s){ return norm(s).split(/[^a-z]+/).filter(w=>w.length>1 && !STOP.has(w)); }
  const CACHE_W = new Map();
  function wordsC(s){ let w = CACHE_W.get(s); if(!w){ w = words(s); if(CACHE_W.size > 50000) CACHE_W.clear(); CACHE_W.set(s, w); } return w; }
  /* chave usada para lembrar como o cliente escreveu: "Pápirca  Defumada!" -> "papirca defumada" */
  function normKey(s){ return words(s).join(" "); }
  /* mesmo casamento do Balcão PDV (casar-produto.js): linha com peso só vai para produto vendido por quilo,
     marca/embalagem no nome do produto pesa contra, abreviações (pim., temp., c/, s/) e "limão siciliano" -> limão natural */
  let CP = null;
  try { CP = (typeof require === "function") ? require("./casar-produto.js") : root.CasarProduto; } catch(e) { CP = root.CasarProduto || null; }
  // unidade conhecida (sincronizada do Balcão: "kg" ou "un"); nome sem unidade conhecida é tratado como granel
  const unidadeDe = (nome, unidades) => (unidades || {})[norm(String(nome).trim())] || "kg";
  // a lista de produtos montada uma vez (o casamento guarda um índice dela)
  let PROD_CACHE = null;
  function produtosDe(catalog, unidades){
    const sig = catalog.length + "|" + catalog[0] + "|" + catalog[catalog.length-1] + "|" + catalog.join("").length;
    if(PROD_CACHE && PROD_CACHE.unidades === unidades && PROD_CACHE.sig === sig) return PROD_CACHE.lista;
    PROD_CACHE = {sig, unidades, lista: catalog.map(c=>({id:c, nome:c, unidade:unidadeDe(c, unidades)}))};
    return PROD_CACHE.lista;
  }
  /* aliases = correções aprendidas: { "papirca defumada": "Páprica defumada", ... }
     opc = { unidades: {nome: "kg"|"un"}, unidade: unidade da linha ("kg","g","un","pacote","pote" ou "") , quantidade } */
  function matchCatalog(name, catalog, aliases, opc){
    aliases = aliases || {}; opc = opc || {};
    const iw = words(name);
    if(!iw.length) return {nome:name.trim(), achou:false};
    const key = iw.join(" ");
    const peso = !opc.unidade || opc.unidade === "kg" || opc.unidade === "g";
    const coerente = nome => !peso || unidadeDe(nome, opc.unidades) === "kg";   // nunca peso em produto vendido por unidade
    if(aliases[key] && coerente(aliases[key])) return {nome:aliases[key], achou:true, aprendido:true, score:1};
    if(CP){
      const produtos = produtosDe(catalog, opc.unidades);
      const it = {nome:name, quantidade:opc.quantidade, unidade: opc.unidade==="pacote" ? "pct" : (opc.unidade || "kg")};
      const r = CP.casar(it, produtos, [], {pesagem:true});
      const candidatos = (r.candidatos || []).map(c => ({nome: c.p.nome, score: c.score}));
      if(r.p) return {nome:r.p.nome, achou:true, aprendido:false, score: r.conf==="alta" ? Math.max(r.score, .9) : r.score, conf:r.conf, alternativas:(r.alternativas||[]).map(p=>p.nome), candidatos};
      if(r.motivo === "so-unidade") return {nome:name.trim().replace(/^./,c=>c.toUpperCase()), achou:false, score:0, soUnidade: r.sugestao && r.sugestao.nome, candidatos};
      if(CP.lerLinha) return {nome:name.trim().replace(/^./,c=>c.toUpperCase()), achou:false, score:r.score || 0, candidatos};   // o casamento novo já tolera erro de digitação: o antigo só erraria mais
    }
    // reserva: o casamento antigo (aceita mais erros de digitação), só entre produtos da mesma unidade
    const candidatos = catalog.filter(coerente).map(c=>({texto:c, alvo:c, aprendido:false}))
      .concat(Object.keys(aliases).filter(k=>coerente(aliases[k])).map(k=>({texto:k, alvo:aliases[k], aprendido:true})));
    let best=null, bestScore=0;
    for(const c of candidatos){
      const cw = wordsC(c.texto); if(!cw.length) continue;
      let hit=0;
      for(const w of iw){ let b=0; for(const x of cw) b=Math.max(b,sim(w,x)); if(b>=.7) hit+=b; }
      const score = hit/iw.length*0.7 + hit/cw.length*0.3;
      if(score>bestScore){ bestScore=score; best=c; }
    }
    if(best && bestScore>=.45) return {nome:best.alvo, achou:true, aprendido:best.aprendido, score:bestScore};
    return {nome:name.trim().replace(/^./,c=>c.toUpperCase()), achou:false, score:bestScore};
  }

  /* ---------- quantidades ---------- */
  function fixQty(q){
    q = String(q ?? "").trim();
    if(/^0\d+$/.test(q)) q = q.replace(/^0+/,"");   // "05" = 5, nunca 0,5
    return q.replace(".",",");
  }
  const NUM = {"um":"1","uma":"1","dois":"2","duas":"2","tres":"3","quatro":"4","cinco":"5","seis":"6","sete":"7","oito":"8","nove":"9","dez":"10"};
  function toNum(q){ q=String(q).trim(); const n=parseFloat(q.replace(",",".")); return isNaN(n)?0:n; }
  function unitOf(u){
    u = norm(u||"");
    if(!u) return "";
    if(/^(kg|kilo|quilo|k)/.test(u)) return "kg";
    if(/^(pac|pct)/.test(u)) return "pacote";
    if(/^pot/.test(u)) return "pote";
    if(/^(un|unid)/.test(u)) return "un";
    return "g";
  }

  /* ---------- texto copiado do WhatsApp ----------
     Ao copiar várias mensagens, o WhatsApp põe "[08:12, 20/10/2026] Nome: texto" em cada uma. */
  const WA_LINE = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?,\s*\d{1,2}\/\d{1,2}\/\d{2,4}\]\s*([^:]{1,60}):\s?/;
  function stripWhatsApp(text){
    const nomes = [];
    const linhas = String(text).replace(/\r/g,"").split("\n").map(l=>{
      const m = l.match(WA_LINE);
      if(m){ nomes.push(m[1].trim()); return l.slice(m[0].length); }
      return l;
    });
    return {texto: linhas.join("\n"), cliente: nomes[0] || ""};
  }

  /* ---------- leitura da mensagem ---------- */
  const FILLER = /\b(boa|bom|tarde|dia|noite|oi|ola|olá|tudo|bem|quero|qero|queria|kero|preciso|gostaria|manda|mande|me|ve|vê|tbm|tb|tambem|também|por favor|pfv|pf|obg|obrigad[oa]|ai|aí|mais|so|só|isso|favor|um|uma)\b/gi;
  const U = "(kg|kgs|kilos?|quilos?|g|gr|grs|grama?s?|pacotes?|pcts?|pct|potes?|un|unid|unidades?)";
  const UNI_FICHA = {kg:"kg", g:"g", pct:"pacote", pote:"pote", un:"un", cx:"un", frasco:"un", lata:"un", sache:"pacote", caps:"un", ml:"un", l:"un"};

  /* quantidade, unidade e nome de um pedaço da mensagem ("1kg de cominho", "colorau meio quilo", "ana maria 500") */
  function lerParte(p){
    if(CP && CP.lerLinha){
      const r = CP.lerLinha(p, {pesagem:true});
      if(r.quantidade == null || !r.nome) return null;
      return {q: String(r.quantidade), u: UNI_FICHA[r.unidade] || "", name: r.nome, explicita: !!r.unidadeEscrita};
    }
    let m;
    if((m = p.match(new RegExp("^(.*?[a-zà-ú].*?)\\s*[-:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*"+U+"?\\.?$","i")))) return {name:m[1], q:m[2], u:unitOf(m[3]), explicita:!!m[3]};
    if((m = p.match(new RegExp("(\\d+(?:[.,]\\d+)?)\\s*(?:"+U+"\\b\\.?)?\\s*(?:de\\s+|d[aoe]\\s+)?([a-zà-ú].*)$","i")))) return {q:m[1], u:unitOf(m[2]), name:m[3], explicita:!!m[2]};
    return null;
  }
  const limparNome = n => String(n).replace(/[!?.()*]/g," ").replace(/\s+/g," ").trim().replace(/^(de|d[aoe])\s+/i,"");

  function parse(rawText, opts){
    opts = opts || {};
    const catalog = (opts.catalog || []).map(s=>String(s).trim()).filter(Boolean);
    const aliases = opts.aliases || {};
    const MIN_G = opts.minG ?? 250;
    const wa = stripWhatsApp(rawText);
    const itens=[], duvidas=[];
    let explicitUnits = 0, matched = 0, fortes = 0;

    let t = " " + wa.texto + " ";
    t = t.replace(/\b(\d+)\s*(kg|kilos?|quilos?)\s+e\s+meio\b/gi,(_,n)=>" "+(+n*1000+500)+" g ");
    t = t.replace(/\bum\s+(kg|kilo|quilo)\s+e\s+meio\b/gi," 1500 g ");
    t = t.replace(/\b(meio|1\/2)\s*(kg|kilo|quilo)\b/gi," 500 g ");
    t = t.replace(/\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(?=(kg|kilos?|quilos?|pacotes?|pcts?|potes?|unidades?|gramas?)\b)/gi,(m,w)=>" "+NUM[norm(w)]+" ");

    t = t.replace(/\b(pim|temp|desid|def|moid|nat)\.\s+/gi,"$1 ");   // "pim. calabresa" é um item só (o ponto não separa)
    t = t.replace(/\b(\d{1,2}):(\d{2})\b/g,"$1h$2");                   // "15:30" é hora: os dois-pontos não separam
    // separa os itens guardando o separador ("salsa, cebola e bacon" pode ser um produto só)
    const pedacos = t.split(/(\n|(?<!\d),|,(?!\d)|;|\.\s|\s+e\s+|\s+\+\s+)/i);
    const parts = [], seps = [];
    for(let i=0;i<pedacos.length;i+=2){ const x = (pedacos[i]||"").trim(); if(x){ parts.push(x); seps.push((pedacos[i+1]||"").trim().toLowerCase()); } }
    // na vigia da área de transferência, texto com muitas partes não é pedido de tempero (planilha, relatório): nem procura produto
    if(opts.maxPartes && parts.length > opts.maxPartes) return {cliente: wa.cliente, itens: [], duvidas: [], texto: wa.texto.trim(), matched: 0, explicitUnits: 0, fortes: 0, grande: true};
    const CAMPO = /^(nome|telefone|tel|fone|celular|whats(app)?|endere[cç]o|cep|cnpj|cpf|nota fiscal|pagamento|entrega|estimativa|total|subtotal|desconto|obs(erva[cç](ão|oes|ões))?|c[oó]digo|pedido n)\b\s*[:\-]/i;
    const casa = (name, u, q) => matchCatalog(name, catalog, aliases, {unidades: opts.unidades, unidade: u, quantidade: q});
    const juntavel = s => s === "," || s === "e";
    const juntar = (a, b) => parts.slice(a, b+1).map((x, k) => x + (a+k < b ? (seps[a+k] === "," ? ", " : " e ") : "")).join("");   // mantém a vírgula e o "e" do cliente
    for(let i=0;i<parts.length;i++){
      const p = parts[i];
      if(CAMPO.test(p)) continue;
      let lido = lerParte(p);
      // "salsa, cebola e bacon 500g" / "500g salsa, cebola e bacon": junta os pedaços sem quantidade quando viram um produto da lista
      if(CP){
        if(!lido && i+1 < parts.length && juntavel(seps[i])){
          let k = i+1; while(k < parts.length-1 && juntavel(seps[k]) && !lerParte(parts[k])) k++;
          const tudo = juntar(i, k), lj = lerParte(tudo), so = lerParte(parts[k]);
          if(lj && so){ const a = casa(limparNome(lj.name), lj.u, lj.q), b = casa(limparNome(so.name), so.u, so.q);
            if(a.achou && a.conf !== "baixa" && a.score >= .85 && !(b.achou && b.score > a.score)){ lido = lj; i = k; } }
        } else if(lido && i+1 < parts.length && juntavel(seps[i]) && !lerParte(parts[i+1])){
          let k = i+1; while(k+1 < parts.length && juntavel(seps[k]) && !lerParte(parts[k+1])) k++;
          const nomeJ = lido.name + (seps[i] === "," ? ", " : " e ") + juntar(i+1, k), a = casa(limparNome(nomeJ), lido.u, lido.q);
          if(a.achou && a.conf !== "baixa" && a.score >= .85){ const b = casa(limparNome(lido.name), lido.u, lido.q); if(!(b.achou && b.score > a.score)){ lido = {...lido, name: nomeJ}; i = k; } }
        }
      }
      if(!lido) continue;
      let {q, u, name} = lido;
      if(!CP) name = name.replace(FILLER," ");
      name = limparNome(name);
      if(!name || name.length > 60) continue;
      if(CP && CP.ehConversa && CP.ehConversa(name)) continue;          // "retiro as 17h", "troco pra 50": não é item
      let unid = u;
      const prod = casa(name, unid, q);
      let qty = fixQty(q);
      if(unid && lido.explicita !== false) explicitUnits++;
      if(prod.achou) matched++;
      if(prod.achou && (prod.aprendido || (prod.conf ? prod.conf === "alta" : prod.score >= .75))) fortes++;   // reconhecido com segurança
      if(!unid){
        unid="kg";
        if(toNum(qty) > 20) duvidas.push(`${prod.nome}: veio só "${qty}", virou ${qty} kg. Confira se não eram gramas.`);
      }
      const gramas = unid==="kg" ? toNum(qty)*1000 : unid==="g" ? toNum(qty) : null;
      if(gramas!==null && gramas>0 && gramas<MIN_G){
        duvidas.push(`${prod.nome}: cliente pediu ${qty} ${unid}, ajustado para o mínimo de ${MIN_G} g.`);
        qty = String(MIN_G); unid = "g";
      }
      if(unid==="pacote"||unid==="pote") duvidas.push(`${prod.nome}: confirmar o tamanho do ${unid}.`);
      if(!prod.achou) duvidas.push(prod.soUnidade ? `"${name}": só achei ${prod.soUnidade}, que é vendido por unidade. Escolha o produto a granel.` : `"${name}" não está na lista de produtos. Confira o nome.`);
      else if(prod.conf && prod.conf !== "alta") duvidas.push(`"${name}" virou ${prod.nome}: confira${prod.alternativas && prod.alternativas.length ? " (também pode ser " + prod.alternativas.join(" ou ") + ")" : ""}.`);
      const item = {produto:prod.nome, quantidade:qty, unidade:unid, alerta:!prod.achou, bruto:name};
      if(prod.achou && prod.conf && prod.conf !== "alta"){ item.confira = true; item.conf = prod.conf; }
      if(prod.achou && prod.conf) item.conf = prod.conf;
      if(prod.candidatos) Object.defineProperty(item, "candidatos", {value: prod.candidatos, enumerable: false});   // para a IA (não vai para o arquivo)
      itens.push(item);
    }
    return {cliente: wa.cliente, itens, duvidas, texto: wa.texto.trim(), matched, explicitUnits, fortes};
  }

  /* ---------- filtro: textos que não são pedido ----------
     Boletos, Pix, notas fiscais, comprovantes e extratos também têm números e quantidades.
     Devolve o motivo quando o texto tem cara de documento; senão, "". */
  const MARCAS_DOC = ["boleto","vencimento","beneficiario","pagador","linha digitavel","codigo de barras","nosso numero","agencia",
    "conta corrente","fatura","danfe","chave de acesso","valor do documento","juros","multa","comprovante","transferencia","saldo",
    "extrato","autenticacao","cedente","sacado","documento auxiliar","protocolo de autorizacao","data de emissao","natureza da operacao",
    "codigo de verificacao","seu codigo","senha","pague ate","valor cobrado","id da transacao"];
  const PEDIDO_DO_SITE = /^\s*ol[aá],\s*[^!\n]{2,40}!\s*(gostaria de fazer um pedido|quero pedir|quero um orçamento)/i;
  function pareceDocumento(text){
    const t = String(text||""), n = norm(t), corrido = t.replace(/[\s.\-\/]/g,"");
    if(PEDIDO_DO_SITE.test(t)) return "";                                     // pedido montado no site da loja
    if(/^0002\d{2}/.test(corrido) || /br\.gov\.bcb\.pix/i.test(t)) return "código Pix";
    if(/\d{44,}/.test(corrido)) return "linha de boleto, código de barras ou chave de nota";
    if(/\d{5}\.?\d{5}\s+\d{5}\.?\d{6}\s+\d{5}\.?\d{6}/.test(t)) return "linha digitável de boleto";
    const marcas = MARCAS_DOC.filter(m => n.includes(m));
    if(marcas.length >= 2) return "documento (" + marcas.slice(0,3).join(", ") + ")";
    if((t.match(/R\$\s*\d/g) || []).length >= 3) return "lista de valores";
    const semEsp = t.replace(/\s/g,""), dig = (semEsp.match(/\d/g) || []).length;
    if(semEsp.length >= 30 && dig / semEsp.length > .45) return "texto quase só de números";
    if(/^\s*\S+@\S+\.\S+\s*$/.test(t)) return "e-mail";
    if(/^\s*https?:\/\/\S+\s*$/i.test(t)) return "link";
    if(/^\s*[{\[]/.test(t) && /[}\]]\s*$/.test(t)) return "código";
    return "";
  }

  /* Parece pedido?
     Sem filtro: um produto da lista reconhecido, ou dois itens com unidade escrita (g, kg, pacote...).
     Com o filtro de temperos (padrão): nada com cara de documento, pelo menos um tempero da lista
     reconhecido com segurança e a maior parte dos itens sendo produtos da lista. */
  function looksLikeOrder(text, opts){
    opts = opts || {};
    if(!text || text.length < 4 || text.length > 4000) return null;
    if(/^https?:\/\//i.test(text.trim())) return null;
    const filtro = opts.filtro !== false;
    if(filtro && pareceDocumento(text)) return null;
    const r = parse(text, opts);
    if(!r.itens.length) return null;
    if(!filtro) return (r.matched >= 1 || r.explicitUnits >= 2) ? r : null;
    if(PEDIDO_DO_SITE.test(text) && r.matched >= 1) return r;
    if(r.fortes >= 1 && r.matched / r.itens.length >= .5) return r;
    return null;
  }
  /* para mostrar por que um texto copiado foi ignorado */
  function motivoIgnorado(text, opts){
    const d = pareceDocumento(text); if(d) return d;
    const r = parse(text, opts||{});
    if(!r.itens.length) return "sem quantidades";
    if(!r.fortes) return "nenhum tempero da lista";
    return "poucos itens da lista";
  }

  const api = {parse, looksLikeOrder, pareceDocumento, motivoIgnorado, norm, normKey, produtosDe};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pedidos = api;
})(typeof window !== "undefined" ? window : globalThis);
