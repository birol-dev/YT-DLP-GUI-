(function () {
  'use strict';

  const html = document.documentElement;
  const navLinks = document.getElementById('nav-links');
  const navToggle = document.getElementById('nav-toggle');
  const navAnchors = navLinks ? navLinks.querySelectorAll('a') : [];
  const themeDots = document.querySelectorAll('.theme-dot');
  const themeOptions = document.querySelectorAll('.theme-option');
  const faqItems = document.querySelectorAll('.faq-item');
  const sections = document.querySelectorAll('section[id]');

  function setTheme(theme) {
    if (theme === 'default') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', theme);
    }

    document.querySelectorAll('.theme-dot, .theme-option, .mock-theme-btn').forEach((el) => {
      const match = el.dataset.theme === theme || (theme === 'default' && el.dataset.theme === 'default');
      el.classList.toggle('active', match);
    });

    try {
      localStorage.setItem('ytdlp-gui-theme', theme);
    } catch (_) { /* ignore */ }
  }

  function initTheme() {
    let saved = 'default';
    try {
      saved = localStorage.getItem('ytdlp-gui-theme') || 'default';
    } catch (_) { /* ignore */ }
    setTheme(saved);
  }

  function bindThemeControls() {
    const allThemeControls = document.querySelectorAll('.theme-dot, .theme-option, .mock-theme-btn');

    allThemeControls.forEach((el) => {
      el.addEventListener('click', () => setTheme(el.dataset.theme));
    });
  }

  function initSettingsRecentsMock() {
    const tabs = document.querySelectorAll('.sr-mock-tab');
    const panels = document.querySelectorAll('.sr-mock-panel');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.srPanel;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        panels.forEach((p) => {
          p.classList.toggle('active', p.id === `sr-panel-${target}`);
        });
      });
    });

    document.querySelectorAll('.sr-switch').forEach((sw) => {
      sw.addEventListener('click', () => sw.classList.toggle('on'));
    });
  }

  function bindMobileNav() {
    if (!navToggle || !navLinks) return;

    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });

    navAnchors.forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
      });
    });
  }

  function bindFaq() {
    faqItems.forEach((item, index) => {
      const question = item.querySelector('.faq-question');
      const answer = item.querySelector('.faq-answer');
      if (!question) return;

      if (!question.id) {
        question.id = `faq-q-${index + 1}`;
        question.setAttribute('aria-expanded', 'false');
      }
      if (answer && !answer.id) {
        answer.id = `faq-a-${index + 1}`;
        answer.setAttribute('role', 'region');
        question.setAttribute('aria-controls', answer.id);
      }

      question.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');

        faqItems.forEach((other) => {
          other.classList.remove('open');
          const otherQ = other.querySelector('.faq-question');
          if (otherQ) otherQ.setAttribute('aria-expanded', 'false');
        });

        if (!isOpen) {
          item.classList.add('open');
          question.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    reveals.forEach((el) => observer.observe(el));
  }

  function initActiveNav() {
    if (!sections.length || !navAnchors.length) return;

    const sectionMap = [];
    navAnchors.forEach((link) => {
      const id = link.getAttribute('href');
      if (id && id.startsWith('#')) {
        const section = document.querySelector(id);
        if (section) sectionMap.push({ link, section });
      }
    });

    function updateActive() {
      const scrollY = window.scrollY + 120;
      let current = sectionMap[0];

      sectionMap.forEach(({ link, section }) => {
        if (section.offsetTop <= scrollY) {
          current = { link, section };
        }
      });

      navAnchors.forEach((a) => a.classList.remove('active'));
      if (current) current.link.classList.add('active');
    }

    window.addEventListener('scroll', updateActive, { passive: true });
    updateActive();
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  }

  function initClipperDemo() {
    const track = document.getElementById('clipper-demo-track');
    const fill = document.getElementById('clipper-demo-fill');
    const handleStart = document.getElementById('clipper-handle-start');
    const handleEnd = document.getElementById('clipper-handle-end');
    const timeStart = document.getElementById('clipper-time-start');
    const timeEnd = document.getElementById('clipper-time-end');
    const timeTotal = document.getElementById('clipper-time-total');
    const clipDuration = document.getElementById('clipper-clip-duration');

    if (!track || !fill || !handleStart || !handleEnd) return;

    const DURATION = 213; // 3:33 — Never Gonna Give You Up
    const MIN_GAP = 3;

    let startSec = 45;
    let endSec = 90;
    let activeHandle = null;
    let dragMoved = false;

    function updateUI() {
      const startPct = (startSec / DURATION) * 100;
      const endPct = (endSec / DURATION) * 100;

      handleStart.style.left = `${startPct}%`;
      handleEnd.style.left = `${endPct}%`;
      fill.style.left = `${startPct}%`;
      fill.style.width = `${endPct - startPct}%`;

      if (timeStart) timeStart.textContent = formatTime(startSec);
      if (timeEnd) timeEnd.textContent = formatTime(endSec);
      if (timeTotal) timeTotal.textContent = formatTime(DURATION);
      if (clipDuration) clipDuration.textContent = `Clip: ${formatTime(endSec - startSec)}`;
    }

    function secFromClientX(clientX) {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * DURATION;
    }

    function onMove(clientX) {
      dragMoved = true;
      const time = secFromClientX(clientX);

      if (activeHandle === 'start') {
        startSec = Math.max(0, Math.min(time, endSec - MIN_GAP));
      } else if (activeHandle === 'end') {
        endSec = Math.min(DURATION, Math.max(time, startSec + MIN_GAP));
      }

      updateUI();
    }

    function onPointerUp() {
      if (activeHandle) {
        handleStart.classList.remove('dragging');
        handleEnd.classList.remove('dragging');
        activeHandle = null;
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onPointerUp);
      setTimeout(() => { dragMoved = false; }, 50);
    }

    function onMouseMove(e) {
      onMove(e.clientX);
    }

    function onTouchMove(e) {
      if (e.touches.length) onMove(e.touches[0].clientX);
    }

    function startDrag(type, e) {
      e.preventDefault();
      e.stopPropagation();
      dragMoved = false;
      activeHandle = type;
      (type === 'start' ? handleStart : handleEnd).classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
    }

    handleStart.addEventListener('mousedown', (e) => startDrag('start', e));
    handleEnd.addEventListener('mousedown', (e) => startDrag('end', e));
    handleStart.addEventListener('touchstart', (e) => startDrag('start', e), { passive: false });
    handleEnd.addEventListener('touchstart', (e) => startDrag('end', e), { passive: false });

    track.addEventListener('click', (e) => {
      if (dragMoved || e.target === handleStart || e.target === handleEnd) return;
      const time = secFromClientX(e.clientX);
      const distStart = Math.abs(time - startSec);
      const distEnd = Math.abs(time - endSec);
      if (distStart <= distEnd) {
        startSec = Math.max(0, Math.min(time, endSec - MIN_GAP));
      } else {
        endSec = Math.min(DURATION, Math.max(time, startSec + MIN_GAP));
      }
      updateUI();
    });

    updateUI();
  }

  initTheme();
  bindThemeControls();
  bindMobileNav();
  bindFaq();
  initScrollReveal();
  initActiveNav();
  initClipperDemo();
  initSettingsRecentsMock();
})();
