/* Responsive navigation: phone drawer, tablet rail toggle. No automatic sends of any kind. */
(function () {
  var side = document.getElementById("side"), scrim = document.getElementById("scrim"),
      menu = document.getElementById("btnMenu"), dash = document.getElementById("vDash"),
      rail = document.getElementById("btnRail"), phone = window.matchMedia("(max-width: 767px)");
  var lastFocus = null;
  function isOpen() { return side.classList.contains("open"); }
  function focusables() { return Array.prototype.filter.call(side.querySelectorAll("button, a[href], input, select"), function (el) { return !el.disabled && el.offsetParent !== null; }); }
  function open() {
    if (!phone.matches) return;
    lastFocus = document.activeElement;
    side.classList.add("open"); scrim.hidden = false;
    document.body.classList.add("lock"); menu.setAttribute("aria-expanded", "true");
    side.setAttribute("role", "dialog"); side.setAttribute("aria-modal", "true"); side.setAttribute("aria-label", "Menu");
    var cur = side.querySelector(".tabs button.on") || focusables()[0]; if (cur) setTimeout(function () { cur.focus(); }, 30);
  }
  function close(silent) {
    var was = isOpen();
    side.classList.remove("open"); scrim.hidden = true;
    document.body.classList.remove("lock"); menu.setAttribute("aria-expanded", "false");
    side.removeAttribute("role"); side.removeAttribute("aria-modal"); side.removeAttribute("aria-label");
    if (was && !silent && phone.matches && menu.offsetParent) menu.focus();
    else if (was && !silent && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  menu.addEventListener("click", function () { isOpen() ? close() : open(); });
  document.getElementById("btnClose").addEventListener("click", function () { close(); });
  scrim.addEventListener("click", function () { close(); });
  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!side.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });
  (phone.addEventListener ? phone.addEventListener.bind(phone, "change") : phone.addListener.bind(phone))(function () { close(true); });
  document.getElementById("sPw").addEventListener("click", function () { close(true); document.getElementById("btnPw").click(); });
  document.getElementById("sOut").addEventListener("click", function () { close(true); document.getElementById("btnOut").click(); });
  function setRail(x) {
    dash.classList.toggle("expanded", x); rail.setAttribute("aria-expanded", x);
    rail.setAttribute("aria-label", x ? "Collapse menu" : "Expand menu");
    rail.querySelector("span").textContent = x ? "Collapse" : "Expand";
    try { localStorage.setItem("cya_rail", x ? "1" : "0"); } catch (e) {}
  }
  rail.addEventListener("click", function () { setRail(!dash.classList.contains("expanded")); });
  var saved = null; try { saved = localStorage.getItem("cya_rail"); } catch (e) {}
  setRail(saved === "1");
  window.CYA_NAV = { open: open, close: close };
})();
