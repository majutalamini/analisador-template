/*
 * Botão "Correção" na tela de Templates do Next Fit — protótipo para testar pelo F12
 * ---------------------------------------------------------------------------------
 * Coloca um botão "CORREÇÃO" ao lado do "+ TEMPLATE". Ao clicar, abre o Analisador de
 * Templates (hospedado no Firebase) numa nova aba.
 *
 * Como usar:
 *   1. Troque o endereço em URL_ANALISADOR pelo link do seu site no Firebase.
 *   2. Abra o Next Fit na tela de Templates, aperte F12 > aba "Console".
 *   3. Cole este código e aperte Enter. (Se o Chrome pedir, digite "allow pasting" antes.)
 *
 * O botão é uma cópia visual do "+ TEMPLATE", então herda as cores e o tamanho do sistema.
 * Ele continua aparecendo se você sair e voltar para a tela de Templates; só some ao
 * recarregar a página. Não altera nada no sistema.
 */
(() => {
  'use strict';

  const URL_ANALISADOR = 'https://SEU-PROJETO.web.app/';
  const ROTULO = 'Correção';
  const MARCA = 'data-nf-correcao';

  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:100%;height:100%;display:block"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="m15 5 3 3"/></svg>';

  // Remove a versão anterior, se o código for colado de novo.
  if (window.__nfCorrecao) window.__nfCorrecao.parar();
  document.querySelectorAll(`[${MARCA}]`).forEach(el => el.remove());

  const texto = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  // O botão "+ TEMPLATE": termina com "template" e não é o nosso.
  function acharBotaoTemplate() {
    const candidatos = document.querySelectorAll('button, a, [role="button"]');
    for (const el of candidatos) {
      if (el.hasAttribute(MARCA) || el.closest(`[${MARCA}]`)) continue;
      if (!el.getClientRects().length) continue;
      const t = texto(el);
      if (t.length <= 30 && /(^|\s|\+)template$/i.test(t)) return el;
    }
    return null;
  }

  function trocarTexto(botao) {
    const walker = document.createTreeWalker(botao, NodeFilter.SHOW_TEXT);
    let trocou = false, no;
    while ((no = walker.nextNode())) {
      if (!trocou && /template/i.test(no.nodeValue)) {
        const original = no.nodeValue.trim();
        const rotulo = original === original.toUpperCase() ? ROTULO.toUpperCase() : ROTULO;
        no.nodeValue = no.nodeValue.replace(/\+?\s*template/i, rotulo);
        trocou = true;
      } else if (/^\s*\+\s*$/.test(no.nodeValue)) {
        no.nodeValue = '';
      }
    }
    if (!trocou) botao.append(' ' + ROTULO);
  }

  // Troca o ícone "+" (svg, mat-icon, <i> ou ligadura "add") pelo lápis, no mesmo tamanho.
  // O tamanho e o espaçamento são medidos no botão original, que já está na tela.
  const SELETOR_ICONE = 'mat-icon, .mat-icon, .material-icons, .material-symbols-outlined, svg, i, img';
  function trocarIcone(botao, original) {
    const icone = botao.querySelector(SELETOR_ICONE);
    const iconeOriginal = original.querySelector(SELETOR_ICONE);
    const novo = document.createElement('span');
    novo.innerHTML = ICONE;
    let tam = 20, margem = '8px';
    if (iconeOriginal) {
      const r = iconeOriginal.getBoundingClientRect();
      tam = Math.round(Math.max(16, Math.min(24, (r.width || 24) * 0.85)));
      const est = getComputedStyle(iconeOriginal);
      margem = parseFloat(est.marginRight) ? est.marginRight : (r.width ? `${Math.max(6, Math.round(r.width / 3))}px` : '8px');
      const sobra = Math.max(0, Math.round((r.width - tam) / 2));
      novo.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:${tam}px;height:${tam}px;flex:0 0 auto;vertical-align:middle;margin:0 calc(${margem} + ${sobra}px) 0 ${sobra}px`;
    } else {
      novo.style.cssText = `display:inline-flex;width:${tam}px;height:${tam}px;flex:0 0 auto;vertical-align:middle;margin-right:${margem}`;
    }
    if (icone) icone.replaceWith(novo); else botao.prepend(novo);
  }

  function criarBotao(original) {
    const botao = original.cloneNode(true);
    botao.setAttribute(MARCA, '');
    botao.removeAttribute('id');
    botao.removeAttribute('routerlink');
    botao.removeAttribute('ng-reflect-router-link');
    botao.removeAttribute('disabled');
    botao.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    if (botao.tagName === 'A') {
      botao.setAttribute('href', URL_ANALISADOR);
      botao.setAttribute('target', '_blank');
      botao.setAttribute('rel', 'noopener');
    } else if (botao.tagName === 'BUTTON') {
      botao.type = 'button';
    }
    botao.setAttribute('title', 'Corrigir um template no Analisador de Templates');
    trocarIcone(botao, original);
    trocarTexto(botao);

    botao.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(URL_ANALISADOR, '_blank', 'noopener');
    }, true);

    // Espaço entre os botões igual ao da imagem do protótipo.
    const pai = original.parentElement;
    const estiloPai = pai ? getComputedStyle(pai) : null;
    const temGap = estiloPai && estiloPai.display.includes('flex') && parseFloat(estiloPai.columnGap) > 0;
    if (!temGap && !parseFloat(getComputedStyle(original).marginLeft)) botao.style.marginRight = '24px';
    return botao;
  }

  function garantirBotao() {
    if (document.querySelector(`[${MARCA}]`)?.isConnected) return;
    const original = acharBotaoTemplate();
    if (!original) return;
    const botao = criarBotao(original);
    original.before(botao);
    // Alinha a altura com o "+ TEMPLATE" (o ícone novo pode mudar a linha de base do texto).
    const dif = original.getBoundingClientRect().top - botao.getBoundingClientRect().top;
    if (Math.abs(dif) >= 0.5 && Math.abs(dif) < 16) {
      botao.style.position = 'relative';
      botao.style.top = `${dif}px`;
    }
  }

  // O Next Fit troca de tela sem recarregar: observa a página e recoloca o botão quando
  // a tela de Templates aparece de novo.
  let agendado = false;
  const observador = new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; garantirBotao(); });
  });
  observador.observe(document.body, { childList: true, subtree: true });
  garantirBotao();

  window.__nfCorrecao = {
    parar() {
      observador.disconnect();
      document.querySelectorAll(`[${MARCA}]`).forEach(el => el.remove());
      delete window.__nfCorrecao;
    }
  };

  console.info(
    document.querySelector(`[${MARCA}]`)
      ? '%cBotão "Correção" adicionado. Para remover: __nfCorrecao.parar()'
      : '%cBotão "Correção" vai aparecer assim que a tela de Templates for aberta.',
    'color:#7B1FA2;font-weight:bold'
  );
})();
