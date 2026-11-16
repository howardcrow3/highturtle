// Header account control: "Sign in" when signed out, the Google avatar and first name when signed in.
// The link always goes to /account/, which works without this script; this only upgrades its look.
(function () {
  var a = document.querySelector('[data-acct]');
  if (!a || !window.fetch) return;
  fetch('/api/billing/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (!me || !me.signedIn) return;
      var first = (me.name || me.email || '').split(/[\s@]/)[0] || 'Account';
      var face;
      if (me.picture) {
        face = document.createElement('img');
        face.src = me.picture; face.alt = ''; face.width = 28; face.height = 28;
        face.referrerPolicy = 'no-referrer';
        face.onerror = function () { face.replaceWith(initial(first)); };
      } else {
        face = initial(first);
      }
      face.classList.add('acct-face');
      var label = document.createElement('span');
      label.className = 'acct-label';
      label.textContent = first;
      a.replaceChildren(face, label);
      a.classList.add('is-in');
      a.setAttribute('aria-label', 'Your account (' + (me.email || first) + ')');
      a.title = me.email || '';
    })
    .catch(function () {});
  function initial(name) {
    var s = document.createElement('span');
    s.className = 'acct-face acct-initial';
    s.textContent = (name[0] || '?').toUpperCase();
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
})();
