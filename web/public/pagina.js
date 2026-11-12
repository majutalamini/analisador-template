// Comportamentos da página (independentes da lógica do analisador em app.js).
(function () {
  'use strict';

  // Quem chega com ?aba= ou ?doc= (ex.: pelo botão "Correção" do sistema) vai direto ao analisador.
  const params = new URLSearchParams(location.search);
  if (params.has('aba') || params.has('doc')) {
    const alvo = document.getElementById('ferramenta');
    if (alvo) requestAnimationFrame(() => alvo.scrollIntoView({ block: 'start' }));
  }

  // Destaca no menu a seção que está na tela.
  const links = [...document.querySelectorAll('.menu a[href^="#"]')];
  const secoes = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && secoes.length) {
    const io = new IntersectionObserver((entradas) => {
      entradas.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + e.target.id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secoes.forEach(s => io.observe(s));
  }

  // Sombra no cabeçalho depois que a página rola.
  const topo = document.querySelector('.topo');
  const marcarRolagem = () => topo && topo.classList.toggle('rolou', window.scrollY > 8);
  window.addEventListener('scroll', marcarRolagem, { passive: true });
  marcarRolagem();
})();
