(function () {
  'use strict';
  // Download forms: send without leaving the page, fall back to a normal post.
  var forms = document.querySelectorAll('.dl-form');
  if (!window.fetch) { return; }
  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector('.form-status');
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
          form.reset();
          status.className = 'form-status is-ok';
          status.textContent = 'Sent. Check your inbox for the download link.';
        } else if (res.status === 400) {
          status.className = 'form-status is-error';
          status.textContent = 'That address does not look right. Check it and try again.';
        } else { throw new Error('bad response'); }
      }).catch(function () {
        status.className = 'form-status is-error';
        status.textContent = 'That did not go through. Check the address and try again.';
      });
    });
  });
})();
