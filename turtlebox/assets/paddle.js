/* Paddle.js checkout for Backer. Values come from backer/config.json at build time.
   Until a client token and price ID are set, buy buttons stay as "Coming soon". */
(function () {
  'use strict';
  var cfg = window.PADDLE_CONFIG || {};
  var buttons = document.querySelectorAll('[data-paddle-buy]');
  if (!buttons.length) return;
  function soon() {
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute('aria-disabled', 'true'); b.textContent = 'Coming soon';
    });
  }
  if (!cfg.clientToken || !cfg.priceId) { soon(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  s.async = true;
  s.onerror = soon;
  s.onload = function () {
    try {
      if (cfg.environment === 'sandbox') window.Paddle.Environment.set('sandbox');
      window.Paddle.Initialize({ token: cfg.clientToken });
    } catch (e) { soon(); return; }
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        window.Paddle.Checkout.open({
          items: [{ priceId: cfg.priceId, quantity: 1 }],
          settings: cfg.successUrl ? { successUrl: cfg.successUrl } : {}
        });
      });
    });
  };
  document.head.appendChild(s);
})();
