(function () {
  function initBackBlade() {
    document.querySelectorAll('.repo-back-btn, [data-back-btn]').forEach((el) => {
      const href = el.getAttribute('href') || '/dashboard';

      const navigateBack = (evt) => {
        if (evt && evt.preventDefault) evt.preventDefault();
        try {
          if (window.history && window.history.length > 1) {
            window.history.back();
            return;
          }

          if (document.referrer) {
            window.location.href = document.referrer;
            return;
          }

          window.location.href = href;
        } catch (e) {
          window.location.href = href;
        }
      };

      // Attach handler for anchors and buttons
      if (el.tagName && el.tagName.toLowerCase() === 'a') {
        el.addEventListener('click', navigateBack);
      } else {
        el.addEventListener('click', navigateBack);
      }

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
