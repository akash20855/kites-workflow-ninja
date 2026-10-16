// Kites and Threads Workflow - install prompt and offline glue.
// This runs in a normal browser tab, in the installed phone app, and inside the
// Electron Mac app (where the page is loaded over file://). Nothing here may
// throw, and every behaviour is skipped quietly when its element is absent.
(function () {
  'use strict';

  var installBtn = document.getElementById('installBtn');
  var netState = document.getElementById('netState');
  var deferredPrompt = null;
  var registration = null;

  // Browsers only allow service workers on https or on localhost. Over file://
  // (the Mac app) or a plain http LAN address we skip registration entirely: the
  // app still works offline from local storage, it just cannot be installed.
  function isSecureOrigin() {
    if (location.protocol === 'https:') return true;
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  function activateWaiting(worker) {
    // Hand over to the new worker, then reload exactly once per browser session
    // so a half-updated page can never reload in a loop.
    try {
      if (sessionStorage.getItem('kt-sw-reloaded')) return;
      sessionStorage.setItem('kt-sw-reloaded', '1');
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        location.reload();
      });
      worker.postMessage('SKIP_WAITING');
    } catch (e) { /* private mode or blocked storage: leave the old worker in place */ }
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator) || !isSecureOrigin()) return;
    try {
      var swUrl = new URL('sw.js', document.baseURI).href;
      navigator.serviceWorker.register(swUrl, { scope: './' }).then(function (reg) {
        registration = reg;
        if (reg.waiting) activateWaiting(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', function () {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              activateWaiting(next);
            }
          });
        });
      }).catch(function () {
        // No service worker (offline first run, blocked cookies): the app still works.
      });
    } catch (e) { /* ignore */ }
  }

  function showInstallButton() {
    if (installBtn) installBtn.hidden = false;
  }

  function hideInstallButton() {
    if (installBtn) installBtn.hidden = true;
  }

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferredPrompt = ev;
    showInstallButton();
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      var prompt = deferredPrompt;
      deferredPrompt = null;
      hideInstallButton();
      try { prompt.prompt(); } catch (e) { /* ignore */ }
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideInstallButton();
  });

  function updateNetState() {
    if (!netState) return;
    var online = navigator.onLine !== false;
    netState.textContent = online ? '' : 'Offline - changes are saved on this device';
    try { document.body.classList.toggle('offline', !online); } catch (e) { /* ignore */ }
  }

  window.addEventListener('online', updateNetState);
  window.addEventListener('offline', updateNetState);

  updateNetState();
  registerWorker();

  window.KitesPWA = {
    canInstall: function () { return !!deferredPrompt; },
    update: function () { if (registration) registration.update(); },
  };
})();
