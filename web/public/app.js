// Página web do Analisador de Templates.
// A lógica de análise e compressão é a da extensão (linter.browser.js e compressor.js,
// copiados para compartilhado/). Este arquivo cuida só da tela e do que muda fora do
// Chrome: leitura do Google Docs pela função /api/google-doc e o "Ir para o trecho".
(function () {
  'use strict';

  const API_GOOGLE_DOC = '/api/google-doc';
  let DEFAULT_SCHEMA = null;

  // ---------- Ícones ----------
  const ICO = {
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    comp: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
    chev: '<path d="M6 15l6-6 6 6"/>',
    lupa: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    ir: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };
  const svg = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n]}</svg>`;
  document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = svg(el.dataset.ico, +(el.dataset.tam || 22)); });

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Sem a pasta compartilhado/ (gerada por scripts/sync.mjs) a análise não funciona, mas a
  // página continua navegável e mostra o aviso em vez de travar as abas.
  const FALTAM_ARQUIVOS = typeof VAR_CATEGORIES === 'undefined' || typeof TemplateLinter === 'undefined';
  $('[data-versao]').textContent = typeof VERSAO_EXTENSAO !== 'undefined' ? VERSAO_EXTENSAO : '—';
  if (FALTAM_ARQUIVOS) {
    console.error('Arquivos de compartilhado/ não carregados. Rode "node scripts/sync.mjs" na pasta web/.');
    const aviso = '<div style="padding:24px;display:flex;flex-direction:column;gap:8px"><h2>Analisador indisponível</h2><p class="msg err">Os arquivos da extensão não foram carregados. Recarregue a página; se o problema continuar, avise o suporte.</p></div>';
    $('[data-res]').innerHTML = aviso;
    $('[data-grupos]').innerHTML = aviso;
    const abrir = (id) => {
      if (!document.querySelector(`[data-panel="${id}"]`)) id = 'analisar';
      document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
      document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== id; });
    };
    document.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) abrir(t.dataset.tab); });
    abrir(new URLSearchParams(location.search).get('aba') || 'analisar');
    return;
  }

  // ---------- Preferências (ficam só neste navegador) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('nfAnalisador.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('nfAnalisador.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
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

  // ---------- Utilidades de tela ----------
  let toastTimer;
  function toast(t) {
    const el = $('.toast');
    el.textContent = t; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
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

  function mudarAba(id, atualizarUrl = true) {
    if (!$(`[data-panel="${id}"]`)) id = 'analisar';
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== id; });
    if (id === 'variaveis') renderVariaveis();
    if (id === 'personalizacao') renderPersonalizacao();
    if (atualizarUrl) {
      const u = new URL(location.href);
      if (id === 'analisar') u.searchParams.delete('aba'); else u.searchParams.set('aba', id);
      history.replaceState(null, '', u);
    }
  }

  // ---------- Variáveis (mesmas regras do popup.js da extensão) ----------
  const HIDDEN_VAR_NAMES = new Set([
    'modalidade.DiasLiberadosParaAcesso',
    'modalidade.TipoLimiteAcessosPorPeriodo',
    'modalidade.QtdeLimiteAcessosPorPeriodo',
    'TemResponsavel'
  ]);
  const CATEGORIAS = VAR_CATEGORIES.filter(c => c.key !== 'estruturas').concat([{ key: 'outros', label: 'Outras variáveis' }]);
  openVarCategories.add('cliente');

  function renderVariaveis() {
    if (!DEFAULT_SCHEMA) return;
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
      <button class="ghead" data-grupo="${key}" aria-expanded="${filtrando || openVarCategories.has(key)}" ${filtrando ? 'disabled' : ''}>
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
    await copiarTexto(btn.dataset.copy);
    const cod = btn.querySelector('.vcod');
    const alvoTxt = cod || btn.querySelector('.vnome');
    const antes = alvoTxt.textContent;
    btn.classList.add('copiado');
    if (!cod) alvoTxt.classList.add('ok');
    alvoTxt.textContent = 'Copiado!';
    setTimeout(() => {
      btn.classList.remove('copiado');
      alvoTxt.classList.remove('ok');
      alvoTxt.textContent = antes;
    }, 1600);
  }

  // ---------- Arquivos ----------
  const arquivos = { analisar: null, compressor: null };
  let comprimido = null;

  function definirArquivo(tipo, file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { toast('Envie um arquivo .docx. Arquivos .doc antigos precisam ser salvos como .docx no Word.'); return; }
    arquivos[tipo] = file;
    const nome = $(`[data-drop="${tipo}"] .fname`);
    nome.textContent = `${file.name} · ${formatMB(file.size)}`;
    nome.hidden = false;
    if (tipo === 'analisar') $('[data-act="analisar"]').disabled = false;
    if (tipo === 'compressor') {
      $('[data-act="comprimir"]').disabled = false;
      $('[data-k="orig"]').textContent = formatMB(file.size);
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
  let resultadoAtual = null;
  let ultimoDocId = null;

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
          ${p.searchText ? (docId
            ? `<button class="btn txt" data-ir="${i}">${svg('ir', 16)}Ir para o trecho</button>`
            : `<button class="btn txt" data-buscar="${i}">${svg('copy', 16)}Copiar trecho</button>`) : ''}
        </div>`).join('') : `<div class="tudo-ok">${svg('check', 20)}Nenhum problema encontrado. O template está pronto para ser usado no sistema.</div>`}
    `;
  }

  // Fora da extensão não dá para comandar a aba do Google Docs; então o trecho vai para a
  // área de transferência e o documento abre numa aba reaproveitada.
  async function irParaTrecho(i, abrirDoc) {
    const p = resultadoAtual.problemas[i];
    await copiarTexto(p.searchText);
    const vez = p.occurrence ? ` — é a ${p.occurrence + 1}ª ocorrência` : '';
    if (abrirDoc && resultadoAtual.docId) {
      window.open(`https://docs.google.com/document/d/${resultadoAtual.docId}/edit`, 'nf-gdoc-' + resultadoAtual.docId);
      toast(`Trecho copiado. No Google Docs, aperte Ctrl+F e cole${vez}.`);
    } else {
      toast(`Trecho copiado. No Word, aperte Ctrl+F e cole${vez}.`);
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

  // Pede o .docx à função do Firebase (/api/google-doc). Se a função não estiver publicada
  // (ex.: plano gratuito), cai no plano B: baixa o .docx para a pessoa enviar como arquivo.
  async function buscarGoogleDocx(docId) {
    let res;
    try {
      res = await fetch(`${API_GOOGLE_DOC}?id=${encodeURIComponent(docId)}`, { cache: 'no-store' });
    } catch (err) {
      throw Object.assign(new Error('sem-funcao'), { semFuncao: true });
    }
    const tipo = res.headers.get('content-type') || '';
    if (res.ok && (tipo.includes('wordprocessingml') || tipo.includes('officedocument'))) return await res.arrayBuffer();
    if (tipo.includes('application/json')) {
      const corpo = await res.json().catch(() => ({}));
      throw new Error(corpo.erro || 'Não foi possível ler o documento.');
    }
    throw Object.assign(new Error('sem-funcao'), { semFuncao: true });
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
      if (err.semFuncao) {
        window.open(`https://docs.google.com/document/d/${docId}/export?format=docx`, '_blank', 'noopener');
        msg.hidden = false; msg.className = 'msg';
        msg.textContent = 'Não deu para ler o Google Docs direto daqui, então o .docx foi baixado em outra aba. Arraste o arquivo baixado para o campo ao lado e clique em Analisar arquivo.';
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
      det.hidden = true;
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
      const result = await DocxCompressor.compress(await file.arrayBuffer(), {
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
    if (!DEFAULT_SCHEMA) return;
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
      const novas = schemaAtual().variables.length - antes;
      msg.textContent = novas > 0
        ? `${plural(novas, 'variável nova passou', 'variáveis novas passaram')} a ser aceita${novas === 1 ? '' : 's'}.`
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
  document.addEventListener('click', (e) => {
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

  // ---------- Início ----------
  // Parâmetros aceitos na URL (o botão do sistema pode usá-los):
  //   ?aba=variaveis|personalizacao|compressor   abre direto numa aba
  //   ?doc=<link do Google Docs>                  já preenche e analisa o link
  (async function iniciar() {
    const params = new URLSearchParams(location.search);
    mudarAba(params.get('aba') || 'analisar', false);
    try {
      const res = await fetch('compartilhado/reference-schema.json', { cache: 'no-cache' });
      DEFAULT_SCHEMA = await res.json();
    } catch (err) {
      console.error(err);
      mostrarErro('Erro ao carregar', 'Não foi possível carregar o modelo de referência. Recarregue a página.');
      return;
    }
    renderVariaveis();
    renderPersonalizacao();
    const doc = params.get('doc');
    if (doc && extractGoogleDocId(doc)) {
      $('#gd').value = doc;
      $('[data-act="gdocs"]').disabled = false;
      mudarAba('analisar');
      analisarLink();
    }
  })();
})();
