(function () {
  // Create blade overlay element and attach to body
  function createBladeOverlay() {
    if (document.getElementById('bladeOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'bladeOverlay';
    overlay.className = 'blade-overlay hidden';
    overlay.innerHTML = `
      <div class="blade-panel">
        <header class="blade-header">
          <button class="blade-back" aria-label="Back">← Back</button>
          <div class="blade-title" id="bladeTitle">Details</div>
          <button class="blade-close" aria-label="Close">×</button>
        </header>
        <iframe class="blade-iframe" id="bladeIframe" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    overlay.querySelector('.blade-close').addEventListener('click', closeBlade);
    overlay.querySelector('.blade-back').addEventListener('click', closeBlade);
  }

  function openBlade(url, title) {
    createBladeOverlay();
    const overlay = document.getElementById('bladeOverlay');
    const iframe = document.getElementById('bladeIframe');
    const bladeTitle = document.getElementById('bladeTitle');

    bladeTitle.textContent = title || 'Details';
    iframe.src = url;

    overlay.classList.remove('hidden');
    // trigger reflow then add active class for animation
    requestAnimationFrame(() => overlay.classList.add('active'));
  }

  function closeBlade() {
    const overlay = document.getElementById('bladeOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.addEventListener('transitionend', function handler() {
      overlay.classList.add('hidden');
      const iframe = document.getElementById('bladeIframe');
      if (iframe) iframe.src = 'about:blank';
      overlay.removeEventListener('transitionend', handler);
    });
  }

  function initBackBlade() {
    // links that should open as blades: add attribute data-blade
    document.querySelectorAll('a[data-blade], a.open-as-blade').forEach((link) => {
      link.addEventListener('click', (evt) => {
        evt.preventDefault();
        const href = link.href;
        const title = link.getAttribute('data-blade-title') || link.textContent || 'Details';
        openBlade(href, title);
      });
      link.style.cursor = 'pointer';
    });

    // existing back buttons still work: close blade or navigate back
    document.querySelectorAll('.repo-back-btn, [data-back-btn]').forEach((el) => {
      el.addEventListener('click', (evt) => {
        evt.preventDefault();
        // if blade is open, close it
        const overlay = document.getElementById('bladeOverlay');
        if (overlay && overlay.classList.contains('active')) {
          closeBlade();
          return;
        }

        // otherwise, navigate normally with history fallback
        const href = el.getAttribute('href') || '/dashboard';
        if (window.history && window.history.length > 1) {
          window.history.back();
          return;
        }
        if (document.referrer) {
          window.location.href = document.referrer;
          return;
        }
        window.location.href = href;
      });
      el.setAttribute('role', 'button');
      el.style.cursor = 'pointer';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackBlade);
  } else {
    initBackBlade();
  }
})();
