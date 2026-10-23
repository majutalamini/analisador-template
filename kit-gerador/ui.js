  // ==========================================================================
  // Interface nativa (Next Fit) — usa a lógica da extensão carregada acima:
  //   NS.TemplateLinter (linter.browser.js), NS.DocxCompressor (compressor.js),
  //   DEFAULT_SCHEMA (reference-schema.json) e as listas de variáveis do popup.js.
  // ==========================================================================

  const VERSAO = '9.8.0';
  const TemplateLinter = NS.TemplateLinter;
  const DocxCompressor = NS.DocxCompressor;

  // ---------- Preferências (ficam só neste navegador) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('nfAnalisador.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('nfAnalisador.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
    del(k) { try { localStorage.removeItem('nfAnalisador.' + k); } catch (e) { /* sem armazenamento */ } }
  };
  const cfg = Object.assign({ extras: '', referencia: null, referenciaArquivos: [] }, store.get('config', {}));

  const limparNome = (s) => s.replace(/[<>\[\]\s]/g, '');
  function extrasLista() {
    return (cfg.extras || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
      const img = /^image\s*:/i.test(s);
      return { name: limparNome(s.replace(/^image\s*:/i, '')), img };
    }).filter(e => e.name);
  }

  // Modelo de referência efetivo = padrão da extensão + modelos .docx enviados + variáveis extras.
  function schemaAtual() {
    const out = {};
    for (const [k, v] of Object.entries(DEFAULT_SCHEMA)) out[k] = new Set(v);
    if (cfg.referencia) {
      for (const [k, v] of Object.entries(cfg.referencia)) {
        if (!out[k]) out[k] = new Set();
        v.forEach(x => out[k].add(x));
      }
    }
    for (const e of extrasLista()) {
      (e.img ? out.imageVariables : out.variables).add(e.name);
      out.allIdentifiers.add(e.name);
    }
    const arr = {};
    for (const [k, v] of Object.entries(out)) arr[k] = [...v].sort();
    return arr;
  }

  // ---------- Montagem da tela ----------
  const ROOT_ID = 'nf-analisador-templates';
  const antigo = document.getElementById(ROOT_ID);
  if (antigo) antigo.remove();
  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ico = {
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    comp: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
    chev: '<path d="M6 15l6-6 6 6"/>',
    lupa: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    ir: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };
  const svg = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ico[n]}</svg>`;
  const dropHtml = (tipo) => `
    <label class="drop" data-drop="${tipo}">
      ${svg('up', 28)}
      <span class="dt">Arraste o arquivo aqui ou <b>clique para escolher</b></span>
      <span class="muted" style="font-size:12px">Somente arquivos .docx</span>
      <span class="fname" hidden></span>
      <input class="sr" type="file" accept=".docx" data-file="${tipo}">
    </label>`;

  root.innerHTML = `
