// ducks.ai adds a "presenter gate" for slide decks to every hosted page: unless the tab is in
// presenter mode, it cancels every n and t key press, so staff could not type those letters
// (emails, passwords, codes, bug reports). Presenter mode would also show ducks.ai's "edit text"
// button, so it stays off (an earlier version switched it on: clear that). Instead, a cancel of
// an n or t key press in one of this page's text boxes is ignored, so the letter is typed by the
// phone itself. (Putting the letter back by script, as an earlier version did, left iPhone
// keyboards thinking the box was still empty: the next letter came out as a capital.)
// Loaded by the officer and superadmin pages; harmless where there is no gate. See tests/gate.test.js.
(function () {
  'use strict';
  try { sessionStorage.removeItem('ducks-presenter:' + (location.pathname.split('/')[2] || '')); } catch (e) {}
  var cancel = KeyboardEvent.prototype.preventDefault;
  KeyboardEvent.prototype.preventDefault = function () {
    var t = this.target;
    if (this.type === 'keydown' && !this.ctrlKey && !this.metaKey && !this.altKey && /^[nt]$/i.test(this.key || '') && t &&
        (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|email|password|search|tel|url)$/.test(t.type)))) return;
    return cancel.call(this);
  };
})();
