/* CYA Events Dashboard. Plain JS, talks to Supabase with supabase-js. */
(function () {
  "use strict";
  var cfg = window.CYA_CONFIG || {};
  var BUCKET = cfg.POSTERS_BUCKET || "posters";
  var connected = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    /^https:\/\//.test(cfg.SUPABASE_URL) && cfg.SUPABASE_ANON_KEY.indexOf("YOUR_") !== 0 &&
    window.supabase && window.supabase.createClient);
  var sb = connected ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var views = ["vLogin", "vDash", "vForm", "vPw"];
  var events = [], editing = null, removePoster = false, user = null;

  function show(id) {
    views.forEach(function (v) { $("#" + v).hidden = v !== id; });
    $("#navact").hidden = !user;
    window.scrollTo(0, 0);
  }
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function setErr(form, msg) { $(".err", form).textContent = msg || ""; }
  function busy(form, on) { form.querySelectorAll("button,input,textarea").forEach(function (el) { el.disabled = on; }); }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  function icon(n) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function fmtDate(e) {
    if (e.date_tbc) return "Date to be confirmed";
    if (!e.event_date) return "No exact date";
    var d = new Date(e.event_date + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  function friendly(err) {
    var m = (err && err.message) || "";
    if (/invalid login/i.test(m)) return "That email and password don't match. Please try again.";
    if (/network|fetch/i.test(m)) return "We couldn't reach the database. Please check your connection and try again.";
    return m || "Something went wrong. Please try again.";
  }

  /* ---------- Not connected: calm notice, everything disabled ---------- */
  if (!connected) {
    $("#notConnected").hidden = false;
    show("vLogin");
    busy($("#fLogin"), true);
    return;
  }

  /* ---------- Auth ---------- */
  async function refreshUser() {
    var r = await sb.auth.getUser();
    user = r.data && r.data.user;
    $("#pwReminder").hidden = !(user && user.user_metadata && user.user_metadata.must_change_password);
    if (user) { show("vDash"); loadEvents(); if (window.CYA_ADMIN) window.CYA_ADMIN.start(); } else show("vLogin");
  }

  $("#fLogin").addEventListener("submit", async function (e) {
    e.preventDefault(); var f = e.target; setErr(f);
    var email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) return setErr(f, "Please enter your email and password.");
    busy(f, true);
    var r = await sb.auth.signInWithPassword({ email: email, password: pw });
    busy(f, false);
    if (r.error) return setErr(f, friendly(r.error));
    f.reset(); await refreshUser(); toast("Welcome back.");
  });

  $("#btnOut").addEventListener("click", async function () {
    await sb.auth.signOut(); user = null; $("#pwReminder").hidden = true; show("vLogin"); toast("You're signed out. See you soon.");
  });

  function openPw() { $("#fPw").reset(); setErr($("#fPw")); show("vPw"); }
  $("#btnPw").addEventListener("click", openPw);
  $("#btnPwNow").addEventListener("click", openPw);
  $("#fPw").addEventListener("submit", async function (e) {
    e.preventDefault(); var f = e.target; setErr(f);
    if (f.p1.value.length < 10) return setErr(f, "Please use at least 10 characters.");
    if (f.p1.value !== f.p2.value) return setErr(f, "The two passwords don't match yet.");
    busy(f, true);
    var r = await sb.auth.updateUser({ password: f.p1.value, data: { must_change_password: false } });
    busy(f, false);
    if (r.error) return setErr(f, friendly(r.error));
    f.reset(); await refreshUser(); toast("Your password has been updated.");
  });

  /* ---------- Events list ---------- */
  window.CYA = { sb: sb, toast: toast, esc: esc, icon: icon, friendly: friendly, fmtDate: fmtDate,
    events: function () { return events; }, reloadEvents: function () { return loadEvents(); } };
  async function loadEvents() {
    var r = await sb.from("events").select("*")
      .order("date_tbc", { ascending: false }).order("event_date", { ascending: true, nullsFirst: true }).order("sort_order");
    if (r.error) { toast(friendly(r.error)); return; }
    events = r.data || []; render();
  }
  function card(e) {
    var th = e.poster_url ? '<img class="th" src="' + esc(e.poster_url) + '" alt="" loading="lazy">' : '<div class="th">' + icon("img") + "</div>";
    return '<article class="ev">' + th +
      "<div><h3>" + esc(e.title) + "</h3>" + (e.description ? "<p>" + esc(e.description) + "</p>" : "") + "</div>" +
      '<div class="meta">' + (e.date_tbc ? '<span class="pill">Date to be confirmed</span>' : "<span>" + icon("cal") + esc(fmtDate(e)) + "</span>") +
      (e.venue ? "<span>" + icon("pin") + esc(e.venue) + "</span>" : "") +
      (e.register_url ? "<span>" + icon("link") + "Register link</span>" : "") + "</div>" +
      '<div class="acts"><button class="btn bl sm" data-edit="' + e.id + '">' + icon("edit") + "<span>Edit</span></button>" +
      '<button class="btn bl sm" data-del="' + e.id + '" aria-label="Delete ' + esc(e.title) + '">' + icon("trash") + "<span>Delete</span></button></div></article>";
  }
  function render() {
    var up = events.filter(function (e) { return e.status === "upcoming"; });
    var past = events.filter(function (e) { return e.status === "past"; }).reverse();
    $("#listUp").innerHTML = up.length ? up.map(card).join("") : '<div class="empty">No upcoming events yet. Add one when you are ready.</div>';
    $("#listPast").innerHTML = past.length ? past.map(card).join("") : '<div class="empty">No past events yet.</div>';
  }
  $("#vDash").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var id = b.dataset.edit || b.dataset.del; if (!id) return;
    var ev = events.find(function (x) { return String(x.id) === id; });
    if (b.dataset.edit) openForm(ev); else askDelete(ev);
  });

  /* ---------- Add / edit ---------- */
  var f = $("#fEvent");
  function syncTbc() { f.event_date.disabled = f.date_tbc.checked; if (f.date_tbc.checked) f.event_date.value = ""; }
  f.date_tbc.addEventListener("change", syncTbc);
  $("#btnAdd").addEventListener("click", function () { openForm(null); });
  document.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", function () { show("vDash"); if (window.CYA_ADMIN && b.closest("#vForm")) window.CYA_ADMIN.tab("events"); }); });
  $("#btnRmPoster").addEventListener("click", function () { removePoster = true; $("#posterPrev").hidden = true; });

  function openForm(ev) {
    editing = ev; removePoster = false; f.reset(); setErr(f);
    $("#formTitle").textContent = ev ? "Edit event" : "Add event";
    if (ev) {
      f.title.value = ev.title || ""; f.event_date.value = ev.event_date || ""; f.date_tbc.checked = !!ev.date_tbc;
      f.venue.value = ev.venue || ""; f.description.value = ev.description || "";
      f.querySelector('[name=status][value="' + ev.status + '"]').checked = true;
      f.register_url.value = ev.register_url || ""; f.capacity.value = ev.capacity || "";
    }
    var pp = $("#posterPrev"); pp.hidden = !(ev && ev.poster_url); if (!pp.hidden) $("img", pp).src = ev.poster_url;
    syncTbc(); show("vForm");
  }

  async function uploadPoster(file) {
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    var path = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    var r = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (r.error) throw r.error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  f.addEventListener("submit", async function (e) {
    e.preventDefault(); setErr(f);
    var title = f.title.value.trim(), tbc = f.date_tbc.checked, date = f.event_date.value;
    var reg = f.register_url.value.trim(), file = f.poster.files[0];
    if (!title) return setErr(f, "Please give the event a title.");
    if (!tbc && !date) return setErr(f, "Please choose a date, or tick 'Date to be confirmed'.");
    if (reg && !/^https?:\/\/\S+$/i.test(reg)) return setErr(f, "The register link should start with https://");
    if (file && file.size > 5 * 1024 * 1024) return setErr(f, "That image is a little large. Please use one under 5 MB.");
    var row = {
      title: title, event_date: tbc ? null : date, date_tbc: tbc, venue: f.venue.value.trim() || null,
      description: f.description.value.trim() || null, status: f.querySelector("[name=status]:checked").value,
      register_url: reg || null
    };
    var cap = f.capacity.value.trim();
    if (cap && !(+cap >= 1)) return setErr(f, "Seat capacity should be a whole number, or left empty.");
    if (cap || (editing && editing.capacity != null)) row.capacity = cap ? Math.round(+cap) : null;
    busy(f, true);
    try {
      if (file) row.poster_url = await uploadPoster(file);
      else if (removePoster) row.poster_url = null;
      var r = editing ? await sb.from("events").update(row).eq("id", editing.id) : await sb.from("events").insert(row);
      if (r.error) throw r.error;
      toast(editing ? "Event updated." : "Event added.");
      show("vDash"); loadEvents(); if (window.CYA_ADMIN) window.CYA_ADMIN.tab('events');
    } catch (err) { setErr(f, friendly(err)); }
    busy(f, false); syncTbc();
  });

  /* ---------- Delete ---------- */
  var dlg = $("#dlg"), pending = null;
  function askDelete(ev) {
    pending = ev; $("#dlgTitle").textContent = "Delete this event?"; $("#dlgText").textContent = "\u201C" + ev.title + "\u201D will be removed from the website. This can't be undone.";
    dlg.showModal();
  }
  $("#dlgNo").addEventListener("click", function () { window.CYA_confirm = null; dlg.close(); });
  $("#dlgYes").addEventListener("click", async function () {
    if (window.CYA_confirm) { var fn = window.CYA_confirm; window.CYA_confirm = null; dlg.close(); return fn(); }
    var r = await sb.from("events").delete().eq("id", pending.id);
    dlg.close();
    if (r.error) return toast(friendly(r.error));
    toast("Event deleted."); loadEvents();
  });

  sb.auth.onAuthStateChange(function (evt) { if (evt === "SIGNED_OUT") { user = null; show("vLogin"); } });
  refreshUser();
})();