<style>
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.ov,.fab,.toast{font-family:Roboto,"Segoe UI",Arial,sans-serif}
.ov{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:#eeeeee;overflow:auto;color:#424242;font-size:16px;line-height:1.4}
.page{padding:28px 40px 48px;max-width:1440px}
.head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px}
h1{margin:0;font-size:24px;font-weight:500;color:#424242}
h2{margin:0;font-size:16px;font-weight:500;color:#424242}
.actions{margin-left:auto;display:flex;gap:12px;align-items:center}
.btn{font:inherit;font-size:14px;font-weight:500;letter-spacing:.4px;text-transform:uppercase;border-radius:4px;padding:0 18px;min-height:44px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.btn:disabled{opacity:.45;cursor:not-allowed}
.pri{background:#7B1FA2;color:#fff;border:0}.pri:hover:not(:disabled){background:#6A1B9A}
.out{background:#fff;color:#7B1FA2;border:2px solid #7B1FA2}.out:hover:not(:disabled){background:#FCF8FD}
.txt{background:transparent;color:#7B1FA2;border:0;padding:0 10px}.txt:hover:not(:disabled){background:#F3E5F5}
.icon{width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:#616161;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.icon:hover{background:#e0e0e0}
.icon:disabled{opacity:.4;cursor:not-allowed}
.icon.girando svg{animation:gira .8s linear infinite}
@keyframes gira{to{transform:rotate(360deg)}}
.card{background:#fff;border-radius:8px;padding:8px 24px 24px}
.tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid #e0e0e0}
.tab{font:inherit;font-size:15px;font-weight:500;text-transform:uppercase;background:transparent;border:0;border-bottom:2px solid transparent;color:#424242;cursor:pointer;min-height:56px;flex:1 1 160px}
.tab[aria-selected="true"]{color:#7B1FA2;border-bottom-color:#7B1FA2}
.panel{padding-top:24px;display:flex;flex-direction:column;gap:24px}
.lead{margin:0;font-size:17px;color:#616161}
.row{display:flex;flex-wrap:wrap;gap:24px;align-items:stretch}
.box{flex:1 1 360px;border:1px solid #e0e0e0;border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:18px;background:#fff;min-width:0}
.box.hl{border-color:#CE93D8;background:#FCF8FD}
.bh{display:flex;gap:16px;align-items:flex-start}
.ic{width:44px;height:44px;border-radius:8px;background:#7B1FA2;color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.ic.soft{background:#F3E5F5;color:#7B1FA2}
.tt{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.tt h2{font-size:18px}
.badge{font-size:11px;font-weight:700;letter-spacing:.6px;border-radius:10px;padding:3px 10px}
.b-ok{color:#1B5E20;background:#E8F5E9}.b-roxo{color:#6A1B9A;background:#F3E5F5;font-size:12px}
.info{position:relative;display:inline-flex;color:#8A4B00;cursor:help}
.info .dica{display:none;position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);width:280px;background:#424242;color:#fff;font-size:13px;font-weight:400;line-height:1.4;border-radius:6px;padding:10px 12px;z-index:3}
.info:hover .dica,.info:focus .dica{display:block}
.muted{color:#616161;font-size:14px}
.ou{display:flex;align-items:center;justify-content:center}
.ou span{font-size:14px;font-weight:500;color:#616161;background:#eeeeee;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center}
.lbl{font-size:12px;color:#616161;display:block}
.in{font:inherit;font-size:16px;color:#424242;border:0;border-bottom:1px solid #9e9e9e;padding:10px 0;width:100%;background:transparent;outline:none}
.in:focus{border-bottom:2px solid #7B1FA2;padding-bottom:9px}
.ta{font-family:"Roboto Mono",Consolas,monospace;font-size:14px;color:#424242;border:1px solid #bdbdbd;border-radius:4px;padding:10px 12px;width:100%;min-height:110px;resize:vertical;outline:none;background:#fff}
.ta:focus{border-color:#7B1FA2;box-shadow:0 0 0 1px #7B1FA2}
.acts{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap}
a.lnk{color:#7B1FA2;font-size:14px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:44px}
a.lnk:hover{color:#4A148C}
.drop{border:2px dashed #bdbdbd;border-radius:8px;padding:24px;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;text-align:center;background:#fff;color:#7B1FA2}
.drop.over,.drop:hover{border-color:#7B1FA2;background:#FCF8FD}
.drop .dt{font-size:15px;color:#424242}.drop .dt b{color:#7B1FA2;font-weight:500}
.drop .fname{font-weight:500;color:#6A1B9A;word-break:break-all;font-size:14px}
.sr{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}
code{font-family:"Roboto Mono",Consolas,monospace;font-size:13px}
.msg{font-size:14px;color:#616161;margin:0}
.msg.err{color:#B71C1C}
.res{border:1px solid #e0e0e0;border-radius:8px;overflow:hidden}
.rhead{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:20px 24px;border-bottom:1px solid #eeeeee}
.chips{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.chip{font-size:13px;font-weight:500;border-radius:14px;padding:6px 12px}
.c-ok{color:#1B5E20;background:#E8F5E9}.c-er{color:#B71C1C;background:#FFEBEE}.c-av{color:#8A4B00;background:#FFF3E0}
.issue{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;padding:16px 24px;border-bottom:1px solid #eeeeee}
.issue:last-child{border-bottom:0}
.tipo{font-size:12px;font-weight:700;letter-spacing:.5px;border-radius:4px;padding:4px 10px;min-width:64px;text-align:center;background:#FFEBEE;color:#B71C1C}
.idet{flex:1 1 320px;display:flex;flex-direction:column;gap:6px;min-width:0}
.idet .m{font-size:15px;color:#424242;word-break:break-word}
.trecho{font-family:"Roboto Mono",Consolas,monospace;font-size:13px;color:#616161;background:#fafafa;border-radius:4px;padding:6px 10px;word-break:break-word}
.onde{font-size:12px;color:#616161}
.iacts{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.tudo-ok{padding:20px 24px;color:#1B5E20;font-size:15px;display:flex;align-items:center;gap:10px}
.vtop{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end}
.busca{flex:0 1 380px;display:flex;align-items:flex-end;gap:10px;color:#616161}
.grp{border:1px solid #e0e0e0;border-radius:8px;background:#fafafa}
.ghead{width:100%;background:transparent;border:0;cursor:pointer;display:flex;align-items:center;gap:12px;padding:16px 20px;min-height:56px;font:inherit;color:#616161}
.gname{font-size:14px;font-weight:700;letter-spacing:.8px;color:#6A1B9A;text-transform:uppercase;text-align:left}
.gcount{font-size:12px;font-weight:500;color:#6A1B9A;background:#F3E5F5;border-radius:10px;padding:2px 9px}
.chev{margin-left:auto;display:flex;transition:transform .2s}
.grp.fechado .chev{transform:rotate(180deg)}
.gnota{margin:0 20px 14px;font-size:13px;color:#8A4B00;background:#FFF3E0;border-radius:6px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start}
.grid{padding:0 20px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.grid.uma{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.grp.fechado .grid,.grp.fechado .gnota{display:none}
.var{font:inherit;text-align:left;background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:14px 16px;cursor:pointer;display:flex;flex-direction:column;gap:6px;position:relative;min-height:96px}
.var:hover,.var:focus-visible{border-color:#7B1FA2;outline:none;box-shadow:0 0 0 1px #7B1FA2}
.var.copiado{border-color:#2E7D32;box-shadow:0 0 0 1px #2E7D32}
.vtag{font-size:11px;font-weight:700;letter-spacing:.6px;color:#6A1B9A;background:#F3E5F5;border-radius:4px;padding:2px 8px;align-self:flex-start;text-transform:uppercase}
.vtag.img{color:#0D47A1;background:#E3F2FD}
.vtag.est{color:#1B5E20;background:#E8F5E9}
.vnome{font-size:16px;font-weight:500;color:#424242}
.vcod{color:#616161;word-break:break-all}
.var.copiado .vcod,.var.copiado .vnome.ok{color:#1B5E20;font-weight:500}
.tip{display:none;position:absolute;left:12px;bottom:calc(100% + 6px);background:#424242;color:#fff;font-size:13px;font-weight:500;border-radius:6px;padding:8px 12px;white-space:nowrap;z-index:2}
.var:hover .tip,.var:focus-visible .tip{display:block}
.nada{padding:20px;color:#616161;font-size:15px}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:15px;border-bottom:1px solid #eeeeee;padding-bottom:12px}
.kv span:first-child{color:#616161}
.kv .red{color:#1B5E20;font-weight:500}
.chk{display:flex;gap:12px;align-items:flex-start;cursor:pointer;font-size:15px;line-height:1.45}
.chk input{width:20px;height:20px;margin:2px 0 0;accent-color:#7B1FA2;flex:0 0 auto}
.chk b{font-weight:500}
.prog{display:flex;flex-direction:column;gap:8px}
.trilho{height:6px;background:#F3E5F5;border-radius:3px;overflow:hidden}
.barra{height:100%;width:0;background:#7B1FA2;transition:width .25s}
.indet{height:4px;background:#F3E5F5;border-radius:2px;overflow:hidden;position:relative}
.indet::after{content:"";position:absolute;top:0;bottom:0;left:0;width:40%;background:#7B1FA2;animation:ld 1.1s infinite ease-in-out}
@keyframes ld{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.rcard{border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:10px;font-size:15px}
.rcard.ok{background:#E8F5E9;color:#1B5E20}.rcard.err{background:#FFEBEE;color:#B71C1C}
.rcard ul{margin:0;padding-left:20px;color:#424242;font-size:14px;display:flex;flex-direction:column;gap:4px}
.end{display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap}
.refs{display:flex;flex-wrap:wrap;gap:8px}
.foot{margin-top:24px;font-size:12px;color:#616161;text-align:right;display:flex;flex-direction:column;gap:2px}
.hist{background:#fff;border-radius:8px;padding:8px 24px 16px;margin-bottom:16px}
.hrow{display:flex;gap:16px;flex-wrap:wrap;align-items:center;padding:12px 0;border-bottom:1px solid #eeeeee;font-size:14px}
.hrow:last-child{border-bottom:0}
.hrow .hn{flex:1 1 240px;font-weight:500;word-break:break-all}
.fab{position:fixed;right:24px;bottom:24px;z-index:2147483001;background:#7B1FA2;color:#fff;border:0;border-radius:28px;min-height:52px;padding:0 22px 0 18px;font-size:14px;font-weight:500;letter-spacing:.4px;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;gap:10px;box-shadow:0 3px 10px rgba(0,0,0,.3)}
.fab:hover{background:#6A1B9A}
.toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#323232;color:#fff;padding:14px 20px;border-radius:4px;font-size:14px;z-index:2147483002;box-shadow:0 3px 10px rgba(0,0,0,.3);max-width:90vw}
@media (max-width:700px){.page{padding:16px}.card{padding:8px 12px 16px}}
</style>

<div class="ov" role="dialog" aria-label="Analisador de templates" hidden>
  <div class="page">
    <div class="head">
      <h1>Analisador de templates (DOCX)</h1>
      <div class="actions">
        <button class="btn out" data-act="hist" aria-expanded="false">${svg('hist', 20)}Histórico</button>
        <button class="icon" data-act="fechar" aria-label="Fechar analisador">${svg('x', 22)}</button>
      </div>
    </div>
    <div class="hist" hidden></div>

    <section class="card">
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="analisar" aria-selected="true">Analisar</button>
        <button class="tab" role="tab" data-tab="variaveis" aria-selected="false">Variáveis</button>
        <button class="tab" role="tab" data-tab="personalizacao" aria-selected="false">Personalização</button>
        <button class="tab" role="tab" data-tab="compressor" aria-selected="false">Compressor</button>
      </div>

      <div class="panel" data-panel="analisar">
        <p class="lead">Envie o template do contrato para conferir, linha por linha, se as tags e variáveis estão corretas. Escolha uma das duas formas:</p>
        <div class="row">
          <div class="box hl">
            <div class="bh">
              <div class="ic">${svg('link')}</div>
              <div>
                <div class="tt">
                  <h2>Link do Google Docs</h2>
                  <span class="info" tabindex="0" aria-label="Atenção">${svg('alerta', 16)}<span class="dica">O documento precisa estar compartilhado como público ("Qualquer pessoa com o link pode visualizar") para que a análise funcione.</span></span>
                  <span class="badge b-ok">RECOMENDADO</span>
                </div>
                <span class="muted">Em cada erro, use "Ir para o trecho" para abrir o documento no ponto certo.</span>
              </div>
            </div>
            <div>
              <label class="lbl" for="gd">Link do documento</label>
              <input class="in" id="gd" type="url" placeholder="https://docs.google.com/document/d/..." autocomplete="off" spellcheck="false">
            </div>
            <div class="acts">
              <button class="btn pri" data-act="gdocs" disabled>Analisar link</button>
              <button class="icon" data-act="atualizar" aria-label="Buscar alterações mais recentes do documento" title="Buscar alterações mais recentes do documento" hidden>${svg('refresh', 20)}</button>
              <a class="lnk" href="https://docs.google.com/document/u/0/?tgif=d" target="_blank" rel="noopener noreferrer">Abrir Google Docs ${svg('ext', 16)}</a>
            </div>
            <p class="msg" data-msg="gdocs" hidden></p>
          </div>
          <div class="ou"><span>OU</span></div>
          <div class="box">
            <div class="bh" style="align-items:center">
              <div class="ic soft">${svg('doc')}</div>
              <h2 style="font-size:18px">Arquivo .docx do computador</h2>
            </div>
            ${dropHtml('analisar')}
            <div><button class="btn out" data-act="analisar" disabled>Analisar arquivo</button></div>
          </div>
        </div>
        <div class="res" data-res>
          <div style="padding:24px;display:flex;flex-direction:column;gap:8px">
            <h2>Resultado da análise</h2>
            <span class="muted" style="font-size:15px">Envie um template para ver aqui os problemas encontrados e onde corrigi-los.</span>
          </div>
        </div>
      </div>

      <div class="panel" data-panel="variaveis" hidden>
        <div class="vtop">
          <p class="lead" style="flex:1 1 360px">Clique em uma variável para copiá-la e cole no seu template exatamente como aparece.</p>
          <div class="busca">
            ${svg('lupa', 20)}
            <div style="flex:1">
              <label class="lbl" for="bv">Buscar variável</label>
              <input class="in" id="bv" type="search" placeholder="Ex.: CPF, e-mail, parcela" autocomplete="off" spellcheck="false">
            </div>
          </div>
        </div>
        <div data-grupos style="display:flex;flex-direction:column;gap:16px"></div>
      </div>

      <div class="panel" data-panel="personalizacao" hidden>
        <p class="lead">Ajuste o modelo de referência usado na análise. As alterações ficam salvas neste navegador e valem para as abas Analisar e Variáveis.</p>
        <div class="row" style="align-items:flex-start">
          <div class="box">
            <div class="bh">
              <div class="ic soft">${svg('doc')}</div>
              <div>
                <h2 style="font-size:18px;margin-bottom:4px">Modelo de referência</h2>
                <span class="muted">Envie templates .docx que já funcionam no sistema. As variáveis, condições e laços deles passam a ser aceitos, além dos do modelo padrão.</span>
              </div>
            </div>
            <div class="kv"><span>Modelo em uso</span><span data-k="modelo">Padrão</span></div>
            <div class="kv"><span>Variáveis de texto</span><span data-k="nvars">—</span></div>
            <div class="kv" style="border:0;padding:0"><span>Condições e laços</span><span data-k="nlogica">—</span></div>
            <div class="refs" data-refs></div>
            <label class="drop" data-drop="referencia" style="padding:18px">
              ${svg('up', 24)}
              <span class="dt">Arraste um ou mais .docx ou <b>clique para escolher</b></span>
              <input class="sr" type="file" accept=".docx" multiple data-file="referencia">
            </label>
            <div class="end">
              <button class="btn txt" data-act="restaurar">Restaurar padrão</button>
            </div>
            <p class="msg" data-msg="ref" hidden></p>
          </div>
          <div class="box">
            <div>
              <h2 style="font-size:18px">Variáveis extras aceitas</h2>
              <p class="muted" style="margin:6px 0 0">Uma por linha, só o nome (ex.: ValorPlano). Para variável de imagem, escreva <code>image:NomeDaVariavel</code>. Elas aparecem na aba Variáveis em "Outras variáveis".</p>
            </div>
            <textarea class="ta" id="ex" aria-label="Variáveis extras aceitas" spellcheck="false"></textarea>
            <div class="end"><button class="btn pri" data-act="salvar">Salvar</button></div>
          </div>
        </div>
      </div>

      <div class="panel" data-panel="compressor" hidden>
        <div class="row" style="align-items:flex-start">
          <div class="box hl" style="flex:1 1 420px">
            <div class="bh">
              <div class="ic">${svg('comp')}</div>
              <div>
                <div class="tt"><h2>Comprimir .docx</h2><span class="badge b-roxo">até 2 MB</span></div>
                <span class="muted">Reduz as imagens do documento. O texto e a formatação não mudam, e o arquivo não sai do seu computador.</span>
              </div>
            </div>
            ${dropHtml('compressor')}
            <label class="chk"><input type="checkbox" id="rf"><span><b>Remover fontes incorporadas, se necessário.</b> <span class="muted">Só vale para documentos com fontes embutidas; as letras podem mudar de aparência.</span></span></label>
            <div><button class="btn pri" data-act="comprimir" disabled>Comprimir para até 2 MB</button></div>
            <div class="prog" hidden><span class="muted" data-ptxt></span><div class="trilho"><div class="barra"></div></div></div>
          </div>
          <div class="box" style="flex:1 1 320px">
            <h2>Resultado</h2>
            <div class="kv"><span>Tamanho original</span><span data-k="orig">—</span></div>
            <div class="kv"><span>Tamanho final</span><span data-k="final">—</span></div>
            <div class="kv" style="border:0;padding:0"><span>Redução</span><span data-k="red">—</span></div>
            <div class="rcard" data-rcard hidden><strong data-rtitulo></strong><ul data-rdet></ul></div>
            <button class="btn out" data-act="baixar" disabled>${svg('down', 18)}<span data-blabel>Baixar arquivo comprimido</span></button>
            <button class="btn txt" data-act="analisar-comp" disabled>Analisar este arquivo</button>
          </div>
        </div>
      </div>

      <div class="foot"><span>Analisador de Templates DOCX · v${VERSAO}</span><span>Desenvolvido por Maria Julia Talamini</span></div>
    </section>
  </div>
</div>

<button class="fab" data-act="abrir">${svg('doc', 20)}Analisador de templates</button>
<div class="toast" role="status" hidden></div>
`;

  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const ov = $('.ov'), fab = $('.fab');
  const arquivos = { analisar: null, compressor: null };
  let comprimido = null;
  let ultimoDocId = null;
  let resultadoAtual = null;
  openVarCategories.add('cliente');

  let toastTimer;
  function toast(t) {
    const el = $('.toast');
    el.textContent = t; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  async function copiarTexto(texto) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
  }

  // Encaixa a tela abaixo da barra superior e ao lado do menu do sistema.
  function posicionar() {
    let top = 0, left = 0;
    try {
      let el = document.elementFromPoint(innerWidth / 2, 8);
      while (el && el !== document.body && el !== document.documentElement) {
        const r = el.getBoundingClientRect();
        if (r.width >= innerWidth * 0.9 && r.height >= 40 && r.height <= 140) { top = r.bottom; break; }
        el = el.parentElement;
      }
      el = document.elementFromPoint(40, Math.min(innerHeight - 10, top + 220));
      while (el && el !== document.body && el !== document.documentElement) {
        const r = el.getBoundingClientRect();
        if (r.width >= 150 && r.width <= 420 && r.height >= innerHeight * 0.5 && r.left <= 1) { left = r.right; break; }
        el = el.parentElement;
      }
    } catch (e) { /* usa tela cheia */ }
    ov.style.top = top + 'px';
    ov.style.left = left + 'px';
  }

  function abrir() { posicionar(); ov.hidden = false; fab.hidden = true; }
  function fechar() { ov.hidden = true; fab.hidden = false; }

  function mudarAba(id) {
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== id; });
    if (id === 'variaveis') renderVariaveis();
    if (id === 'personalizacao') renderPersonalizacao();
  }

  // ---------- Variáveis (mesmas regras do popup.js da extensão) ----------
  const HIDDEN_VAR_NAMES = new Set([
    'modalidade.DiasLiberadosParaAcesso',
    'modalidade.TipoLimiteAcessosPorPeriodo',
    'modalidade.QtdeLimiteAcessosPorPeriodo',
    'TemResponsavel'
  ]);
  const CATEGORIAS = VAR_CATEGORIES.filter(c => c.key !== 'estruturas')
    .concat([{ key: 'outros', label: 'Outras variáveis' }]);

  function renderVariaveis() {
    const schema = schemaAtual();
    const q = ($('#bv').value || '').trim().toLowerCase();
    const filtrando = q.length > 0;
    const entries = [];
    const added = new Set();
    const groups = [
      { key: 'variables', label: 'var', title: 'Variável de texto — usar como <<[NomeVariavel]>>' },
      { key: 'imageVariables', label: 'img', title: 'Variável de imagem — usar como <<image [NomeVariavel]>>' }
    ];
    for (const group of groups) {
      for (const name of (schema[group.key] || [])) {
        if (HIDDEN_VAR_NAMES.has(name)) continue;
        const key = `${name}:${group.label}`;
        if (added.has(key)) continue;
        added.add(key);
        const pretty = prettifyName(name, categorizeVariable(name));
        if (!q || name.toLowerCase().includes(q) || pretty.toLowerCase().includes(q)) {
          entries.push({ name, label: group.label, title: group.title, category: categorizeVariable(name) });
        }
      }
    }
    const estruturas = STRUCTURES.filter(s => !q || s.name.toLowerCase().includes(q));
    const alvo = $('[data-grupos]');
    if (!entries.length && !estruturas.length) {
      alvo.innerHTML = '<div class="grp"><p class="nada">Nenhuma variável encontrada.</p></div>';
      return;
    }
    const loopTagMap = buildLoopTagMap(schema);
    const conditionMap = buildConditionMap(schema);
    const cabecalho = (key, label, n) => `
      <button class="ghead" data-grupo="${key}" aria-expanded="${filtrando || openVarCategories.has(key)}" ${filtrando ? 'disabled style="cursor:default"' : ''}>
        <span class="gname">${esc(label)}</span><span class="gcount">${n}</span>
        <span class="chev">${svg('chev', 20)}</span>
      </button>`;
    let html = '';
    for (const cat of CATEGORIAS) {
      const lista = entries.filter(e => e.category === cat.key);
      if (!lista.length) continue;
      const ordem = VARIABLE_ORDER_INDEX[cat.key];
      if (ordem) {
        const pos = (e) => ordem.has(`${e.name}:${e.label}`) ? ordem.get(`${e.name}:${e.label}`) : Infinity;
        lista.sort((a, b) => pos(a) - pos(b));
      }
      const aberto = filtrando || openVarCategories.has(cat.key);
      html += `<div class="grp${aberto ? '' : ' fechado'}">${cabecalho(cat.key, cat.label, lista.length)}
        ${cat.key === 'foreach' ? `<div class="gnota">${svg('alerta', 16)}<span>Essas variáveis só funcionam dentro de um bloco &lt;&lt;foreach&gt;&gt; — fora dele, não retornam valor.</span></div>` : ''}
        <div class="grid">${lista.map(entry => {
          const copia = formatVariableForCopy(entry, loopTagMap, conditionMap);
          const exemplo = VARIABLE_EXAMPLES[entry.name];
          return `<button class="var" data-copy="${esc(copia)}" title="${esc(entry.title)}">
            <span class="vtag${entry.label === 'img' ? ' img' : ''}">${entry.label}</span>
            <span class="vnome">${esc(prettifyName(entry.name, entry.category))}</span>
            <code class="vcod">${esc(copia)}</code>
            ${exemplo ? `<span class="tip">Exemplo: ${esc(exemplo)}</span>` : ''}
          </button>`;
        }).join('')}</div></div>`;
    }
    if (estruturas.length) {
      const cat = VAR_CATEGORIES.find(c => c.key === 'estruturas');
      const aberto = filtrando || openVarCategories.has(cat.key);
      html += `<div class="grp${aberto ? '' : ' fechado'}">${cabecalho(cat.key, cat.label, estruturas.length)}
        <div class="grid uma">${estruturas.map(s => `
          <button class="var" data-copy="${esc(s.text)}" title="Estrutura pronta — bloco de tags para colar no template" style="min-height:72px">
            <span class="vtag est">estrutura</span>
            <span class="vnome">${esc(s.name)}</span>
          </button>`).join('')}</div></div>`;
    }
    alvo.innerHTML = html;
  }

  async function copiarCard(btn) {
    const texto = btn.dataset.copy;
    await copiarTexto(texto);
    const alvoTxt = btn.querySelector('.vcod') || btn.querySelector('.vnome');
    const antes = alvoTxt.textContent;
    btn.classList.add('copiado');
    if (!btn.querySelector('.vcod')) alvoTxt.classList.add('ok');
    alvoTxt.textContent = 'Copiado!';
    setTimeout(() => {
      btn.classList.remove('copiado');
      alvoTxt.classList.remove('ok');
      alvoTxt.textContent = antes;
    }, 1600);
  }

  // ---------- Arquivos ----------
  const formatar = (b) => formatMB(b);
  function definirArquivo(tipo, file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { toast('Envie um arquivo .docx. Arquivos .doc antigos precisam ser salvos como .docx no Word.'); return; }
    arquivos[tipo] = file;
    const nome = $(`[data-drop="${tipo}"] .fname`);
    nome.textContent = `${file.name} · ${formatar(file.size)}`;
    nome.hidden = false;
    if (tipo === 'analisar') $('[data-act="analisar"]').disabled = false;
    if (tipo === 'compressor') {
      $('[data-act="comprimir"]').disabled = false;
      $('[data-k="orig"]').textContent = formatar(file.size);
      limparCompressao();
    }
  }

  function receberArquivos(tipo, files) {
    if (tipo === 'referencia') return adicionarReferencias([...files]);
    definirArquivo(tipo, files[0]);
  }

  $$('[data-file]').forEach(inp => inp.addEventListener('change', () => { receberArquivos(inp.dataset.file, inp.files); inp.value = ''; }));
  $$('[data-drop]').forEach(d => {
    d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', () => d.classList.remove('over'));
    d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); receberArquivos(d.dataset.drop, e.dataTransfer.files); });
  });

  // ---------- Análise (linter da extensão) ----------
  function mostrarCarregando(titulo) {
    $('[data-res]').innerHTML = `<div style="padding:24px;display:flex;flex-direction:column;gap:10px"><h2>${esc(titulo)}</h2><div class="indet"></div></div>`;
  }
  function mostrarErro(titulo, msg) {
    $('[data-res]').innerHTML = `<div style="padding:24px;display:flex;flex-direction:column;gap:8px"><h2>${esc(titulo)}</h2><p class="msg err">${esc(msg)}</p></div>`;
  }

  async function lintar(buf, origem) {
    const problemas = await TemplateLinter.lintDocxBuffer(buf, schemaAtual());
    resultadoAtual = { problemas, ...origem };
    renderResultado();
    const h = store.get('historico', []);
    h.unshift({ arquivo: origem.nome, quando: new Date().toISOString(), problemas: problemas.length });
    store.set('historico', h.slice(0, 15));
    if (!$('.hist').hidden) renderHistorico();
  }

  function renderResultado() {
    const { problemas, nome, docId } = resultadoAtual;
    const n = problemas.length;
    $('[data-res]').innerHTML = `
      <div class="rhead">
        <div style="display:flex;flex-direction:column;gap:2px">
          <h2>Resultado da análise</h2>
          <span class="muted">${esc(nome)} · analisado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="chips">
          ${n ? `<span class="chip c-er">${n} problema${n === 1 ? '' : 's'} encontrado${n === 1 ? '' : 's'}</span>` : '<span class="chip c-ok">Nenhum problema</span>'}
        </div>
      </div>
      ${n ? problemas.map((p, i) => `
        <div class="issue">
          <span class="tipo">ERRO</span>
          <div class="idet">
            <span class="m">${esc(p.message)}</span>
            <span class="trecho">"…${esc(p.snippet)}…"</span>
            <span class="onde">${esc(p.part ? `${p.part} · linha ~${p.line}` : `Linha ~${p.line}`)}</span>
          </div>
          ${p.searchText ? `<div class="iacts">
            ${docId ? `<button class="btn txt" data-ir="${i}">${svg('ir', 16)}Ir para o trecho</button>` : `<button class="btn txt" data-buscar="${i}">${svg('copy', 16)}Copiar trecho</button>`}
          </div>` : ''}
        </div>`).join('') : `<div class="tudo-ok">${svg('check', 20)}Nenhum problema encontrado. O template está pronto para ser usado no sistema.</div>`}
    `;
  }

  async function irParaTrecho(i, abrirDoc) {
    const p = resultadoAtual.problemas[i];
    await copiarTexto(p.searchText);
    if (abrirDoc && resultadoAtual.docId) {
      window.open(`https://docs.google.com/document/d/${resultadoAtual.docId}/edit`, 'nf-gdoc-' + resultadoAtual.docId);
      toast(`Trecho copiado. No Google Docs, aperte Ctrl+F e cole${p.occurrence ? ` — é a ${p.occurrence + 1}ª ocorrência` : ''}.`);
    } else {
      toast(`Trecho copiado. No Word, aperte Ctrl+F e cole${p.occurrence ? ` — é a ${p.occurrence + 1}ª ocorrência` : ''}.`);
    }
  }

  async function analisarArquivo() {
    const file = arquivos.analisar;
    if (!file) return;
    const btn = $('[data-act="analisar"]');
    btn.disabled = true;
    mostrarCarregando('Analisando…');
    try {
      await lintar(await file.arrayBuffer(), { nome: file.name, docId: null });
    } catch (err) {
      console.error(err);
      mostrarErro('Não foi possível analisar', 'Erro ao analisar: ' + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  }

  // Mesma busca do popup.js. Fora da extensão o Google pode bloquear a leitura direta
  // (CORS); nesse caso o .docx é baixado em outra aba para ser enviado como arquivo.
  async function buscarGoogleDocx(docId) {
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=docx`;
    let res;
    try {
      res = await fetch(exportUrl, { credentials: 'omit' });
    } catch (err) {
      const e = new Error('bloqueado');
      e.bloqueado = true;
      throw e;
    }
    if (!res.ok) throw new Error('Documento não encontrado ou sem permissão de acesso.');
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('wordprocessingml') && !contentType.includes('officedocument')) {
      throw new Error('Não foi possível ler o documento. Verifique se o compartilhamento está definido como "Qualquer pessoa com o link" (leitor).');
    }
    return await res.arrayBuffer();
  }

  async function analisarLink(docIdForcado) {
    const docId = docIdForcado || extractGoogleDocId($('#gd').value);
    const msg = $('[data-msg="gdocs"]');
    if (!docId) {
      msg.hidden = false; msg.className = 'msg err';
      msg.textContent = 'Link inválido. Cole o link completo do Google Docs.';
      return;
    }
    const btn = $('[data-act="gdocs"]'), att = $('[data-act="atualizar"]');
    btn.disabled = true; att.disabled = true;
    if (docIdForcado) att.classList.add('girando');
    msg.hidden = true;
    mostrarCarregando(docIdForcado ? 'Atualizando…' : 'Buscando documento…');
    try {
      const buf = await buscarGoogleDocx(docId);
      await lintar(buf, { nome: 'Documento do Google Docs', docId });
      ultimoDocId = docId;
      att.hidden = false;
    } catch (err) {
      if (err.bloqueado) {
        window.open(`https://docs.google.com/document/d/${docId}/export?format=docx`, '_blank', 'noopener');
        msg.hidden = false; msg.className = 'msg';
        msg.textContent = 'Nesta página o navegador não deixa ler o Google Docs diretamente, então o .docx foi baixado em outra aba. Arraste o arquivo baixado para o campo ao lado e clique em Analisar arquivo. Se o download não começar, confira se o documento está compartilhado como "Qualquer pessoa com o link".';
        $('[data-res]').innerHTML = '<div style="padding:24px;display:flex;flex-direction:column;gap:8px"><h2>Resultado da análise</h2><span class="muted" style="font-size:15px">Aguardando o arquivo baixado do Google Docs.</span></div>';
      } else {
        console.error(err);
        mostrarErro('Não foi possível analisar', 'Erro: ' + (err.message || err));
      }
    } finally {
      btn.disabled = !extractGoogleDocId($('#gd').value);
      att.disabled = false; att.classList.remove('girando');
    }
  }

  // ---------- Compressor (compressor.js da extensão) ----------
  function limparCompressao() {
    comprimido = null;
    $('[data-k="final"]').textContent = '—';
    $('[data-k="red"]').textContent = '—';
    $('[data-k="red"]').className = '';
    $('[data-rcard]').hidden = true;
    $('[data-act="baixar"]').disabled = true;
    $('[data-act="analisar-comp"]').disabled = true;
  }

  function progresso(texto, fracao) {
    $('.prog').hidden = texto == null;
    $('[data-ptxt]').textContent = texto || '';
    $('.barra').style.width = `${Math.round(Math.max(0, Math.min(1, fracao || 0)) * 100)}%`;
  }

  function renderCompressao(result, fileName) {
    const card = $('[data-rcard]'), det = $('[data-rdet]');
    const reached = result.status === 'ok';
    card.hidden = false;
    card.className = 'rcard ' + (reached || result.status === 'already-small' ? 'ok' : 'err');
    det.innerHTML = '';
    const add = (t) => { const li = document.createElement('li'); li.textContent = t; det.appendChild(li); };

    if (result.status === 'already-small') {
      $('[data-rtitulo]').textContent = `Este arquivo já tem ${formatMB(result.originalSize)}, dentro do limite de 2 MB. Não precisa comprimir.`;
      $('[data-k="final"]').textContent = formatMB(result.originalSize);
      $('[data-k="red"]').textContent = '—';
      return;
    }

    $('[data-rtitulo]').textContent = reached
      ? 'Pronto! O arquivo agora está dentro do limite de 2 MB.'
      : 'Não foi possível chegar a 2 MB sem alterar o conteúdo do documento.';

    const saved = 1 - result.finalSize / result.originalSize;
    $('[data-k="final"]').textContent = formatMB(result.finalSize);
    $('[data-k="red"]').textContent = `−${Math.max(0, Math.round(saved * 100))}%`;
    $('[data-k="red"]').className = 'red';

    const s = result.stats;
    if (s.imagesCompressed) {
      let line = `${plural(s.imagesCompressed, 'imagem comprimida', 'imagens comprimidas')}`;
      if (s.imagesConverted) line += ` (${plural(s.imagesConverted, 'print convertido', 'prints convertidos')} de PNG para JPEG)`;
      add(line);
    }
    if (s.fontsRemoved) add(`${plural(s.fontsRemoved, 'fonte incorporada removida', 'fontes incorporadas removidas')}`);
    if (s.unusedMediaRemoved) add(`${plural(s.unusedMediaRemoved, 'imagem não usada removida', 'imagens não usadas removidas')}`);
    if (s.thumbnailRemoved) add('Miniatura de pré-visualização removida');

    if (!reached && result.breakdown) {
      const b = result.breakdown;
      const others = Math.max(0, result.finalSize - b.imagens - b.fontes - b.objetos);
      const heavy = [
        ['fontes incorporadas', b.fontes],
        ['imagens', b.imagens],
        ['objetos incorporados', b.objetos],
        ['texto e formatação', others]
      ].filter(([, size]) => size >= 10 * 1024).sort((x, y) => y[1] - x[1]);
      add(`O que ainda pesa: ${heavy.map(([name, size]) => `${name} ${formatMB(size)}`).join(', ')}.`);
      if (b.imagensNaoComprimiveis > 0) add(`${formatMB(b.imagensNaoComprimiveis)} são imagens em formatos que o navegador não consegue comprimir (EMF, WMF, TIFF ou GIF). Salvar essas imagens como PNG ou JPEG no Word resolve.`);
      if (b.fontesPresentes && !s.fontsRemoved) add('O documento tem fontes incorporadas. Marque "Remover fontes incorporadas" e comprima de novo.');
      if (b.objetos > 0) add('Há objetos incorporados (planilhas, PDFs etc.). Remova-os no Word se não forem necessários.');
    }
    det.hidden = !det.children.length;

    // Sem ganho real (menos de 1%), não oferece um arquivo praticamente igual ao original.
    if (result.blob && (reached || result.finalSize < result.originalSize * 0.99)) {
      comprimido = new File([result.blob], fileName.replace(/\.docx$/i, '') + '-comprimido.docx', { type: result.blob.type });
      $('[data-blabel]').textContent = reached ? 'Baixar arquivo comprimido' : `Baixar mesmo assim (${formatMB(result.finalSize)})`;
      $('[data-act="baixar"]').disabled = false;
      $('[data-act="analisar-comp"]').disabled = false;
    }
  }

  async function rodarCompressao() {
    const file = arquivos.compressor;
    if (!file) return;
    const btn = $('[data-act="comprimir"]');
    btn.disabled = true;
    limparCompressao();
    progresso('Lendo o arquivo...', 0.01);
    try {
      const buf = await file.arrayBuffer();
      const result = await DocxCompressor.compress(buf, {
        allowFontRemoval: $('#rf').checked,
        onProgress: ({ text, fraction }) => progresso(text, fraction)
      });
      progresso(null);
      renderCompressao(result, file.name);
    } catch (err) {
      console.error(err);
      progresso(null);
      const card = $('[data-rcard]');
      card.hidden = false; card.className = 'rcard err';
      $('[data-rtitulo]').textContent = 'Erro ao comprimir: ' + (err.message || err);
      $('[data-rdet]').innerHTML = '';
    } finally {
      btn.disabled = false;
    }
  }

  function baixar() {
    if (!comprimido) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(comprimido);
    a.download = comprimido.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- Personalização ----------
  function renderPersonalizacao() {
    const s = schemaAtual();
    const temRef = !!cfg.referencia;
    $('[data-k="modelo"]').textContent = temRef ? 'Padrão + modelos enviados' : (extrasLista().length ? 'Padrão + extras' : 'Padrão');
    $('[data-k="nvars"]').textContent = `${s.variables.length} (padrão: ${DEFAULT_SCHEMA.variables.length})`;
    $('[data-k="nlogica"]').textContent = `${s.rawConditions.length} condições · ${s.rawLoops.length} laços`;
    $('[data-refs]').innerHTML = (cfg.referenciaArquivos || []).map(n => `<span class="chip c-ok">${esc(n)}</span>`).join('');
    $('[data-act="restaurar"]').disabled = !temRef;
    $('#ex').value = cfg.extras || '';
  }

  async function adicionarReferencias(files) {
    const docs = files.filter(f => /\.docx$/i.test(f.name));
    const msg = $('[data-msg="ref"]');
    if (!docs.length) { toast('Envie arquivos .docx.'); return; }
    msg.hidden = false; msg.className = 'msg'; msg.textContent = 'Lendo os modelos…';
    try {
      const bufs = [];
      for (const f of docs) bufs.push(await f.arrayBuffer());
      const novo = await TemplateLinter.buildMergedSchema(bufs);
      const merged = {};
      for (const k of new Set([...Object.keys(cfg.referencia || {}), ...Object.keys(novo)])) {
        merged[k] = [...new Set([...((cfg.referencia || {})[k] || []), ...(novo[k] || [])])].sort();
      }
      const antes = schemaAtual().variables.length;
      cfg.referencia = merged;
      cfg.referenciaArquivos = [...new Set([...(cfg.referenciaArquivos || []), ...docs.map(f => f.name)])];
      store.set('config', cfg);
      const depois = schemaAtual().variables.length;
      msg.textContent = depois > antes
        ? `${plural(depois - antes, 'variável nova passou', 'variáveis novas passaram')} a ser aceita${depois - antes === 1 ? '' : 's'}.`
        : 'Modelos adicionados. Nenhuma variável nova em relação ao modelo atual.';
      renderPersonalizacao();
    } catch (err) {
      console.error(err);
      msg.className = 'msg err';
      msg.textContent = 'Não foi possível ler o modelo: ' + (err.message || err);
    }
  }

  function restaurarPadrao() {
    cfg.referencia = null;
    cfg.referenciaArquivos = [];
    store.set('config', cfg);
    const msg = $('[data-msg="ref"]');
    msg.hidden = false; msg.className = 'msg';
    msg.textContent = 'Modelo de referência restaurado para o padrão.';
    renderPersonalizacao();
  }

  function salvarExtras() {
    cfg.extras = $('#ex').value;
    store.set('config', cfg);
    renderPersonalizacao();
    toast('Variáveis extras salvas');
  }

  // ---------- Histórico ----------
  function renderHistorico() {
    const h = store.get('historico', []);
    $('.hist').innerHTML = '<h2 style="padding:12px 0 4px">Últimas análises neste navegador</h2>' + (h.length
      ? h.map(i => `<div class="hrow"><span class="hn">${esc(i.arquivo)}</span><span class="muted">${new Date(i.quando).toLocaleString('pt-BR')}</span>${i.problemas ? `<span class="chip c-er">${plural(i.problemas, 'problema', 'problemas')}</span>` : '<span class="chip c-ok">Sem problemas</span>'}</div>`).join('')
      : '<p class="muted" style="margin:8px 0">Nenhuma análise feita ainda.</p>');
  }

  // ---------- Eventos ----------
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-tab],[data-copy],[data-grupo],[data-ir],[data-buscar]');
    if (!t || t.disabled) return;
    if (t.dataset.tab) return mudarAba(t.dataset.tab);
    if (t.dataset.copy !== undefined) return copiarCard(t);
    if (t.dataset.ir !== undefined) return irParaTrecho(+t.dataset.ir, true);
    if (t.dataset.buscar !== undefined) return irParaTrecho(+t.dataset.buscar, false);
    if (t.dataset.grupo) {
      const g = t.dataset.grupo;
      openVarCategories.has(g) ? openVarCategories.delete(g) : openVarCategories.add(g);
      return renderVariaveis();
    }
    switch (t.dataset.act) {
      case 'abrir': return abrir();
      case 'fechar': return fechar();
      case 'gdocs': return analisarLink();
      case 'atualizar': return ultimoDocId && analisarLink(ultimoDocId);
      case 'analisar': return analisarArquivo();
      case 'comprimir': return rodarCompressao();
      case 'baixar': return baixar();
      case 'salvar': return salvarExtras();
      case 'restaurar': return restaurarPadrao();
      case 'hist': {
        const box = $('.hist');
        box.hidden = !box.hidden;
        t.setAttribute('aria-expanded', String(!box.hidden));
        if (!box.hidden) renderHistorico();
        return;
      }
      case 'analisar-comp': {
        if (!comprimido) return;
        definirArquivo('analisar', comprimido);
        mudarAba('analisar');
        return analisarArquivo();
      }
    }
  });
  $('#gd').addEventListener('input', () => { $('[data-act="gdocs"]').disabled = !extractGoogleDocId($('#gd').value); });
  $('#gd').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('[data-act="gdocs"]').disabled) analisarLink(); });
  $('#bv').addEventListener('input', renderVariaveis);
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

  // Expõe as funções para testes no próprio Console: window.NFAnalisador.lint(arrayBuffer)
  window.NFAnalisador = {
    versao: VERSAO,
    schema: schemaAtual,
    lint: (buf) => TemplateLinter.lintDocxBuffer(buf, schemaAtual()),
    compress: (buf, opts) => DocxCompressor.compress(buf, opts || {}),
    abrir, fechar
  };

  abrir();
  console.info('%cAnalisador de Templates v' + VERSAO + ' carregado. Use o botão roxo no canto da tela para reabrir.', 'color:#7B1FA2;font-weight:bold');
