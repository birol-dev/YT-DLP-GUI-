(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Blocks fade up once as they scroll into view.
  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  // Hero demo: plays while on screen, chapter buttons seek and show progress.
  function initDemo() {
    const demo = document.getElementById('demo');
    const video = document.getElementById('demo-video');
    const toggle = document.getElementById('demo-toggle');
    if (!demo || !video) return;

    // The first chapter owns the video from 0s, even if its mark sits a little later.
    const chapters = [...demo.querySelectorAll('.chapter')].map((el, i) => ({
      el,
      bar: el.querySelector('.chapter-bar span'),
      at: i === 0 ? 0 : parseFloat(el.dataset.at) || 0
    }));
    let userPaused = reduceMotion;

    function setPaused(paused) {
      demo.classList.toggle('is-paused', paused);
      if (toggle) toggle.setAttribute('aria-label', paused ? 'Play demo' : 'Pause demo');
    }

    function play() {
      const p = video.play();
      if (p && p.catch) p.catch(() => setPaused(true));
    }

    function update() {
      const t = video.currentTime;
      const total = video.duration || 0;
      chapters.forEach((c, i) => {
        const end = chapters[i + 1] ? chapters[i + 1].at : total;
        const active = t >= c.at && t < end;
        const p = t >= end ? 1 : active ? (t - c.at) / Math.max(0.01, end - c.at) : 0;
        c.el.classList.toggle('is-active', active);
        c.el.setAttribute('aria-current', active ? 'true' : 'false');
        if (c.bar) c.bar.style.setProperty('--p', p.toFixed(3));
      });
    }

    chapters.forEach((c, i) => {
      c.el.setAttribute('aria-label', `Jump to: ${c.el.textContent.trim()}`);
      c.el.addEventListener('click', () => {
        video.currentTime = c.at;
        userPaused = false;
        play();
        update();
      });
    });

    if (toggle) {
      toggle.addEventListener('click', () => {
        if (video.paused) {
          userPaused = false;
          play();
        } else {
          userPaused = true;
          video.pause();
        }
      });
    }

    video.addEventListener('play', () => setPaused(false));
    video.addEventListener('pause', () => setPaused(true));
    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', update);
    // timeupdate fires ~4x a second; smooth the bars while playing.
    (function tick() {
      if (!video.paused) update();
      requestAnimationFrame(tick);
    })();

    setPaused(true);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !userPaused) play();
        else if (!entry.isIntersecting && !video.paused) video.pause();
      }, { threshold: 0.25 }).observe(video);
    } else if (!userPaused) {
      play();
    }
  }

  // Highlight the nav link for the section in view.
  function initNav() {
    const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
    const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    if (!targets.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const link = links[targets.indexOf(entry.target)];
        if (link && entry.isIntersecting) {
          links.forEach((a) => a.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach((t) => io.observe(t));
  }

  initReveal();
  initDemo();
  initNav();
})();
