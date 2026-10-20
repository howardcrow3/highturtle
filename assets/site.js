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

  // Signup form: send without leaving the page when the endpoint allows it.
  var form = document.getElementById('signup-form');
  var status = document.getElementById('form-status');

  if (form && status && window.fetch) {
    form.addEventListener('submit', function (e) {
      if (form.action.indexOf('YOUR_FORM_ID') !== -1) {
        e.preventDefault();
        status.className = 'form-status is-error';
        status.textContent = 'The signup form is not connected yet. Add your form endpoint in index.html.';
        return;
      }
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = 'Sending…';
      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (res.ok) {
          form.reset();
          status.className = 'form-status is-ok';
          status.textContent = 'You are on the list. Watch your inbox for the sample skill.';
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
