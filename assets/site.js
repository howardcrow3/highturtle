(function () {
  'use strict';

  // Turtle shell: select a phase to show its activities.
  var scutes = Array.prototype.slice.call(document.querySelectorAll('.scute'));
  var phases = Array.prototype.slice.call(document.querySelectorAll('.phase'));

  function select(name) {
    scutes.forEach(function (s) {
      var on = s.getAttribute('data-phase') === name;
      s.classList.toggle('is-active', on);
      if (on) { s.setAttribute('aria-current', 'true'); } else { s.removeAttribute('aria-current'); }
    });
    phases.forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-phase') === name);
    });
  }

  if (scutes.length && phases.length) {
    scutes.forEach(function (s) {
      s.addEventListener('click', function (e) {
        e.preventDefault();
        select(s.getAttribute('data-phase'));
      });
    });

    var fromHash = (location.hash || '').replace('#phase-', '');
    var valid = phases.some(function (p) { return p.getAttribute('data-phase') === fromHash; });
    select(valid ? fromHash : 'discover');
  }

  // Signup form: send without leaving the page, fall back to a normal post.
  var form = document.getElementById('signup-form');
  var status = document.getElementById('form-status');

  if (form && status && window.fetch) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = 'Sending…';
      fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form)),
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (res.ok) {
          return res.json().then(function (d) { return d; }, function () { return {}; }).then(function (d) {
            form.reset();
            status.className = 'form-status is-ok';
            status.textContent = d.queued
              ? "You're on the list. We'll email you to confirm your address as soon as sending opens."
              : 'Almost done. Check your inbox and confirm your address.';
          });
        } else if (res.status === 400) {
          status.className = 'form-status is-error';
          status.textContent = 'That address does not look right. Check it and try again.';
        } else {
          throw new Error('bad response');
        }
      }).catch(function () {
        status.className = 'form-status is-error';
        status.textContent = 'That did not go through. Check the address and try again.';
      });
    });
  }
})();
