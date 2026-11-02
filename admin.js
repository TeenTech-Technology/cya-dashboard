/* CYA Dashboard: Overview, Reservations, Volunteers, Partners, Gallery, Newsletter, Feedback, Visitors.
   Uses the signed-in Supabase client from app.js (window.CYA). */
(function () {
  "use strict";
  var C, sb, esc, icon, toast;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var started = false, current = "overview", cache = {};
  var STATUSES = ["new", "contacted", "active", "declined"];
  var SITE = "https://teentech-technology.github.io/cya-website/";

  function d(ts) { return ts ? new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""; }
  function dt(ts) { return ts ? new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function yn(v) { return v ? "Yes" : "No"; }
  function evDate(e) { return e ? C.fmtDate(e) : ""; }
  function missing(err) { return err && /does not exist|schema cache|not find|PGRST20|42P01|PGRST202/i.test((err.message || "") + (err.code || "")); }
  function notReady(el) {
    el.innerHTML = '<div class="notice"><svg class="ic"><use href="#i-info"/></svg><div><strong>Almost ready</strong><p>This section needs a one-time database update (migration_002.sql) before it can be used. Nothing is wrong; it just has not been switched on yet.</p></div></div>';
  }
  function head(title, sub, extra) {
    return '<div class="head"><div><h1>' + title + '</h1><p class="muted">' + sub + "</p></div>" + (extra || "") + "</div>";
  }
  function confirmDel(title, text, fn) {
    $("#dlgTitle").textContent = title; $("#dlgText").textContent = text;
    window.CYA_confirm = fn; $("#dlg").showModal();
  }
  function statusSel(id, val, table) {
    return '<select class="st" data-status="' + id + '" data-table="' + table + '" aria-label="Status">' + STATUSES.map(function (s) {
      return "<option" + (s === val ? " selected" : "") + ' value="' + s + '">' + cap(s) + "</option>"; }).join("") + "</select>";
  }

  /* ---------- Export ---------- */
  function toCsv(rows) {
    if (!rows.length) return "";
    var keys = Object.keys(rows[0]);
    var q = function (v) { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [keys.map(q).join(",")].concat(rows.map(function (r) { return keys.map(function (k) { return q(r[k]); }).join(","); })).join("\r\n");
  }
  function save(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function exportCsv(rows, name) { save(new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" }), name + "-" + stamp() + ".csv"); }
  var xlsxP;
  function loadXlsx() {
    return xlsxP || (xlsxP = new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      s.onload = ok; s.onerror = function () { xlsxP = null; no(); }; document.head.appendChild(s);
    }));
  }
  function exportXlsx(rows, name) {
    loadXlsx().then(function () {
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 30));
      XLSX.writeFile(wb, name + "-" + stamp() + ".xlsx");
    }).catch(function () { toast("Excel export could not load. The CSV file opens in Excel too."); });
  }
  function exportBtns(key) {
    return '<div class="exp"><button class="btn bl sm" type="button" data-csv="' + key + '">' + icon("down") + '<span>Export CSV</span></button>' +
      '<button class="btn bl sm" type="button" data-xlsx="' + key + '">' + icon("down") + "<span>Excel (.xlsx)</span></button></div>";
  }
  var exporters = {};
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-csv],[data-xlsx]"); if (!b) return;
    var k = b.dataset.csv || b.dataset.xlsx, x = exporters[k]; if (!x) return;
    var rows = x.rows(); if (!rows.length) return toast("There is nothing to export yet.");
    if (b.dataset.csv) exportCsv(rows, x.name); else exportXlsx(rows, x.name);
  });

  /* ---------- Table that becomes cards on phones ---------- */
  var phoneM = window.matchMedia("(max-width: 767px)");
  function table(cols, rows, rowFn, opt) {
    if (!rows.length) return '<div class="empty">Nothing here yet.</div>';
    opt = opt || {};
    var colsHtml = (opt.widths ? "<colgroup>" + opt.widths.map(function (w) { return '<col style="width:' + w + '">'; }).join("") + "</colgroup>" : "");
    return '<div class="tw' + (opt.fit ? " fit" : "") + '"><table class="tbl">' + colsHtml + "<thead><tr>" + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { var cells = rowFn(r); return "<tr>" + cells.map(function (v, i) {
        return '<td data-label="' + cols[i] + '">' + (v == null || v === "" ? '<span class="muted">-</span>' : v) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>";
  }
  function field(label, value) {
    return "<div><dt>" + label + "</dt><dd>" + (value == null || value === "" ? '<span class="muted">-</span>' : value) + "</dd></div>";
  }
  function cards(rows, render) {
    if (!rows.length) return '<div class="empty">Nothing here yet.</div>';
    return '<div class="acards">' + rows.map(render).join("") + "</div>";
  }
  function toolbar(key, opts) {
    return '<div class="tools"><label class="srch">' + icon("search") + '<input type="search" data-search="' + key + '" placeholder="' + (opts.ph || "Search") + '" aria-label="Search"></label>' +
      (opts.status ? '<select data-filter="' + key + '" aria-label="Filter by status"><option value="">All statuses</option>' + STATUSES.map(function (s) { return '<option value="' + s + '">' + cap(s) + "</option>"; }).join("") + "</select>" : "") +
      (opts.extra || "") + exportBtns(key) + "</div>";
  }
  function match(r, q, fields) {
    if (!q) return true; q = q.toLowerCase();
    return fields.some(function (f) { var v = typeof f === "function" ? f(r) : r[f]; return v != null && String(v).toLowerCase().indexOf(q) >= 0; });
  }
  function countsLine(rows) {
    var c = {}; rows.forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
    return '<div class="chips"><span class="chip"><b>' + rows.length + "</b> total</span>" + STATUSES.map(function (s) {
      return '<span class="chip s-' + s + '"><b>' + (c[s] || 0) + "</b> " + s + "</span>"; }).join("") + "</div>";
  }

  /* ---------- Volunteers & Partners (same pattern) ---------- */
  var people = {
    volunteers: { title: "Volunteers", sub: "People who offered to help through the website.", ph: "Search name, phone, parent phone, area, skills",
      cols: ["Received", "Volunteer", "Area", "Age", "Parent", "Skills and interests", "Status", ""],
      widths: ["9%", "16%", "10%", "8%", "14%", "16%", "18%", "9%"],
      fields: ["full_name", "phone", "email", "parent_phone", "area", "skills", "availability", "message"],
      row: function (r) { return [d(r.created_at),
        '<div class="sub"><b>' + esc(r.full_name) + "</b><small>" + esc(r.phone) + "</small>" + (r.email ? '<small><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a></small>" : "") + "</div>",
        esc(r.area), esc(r.age_range),
        '<div class="sub">' + (r.parent_permission ? '<span class="pill ok">Yes</span>' : '<span class="pill grey">No</span>') + "<small>" + (r.parent_phone ? esc(r.parent_phone) : '<span class="muted">-</span>') + "</small></div>",
        '<div class="sub"><span>' + esc(r.skills) + "</span><small>Availability: " + esc(r.availability) + "</small>" + (r.message ? "<small>" + esc(r.message) + "</small>" : "") + "</div>",
        statusSel(r.id, r.status, "volunteers"), delBtn("volunteers", r.id, r.full_name)]; },
      exp: function (r) { return { Received: dt(r.created_at), Name: r.full_name, Phone: r.phone, Email: r.email || "", Area: r.area, "Age range": r.age_range || "",
        "Parent permission": yn(r.parent_permission), "Parent phone": r.parent_phone || "",
        "Skills and interests": r.skills, Availability: r.availability, Message: r.message || "", Status: r.status }; } },
    partners: { title: "Partners", sub: "Organisations interested in partnering with CYA.", ph: "Search organisation, person, phone, email",
      cols: ["Received", "Organisation", "Contact person", "Contact", "Type", "Message", "Status", ""],
      fields: ["organisation", "contact_person", "phone", "email", "partnership_type", "message"],
      row: function (r) { return [d(r.created_at), "<b>" + esc(r.organisation) + "</b>", esc(r.contact_person),
        esc(r.phone) + '<br><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>", esc(cap(r.partnership_type)), esc(r.message), statusSel(r.id, r.status, "partners"), delBtn("partners", r.id, r.organisation)]; },
      exp: function (r) { return { Received: dt(r.created_at), Organisation: r.organisation, "Contact person": r.contact_person, Phone: r.phone, Email: r.email,
        Type: r.partnership_type, Message: r.message || "", Status: r.status }; } }
  };
  function delBtn(table, id, label) { return '<button class="btn bl sm ib" type="button" data-rm="' + table + '" data-id="' + id + '" data-label="' + esc(label || "") + '" aria-label="Delete">' + icon("trash") + "</button>"; }

  async function loadPeople(key) {
    var cfg = people[key], el = $("#p-" + key);
    var r = await sb.from(key).select("*").order("created_at", { ascending: false });
    if (r.error) { if (missing(r.error)) return notReady(el); return toast(C.friendly(r.error)); }
    cache[key] = r.data;
    el.innerHTML = head(cfg.title, cfg.sub) + toolbar(key, { status: true, ph: cfg.ph }) + '<div data-count="' + key + '"></div><div data-list="' + key + '"></div>';
    exporters[key] = { name: "cya-" + key, rows: function () { return filtered(key).map(cfg.exp); } };
    drawPeople(key);
  }
  function filtered(key) {
    var el = $("#p-" + key), q = ($("[data-search]", el) || {}).value, st = ($("[data-filter]", el) || {}).value;
    var fields = people[key] ? people[key].fields : (lists[key] && lists[key].fields) || [];
    return (cache[key] || []).filter(function (r) { return (!st || r.status === st) && match(r, q, fields); });
  }
  function volCard(r) {
    return '<article class="acard"><div class="acard-top"><b>' + esc(r.full_name) + '</b><small class="muted">' + d(r.created_at) + "</small></div><dl>" +
      field("Phone", esc(r.phone)) + field("Email", r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>" : "") +
      field("Area", esc(r.area)) + field("Age", esc(r.age_range)) + field("Parent permission", yn(r.parent_permission)) + field("Parent phone", esc(r.parent_phone)) +
      field("Skills and interests", esc(r.skills)) + field("Availability", esc(r.availability)) + field("Message", esc(r.message)) +
      field("Status", statusSel(r.id, r.status, "volunteers")) + "</dl><div class=\"acts\">" + delBtn("volunteers", r.id, r.full_name) + "</div></article>";
  }
  function drawPeople(key) {
    var cfg = people[key], rows = filtered(key);
    $('[data-count="' + key + '"]').innerHTML = countsLine(cache[key]);
    $('[data-list="' + key + '"]').innerHTML = key === "volunteers" && phoneM.matches ? cards(rows, volCard) : table(cfg.cols, rows, cfg.row, cfg.widths ? { fit: true, widths: cfg.widths } : null);
  }

  /* ---------- Subscribers & Feedback ---------- */
  var lists = {
    subscribers: { fields: ["email", "name"] },
    feedback: { fields: [function (r) { return r.events && r.events.title; }, "comments", "name"] }
  };
  async function loadSubscribers() {
    var el = $("#p-subscribers");
    var r = await sb.from("subscribers").select("*").order("created_at", { ascending: false });
    if (r.error) { if (missing(r.error)) return notReady(el); return toast(C.friendly(r.error)); }
    cache.subscribers = r.data;
    el.innerHTML = head("Newsletter", "People who signed up for CYA news on the website. " + r.data.length + " subscriber" + (r.data.length === 1 ? "" : "s") + ".") +
      toolbar("subscribers", { ph: "Search email or name" }) + '<div data-list="subscribers"></div>';
    exporters.subscribers = { name: "cya-newsletter", rows: function () { return filtered("subscribers").map(function (r) { return { Email: r.email, Name: r.name || "", "Signed up": dt(r.created_at) }; }); } };
    drawSubscribers();
  }
  function drawSubscribers() {
    $('[data-list="subscribers"]').innerHTML = table(["Email", "Name", "Signed up", ""], filtered("subscribers"), function (r) {
      return ['<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>", esc(r.name), d(r.created_at), delBtn("subscribers", r.id, r.email)]; });
  }
  function stars(n) { var s = ""; for (var i = 1; i <= 5; i++) s += '<svg class="ic star' + (i <= n ? " on" : "") + '"><use href="#i-star"/></svg>'; return '<span class="stars" aria-label="' + n + ' out of 5">' + s + "</span>"; }
  async function loadFeedback() {
    var el = $("#p-feedback");
    var r = await sb.from("feedback").select("*,events(title)").order("created_at", { ascending: false });
    if (r.error) { if (missing(r.error)) return notReady(el); return toast(C.friendly(r.error)); }
    cache.feedback = r.data;
    var by = {}; r.data.forEach(function (f) { var k = (f.events && f.events.title) || "Unknown event"; (by[k] = by[k] || []).push(f.rating); });
    var avg = Object.keys(by).map(function (k) { var a = by[k]; return { t: k, n: a.length, avg: a.reduce(function (x, y) { return x + y; }, 0) / a.length }; });
    el.innerHTML = head("Feedback", "What people said after CYA events.") +
      '<div class="cards">' + (avg.length ? avg.map(function (a) { return '<div class="stat"><span class="lbl">' + esc(a.t) + '</span><b>' + a.avg.toFixed(1) + '</b><span>' + stars(Math.round(a.avg)) + " " + a.n + " response" + (a.n === 1 ? "" : "s") + "</span></div>"; }).join("") : "") + "</div>" +
      toolbar("feedback", { ph: "Search event, comments, name" }) + '<div data-list="feedback"></div>';
    exporters.feedback = { name: "cya-feedback", rows: function () { return filtered("feedback").map(function (f) { return { Event: f.events ? f.events.title : "", Rating: f.rating, Comments: f.comments || "", Name: f.name || "", Received: dt(f.created_at) }; }); } };
    drawFeedback();
  }
  function drawFeedback() {
    $('[data-list="feedback"]').innerHTML = table(["Received", "Event", "Rating", "Comments", "Name", ""], filtered("feedback"), function (f) {
      return [d(f.created_at), esc(f.events && f.events.title), stars(f.rating), esc(f.comments), esc(f.name), delBtn("feedback", f.id, "this feedback")]; });
  }

  /* ---------- Reservations ---------- */
  function waNumber(p) {
    var n = String(p || "").replace(/\D/g, "");
    if (n.indexOf("00") === 0) n = n.slice(2);
    if (n.length === 10 && n.charAt(0) === "0") n = "260" + n.slice(1);
    else if (n.length === 9) n = "260" + n;
    return n.length >= 11 ? n : "";
  }
  function waLink(r) {
    var e = r.events || {}, n = waNumber(r.phone); if (!n) return "";
    var msg = "Hello " + r.full_name + ", this is a friendly reminder from Chingola Youth Association about " + (e.title || "our event") +
      " on " + evDate(e) + (e.venue ? " at " + e.venue : "") + ". Your ticket code is " + r.ticket_code + " (" + r.seats + " seat" + (r.seats > 1 ? "s" : "") + "). We look forward to seeing you!";
    return "https://wa.me/" + n + "?text=" + encodeURIComponent(msg);
  }
  /* Public tickets encode only the ticket code (cya-website events.js: qrSvg(ticket.code)). */
  function parseCode(raw) {
    var s = String(raw || "").toUpperCase();
    var m = s.match(/CYA-[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}/);
    if (m) return m[0];
    m = s.match(/CYA-[A-Z0-9]{4,12}/);
    return m ? m[0] : "";
  }
  function findTicket(code) {
    code = String(code || "").toUpperCase();
    return (cache.reservations || []).find(function (r) { return String(r.ticket_code || "").toUpperCase() === code; });
  }
  var qrDetector = null;
  try { if (window.BarcodeDetector) qrDetector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { qrDetector = null; }
  var scanOn = false, scanStream = null, scanTimer = null, scanBusy = false, scanCanvas = null, scanCode = "", scanRaw = "";
  function scanNote(msg) {
    var el = $("[data-scan-msg]"); if (!el) return;
    el.textContent = msg || ""; el.hidden = !msg;
  }
  function decodeImageData(data, w, h) {
    if (typeof jsQR !== "function") return "";
    try { var code = jsQR(data, w, h, { inversionAttempts: "attemptBoth" }); return (code && code.data) || ""; }
    catch (e) { return ""; }
  }
  function frameJsQR(video) {
    var w = video.videoWidth, h = video.videoHeight; if (!w || !h) return "";
    if (!scanCanvas) scanCanvas = document.createElement("canvas");
    var scale = Math.min(1, 480 / Math.max(w, h));
    var cw = Math.max(1, Math.floor(w * scale)), ch = Math.max(1, Math.floor(h * scale));
    scanCanvas.width = cw; scanCanvas.height = ch;
    var ctx = scanCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, cw, ch);
    var img = ctx.getImageData(0, 0, cw, ch);
    return decodeImageData(img.data, cw, ch);
  }
  function frameText(video) {
    if (qrDetector) return qrDetector.detect(video).then(function (codes) {
      if (codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
      return frameJsQR(video);
    }, function () { return frameJsQR(video); });
    return Promise.resolve(frameJsQR(video));
  }
  function scanTick() {
    if (!scanOn || scanBusy) return;
    var video = $("[data-scan-video]");
    if (!video) return;
    scanBusy = true;
    frameText(video).then(function (text) { if (text) onScan(text, false); }).catch(function () {}).then(function () {
      scanBusy = false; if (scanOn) scanTimer = setTimeout(scanTick, 250);
    });
  }
  function stopScan() {
    scanOn = false; scanBusy = false;
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (scanStream) { scanStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); scanStream = null; }
    var video = $("[data-scan-video]"); if (video) { try { video.pause(); } catch (e) {} video.srcObject = null; }
    var live = $("[data-scan-live]"); if (live) live.hidden = true;
    var start = $("[data-scan-start]"); if (start) start.hidden = false;
    var stop = $("[data-scan-stop]"); if (stop) stop.hidden = true;
  }
  async function openCamera() {
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) { var err = new Error("no camera"); err.name = "NotFoundError"; throw err; }
    try { return await md.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } }); }
    catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError" || e.name === "SecurityError")) throw e;
      return md.getUserMedia({ audio: false, video: true });
    }
  }
  async function startScan() {
    if (scanOn) return;
    scanNote("");
    if (!window.isSecureContext) { scanNote("The camera needs a secure page (https). Type the ticket code below."); return; }
    var stream;
    try { stream = await openCamera(); }
    catch (e) {
      var name = e && e.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") scanNote("Camera permission was blocked. Allow the camera for this site in the browser settings, or type the ticket code below.");
      else if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") scanNote("No camera was found on this device. Type the ticket code below, or choose a photo of the ticket.");
      else scanNote("The camera could not be started. Type the ticket code below, or choose a photo of the ticket.");
      return;
    }
    var video = $("[data-scan-video]"); if (!video) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    scanStream = stream; video.srcObject = stream; video.muted = true; video.setAttribute("playsinline", "");
    var playP = video.play(); if (playP && playP.catch) playP.catch(function () {});
    scanOn = true;
    var live = $("[data-scan-live]"); if (live) live.hidden = false;
    var start = $("[data-scan-start]"); if (start) start.hidden = true;
    var stop = $("[data-scan-stop]"); if (stop) stop.hidden = false;
    scanNote("Point the camera at the ticket QR code. Scanning stays on for the next ticket.");
    scanTick();
  }
  function scanFile(file) {
    if (!file) return;
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      var ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      var max = 800, scale = Math.min(1, max / Math.max(c.width, c.height));
      if (scale < 1) {
        var c2 = document.createElement("canvas"); c2.width = Math.max(1, Math.floor(c.width * scale)); c2.height = Math.max(1, Math.floor(c.height * scale));
        c2.getContext("2d", { willReadFrequently: true }).drawImage(c, 0, 0, c2.width, c2.height); c = c2;
      }
      var imgData = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      var text = decodeImageData(imgData.data, c.width, c.height);
      if (text) onScan(text, true); else scanNote("No QR code found in that photo. Try again, or type the code below.");
    };
    img.onerror = function () { URL.revokeObjectURL(url); scanNote("That photo could not be opened. Type the ticket code below."); };
    img.src = url;
  }
  function onScan(raw, force) {
    var code = parseCode(raw);
    if (!code) {
      if (force || raw !== scanRaw) { scanRaw = String(raw || ""); scanNote("That QR is not a CYA ticket code. The code looks like CYA-7KX2PQ. You can type it below."); }
      return;
    }
    if (!force && code === scanCode) return;
    scanCode = code; scanRaw = String(raw || "");
    showScanResult(code);
  }
  function selectedEvent() {
    var sel = $("[data-evf]"); if (!sel || !sel.value) return null;
    var id = sel.value, ev = (C.events() || []).filter(function (e) { return e.id === id; })[0];
    return ev || { id: id, title: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "the selected event" };
  }
  function showScanResult(code) {
    var box = $("[data-scan-result]"); if (!box) return;
    var x = findTicket(code);
    if (!x) {
      box.innerHTML = '<div class="scanres bad"><p class="scanflag">No ticket found</p><p>Nothing matches <b class="code">' + esc(code) + "</b>. Check the code, or type it in the box below.</p></div>";
      return;
    }
    var chosen = selectedEvent(), other = chosen && x.event_id !== chosen.id;
    var bits = [];
    if (other) bits.push("This ticket is for " + (x.events && x.events.title ? x.events.title : "another event") + ", not " + (chosen.title || "the event you selected") + ".");
    if (x.checked_in) bits.push("Already checked in" + (x.checked_in_at ? " (" + dt(x.checked_in_at) + ")." : "."));
    var kind = !bits.length ? "ok" : "warn";
    var flag = !bits.length ? "Ready to check in" : bits.join(" ");
    var btn = x.checked_in
      ? '<button class="btn bl sm" type="button" data-checkin="' + x.id + '">' + icon("check") + "<span>Undo check-in</span></button>"
      : '<button class="btn bb scan-go" type="button" data-checkin="' + x.id + '">' + icon("check") + "<span>Check in</span></button>";
    box.innerHTML = '<div class="scanres ' + kind + '"><p class="scanflag">' + esc(flag) + '</p><p class="code">' + esc(x.ticket_code) + "</p><h3>" + esc(x.full_name) + "</h3><p>" +
      esc(x.events && x.events.title) + " · " + x.seats + " seat" + (x.seats > 1 ? "s" : "") + "</p>" + minorCell(x) + btn + "</div>";
  }
  async function loadReservations() {
    stopScan(); scanCode = ""; scanRaw = "";
    var el = $("#p-reservations");
    var r = await sb.from("reservations").select("*,events(id,title,event_date,date_tbc,venue,capacity)").order("created_at", { ascending: false });
    if (r.error) { if (missing(r.error)) return notReady(el); return toast(C.friendly(r.error)); }
    cache.reservations = r.data;
    var evs = C.events();
    var opts = '<select data-evf aria-label="Filter by event"><option value="">All events</option>' + evs.map(function (e) { return '<option value="' + e.id + '">' + esc(e.title) + "</option>"; }).join("") + "</select>";
    el.innerHTML = head("Reservations", "Seats booked through the website. Look up a ticket code at the door and mark people as checked in.") +
      toolbar("reservations", { ph: "Search name, phone, parent phone, code", extra: opts }) +
      '<div class="scanbox"><div class="scanbar"><button class="btn bb sm" type="button" data-scan-start>' + icon("cam") + '<span>Scan ticket</span></button>' +
      '<button class="btn bl sm" type="button" data-scan-stop hidden>' + icon("x") + "<span>Stop</span></button>" +
      '<label class="btn bl sm filebtn"><span>Choose a photo</span><input type="file" accept="image/*" data-scan-file></label></div>' +
      '<p class="muted scanhelp">Point the camera at the QR code on the ticket. It contains the ticket code, for example CYA-7KX2PQ. Pick one event in the filter if you want a warning when a ticket is for a different event.</p>' +
      '<p class="scanmsg" data-scan-msg hidden role="status"></p><div class="scanlive" data-scan-live hidden><video data-scan-video playsinline muted autoplay></video></div><div data-scan-result></div></div>' +
      '<form class="lookup" data-lookup><label class="srch">' + icon("ticket") + '<input name="code" placeholder="Or type the code, e.g. CYA-7KX2PQ" aria-label="Ticket code" autocapitalize="characters"></label><button class="btn bb sm" type="submit">Find ticket</button></form><div data-found></div>' +
      '<div class="cards" data-totals></div><div data-list="reservations"></div>';
    exporters.reservations = { name: "cya-reservations", rows: function () { return resFiltered().map(function (x) { return { "Ticket code": x.ticket_code, Event: x.events ? x.events.title : "",
      "Event date": evDate(x.events), Name: x.full_name, Phone: x.phone, Email: x.email || "",
      "Under 18": yn(x.under_18), "Parent permission": yn(x.parent_permission), "Parent phone": x.parent_phone || "",
      Seats: x.seats, "Checked in": x.checked_in ? "Yes" : "No", Booked: dt(x.created_at) }; }); } };
    drawReservations();
  }
  function resFiltered() {
    var el = $("#p-reservations"), q = $("[data-search]", el).value, ev = $("[data-evf]", el).value;
    return cache.reservations.filter(function (x) { return (!ev || x.event_id === ev) && match(x, q, ["full_name", "phone", "email", "ticket_code", "parent_phone"]); });
  }
  var RES_COLS = ["Code", "Event", "Attendee", "Minor", "Seats", "Check-in", ""];
  var RES_W = ["12%", "15%", "20%", "18%", "7%", "13%", "15%"];
  function resActs(x) {
    var wa = waLink(x);
    return '<div class="acts"><button class="btn sm ' + (x.checked_in ? "bl" : "bb") + '" type="button" data-checkin="' + x.id + '">' + icon("check") + "<span>" + (x.checked_in ? "Undo" : "Check in") + "</span></button>" +
      (wa ? '<a class="btn bl sm" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon("chat") + "<span>WhatsApp reminder</span></a>" : "") + delBtn("reservations", x.id, x.ticket_code) + "</div>";
  }
  function resStatus(x) {
    return x.checked_in ? '<span class="pill ok">' + icon("check") + "Checked in</span>" + (x.checked_in_at ? '<br><small class="muted">' + dt(x.checked_in_at) + "</small>" : "") : '<span class="pill grey">Not yet</span>';
  }
  function minorCell(x) {
    return '<div class="sub">' + (x.under_18 ? '<span class="pill">Minor</span>' : '<span class="pill grey">No</span>') +
      "<small>Permission: " + yn(x.parent_permission) + "</small><small>" + (x.parent_phone ? esc(x.parent_phone) : '<span class="muted">-</span>') + "</small></div>";
  }
  function resRow(x) {
    return ['<b class="code">' + esc(x.ticket_code) + "</b>", esc(x.events && x.events.title),
      '<div class="sub"><b>' + esc(x.full_name) + "</b><small>" + esc(x.phone) + "</small>" + (x.email ? "<small>" + esc(x.email) + "</small>" : "") + "</div>",
      minorCell(x), x.seats, resStatus(x), resActs(x)];
  }
  function resCard(x) {
    return '<article class="acard"><div class="acard-top"><b class="code">' + esc(x.ticket_code) + "</b>" + resStatus(x) + "</div><h3>" + esc(x.full_name) + "</h3><dl>" +
      field("Event", esc(x.events && x.events.title)) + field("Phone", esc(x.phone)) +
      field("Email", x.email ? '<a href="mailto:' + esc(x.email) + '">' + esc(x.email) + "</a>" : "") +
      field("Seats", String(x.seats)) + field("Under 18", yn(x.under_18)) + field("Parent permission", yn(x.parent_permission)) +
      field("Parent phone", esc(x.parent_phone)) + "</dl>" + resActs(x) + "</article>";
  }
  function resList(rows) {
    return phoneM.matches ? cards(rows, resCard) : table(RES_COLS, rows, resRow, { fit: true, widths: RES_W });
  }
  function drawReservations() {
    var rows = resFiltered(), ev = $("[data-evf]").value, tot = {};
    cache.reservations.forEach(function (x) { if (ev && x.event_id !== ev) return; var k = x.event_id; tot[k] = tot[k] || { e: x.events, seats: 0, n: 0, inn: 0 }; tot[k].seats += x.seats; tot[k].n++; if (x.checked_in) tot[k].inn += x.seats; });
    $("[data-totals]").innerHTML = Object.keys(tot).map(function (k) { var t = tot[k], c = t.e && t.e.capacity;
      return '<div class="stat"><span class="lbl">' + esc(t.e && t.e.title) + "</span><b>" + t.seats + (c ? " / " + c : "") + '</b><span>seats booked in ' + t.n + " booking" + (t.n === 1 ? "" : "s") + (c ? ", " + Math.max(c - t.seats, 0) + " left" : "") + ", " + t.inn + " checked in</span></div>"; }).join("");
    $('[data-list="reservations"]').innerHTML = resList(rows);
  }
  async function checkIn(id) {
    var x = cache.reservations.find(function (r) { return r.id === id; }); if (!x) return;
    var on = !x.checked_in, r = await sb.from("reservations").update({ checked_in: on, checked_in_at: on ? new Date().toISOString() : null }).eq("id", id);
    if (r.error) return toast(C.friendly(r.error));
    x.checked_in = on; x.checked_in_at = on ? new Date().toISOString() : null;
    toast(on ? x.full_name + " is checked in." : "Check-in undone."); drawReservations(); lookupShow();
    if (scanCode && String(x.ticket_code || "").toUpperCase() === scanCode) showScanResult(scanCode);
  }
  var lastCode = "";
  function lookupShow() {
    var box = $("[data-found]"); if (!box || !lastCode) return;
    var x = findTicket(lastCode);
    box.innerHTML = x ? '<div class="found">' + resList([x]) + "</div>" :
      '<div class="empty">No ticket found with code ' + esc(lastCode) + ". Please check the code and try again.</div>";
  }

  /* ---------- Gallery ---------- */
  async function loadGallery() {
    var el = $("#p-gallery");
    var r = await sb.from("gallery").select("*,events(title)").order("sort_order").order("created_at", { ascending: false });
    if (r.error) { if (missing(r.error)) return notReady(el); return toast(C.friendly(r.error)); }
    cache.gallery = r.data;
    var opts = '<option value="">Not linked to an event</option>' + C.events().map(function (e) { return '<option value="' + e.id + '">' + esc(e.title) + "</option>"; }).join("");
    el.innerHTML = head("Gallery", "Photos shown on the website Gallery page. Link a photo to an event to show it with that event too.", '<a class="btn bl sm" href="' + SITE + 'gallery.html" target="_blank" rel="noopener">' + icon("link") + "<span>View gallery</span></a>") +
      '<form class="card up" data-gup novalidate><h2>Add photos</h2><label>Photos <em>(JPG, PNG or WebP, up to 5 MB each; you can choose several)</em><input type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple required></label>' +
      '<label>Caption <em>(optional)</em><input name="caption" maxlength="300"></label><label>Event <em>(optional)</em><select name="event">' + opts + '</select></label><p class="err" role="alert"></p><div class="actions"><button class="btn bc" type="submit">' + icon("plus") + "<span>Upload</span></button></div></form>" +
      '<h2 class="k">' + r.data.length + " photo" + (r.data.length === 1 ? "" : "s") + '</h2><div class="gal">' + (r.data.length ? r.data.map(function (g) {
        return '<figure><img src="' + esc(g.image_url) + '" alt="" loading="lazy"><figcaption><input value="' + esc(g.caption || "") + '" maxlength="300" placeholder="Add a caption" data-cap="' + g.id + '" aria-label="Caption">' +
          '<select data-gev="' + g.id + '" aria-label="Event">' + opts.replace('value="' + g.event_id + '"', 'value="' + g.event_id + '" selected') + "</select>" +
          '<button class="btn bl sm" type="button" data-gdel="' + g.id + '">' + icon("trash") + "<span>Delete</span></button></figcaption></figure>"; }).join("") : '<div class="empty">No photos yet. Add your first ones above.</div>') + "</div>";
  }
  async function uploadGallery(f) {
    var files = [].slice.call(f.files.files), err = $(".err", f); err.textContent = "";
    if (!files.length) { err.textContent = "Please choose at least one photo."; return; }
    var big = files.filter(function (x) { return x.size > 5 * 1024 * 1024; });
    if (big.length) { err.textContent = "Some photos are larger than 5 MB. Please resize them first."; return; }
    var btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i], ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        var path = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
        var u = await sb.storage.from("gallery").upload(path, file, { contentType: file.type, upsert: false }); if (u.error) throw u.error;
        var url = sb.storage.from("gallery").getPublicUrl(path).data.publicUrl;
        var ins = await sb.from("gallery").insert({ image_url: url, path: path, caption: f.caption.value.trim() || null, event_id: f.event.value || null }); if (ins.error) throw ins.error;
      }
      toast(files.length === 1 ? "Photo added." : files.length + " photos added."); loadGallery();
    } catch (e) { err.textContent = C.friendly(e); btn.disabled = false; }
  }

  /* ---------- Visitors ---------- */
  async function loadStats() {
    var el = $("#p-stats"), r = await sb.rpc("view_stats", { p_days: 30 });
    if (r.error) { if (missing(r.error)) return notReady(el); return toast(C.friendly(r.error)); }
    var s = r.data, max = Math.max.apply(null, s.days.map(function (x) { return x.views; }).concat([1]));
    el.innerHTML = head("Visitors", "Website visits over the last 30 days. Each page is counted once per visit. No names, IP addresses or cookies are stored.") +
      '<div class="cards"><div class="stat"><span class="lbl">Page views, last 30 days</span><b>' + s.total + "</b></div>" +
      '<div class="stat"><span class="lbl">Today</span><b>' + (s.days.length ? s.days[s.days.length - 1].views : 0) + "</b></div></div>" +
      '<div class="card wide"><h2>Visits per day</h2><div class="bars" role="img" aria-label="Visits per day chart">' + s.days.map(function (x) {
        return '<div class="bar" title="' + d(x.day) + ": " + x.views + '"><i style="height:' + Math.round(x.views / max * 100) + '%"></i></div>'; }).join("") +
      '</div><div class="bax"><span>' + (s.days[0] ? d(s.days[0].day) : "") + "</span><span>Today</span></div></div>" +
      '<div class="two-col"><div class="card wide"><h2>Top pages</h2>' + (s.pages.length ? '<ol class="top">' + s.pages.map(function (p) { return "<li><span>" + esc(p.path) + "</span><b>" + p.views + "</b></li>"; }).join("") + "</ol>" : '<p class="muted">No visits recorded yet.</p>') + "</div>" +
      '<div class="card wide"><h2>Where visitors came from</h2>' + (s.referrers.length ? '<ol class="top">' + s.referrers.map(function (p) { return "<li><span>" + esc(p.referrer_domain) + "</span><b>" + p.views + "</b></li>"; }).join("") + "</ol>" : '<p class="muted">Mostly direct visits so far.</p>') + "</div></div>";
  }

  /* ---------- Overview ---------- */
  async function count(t) { var r = await sb.from(t).select("*", { count: "exact", head: true }); return r.error ? null : r.count; }
  async function loadOverview() {
    var el = $("#p-overview");
    el.innerHTML = head("Overview", "A quick look at what is happening with CYA online.") + '<div class="empty">Loading...</div>';
    await C.reloadEvents();
    var res = await Promise.all(["volunteers", "partners", "reservations", "subscribers"].map(count));
    var fb = await sb.from("feedback").select("rating");
    var seats = await sb.rpc("event_seats");
    var ready = res.every(function (x) { return x !== null; });
    var avg = fb.data && fb.data.length ? (fb.data.reduce(function (a, b) { return a + b.rating; }, 0) / fb.data.length).toFixed(1) : "-";
    var today = new Date().toISOString().slice(0, 10);
    var up = C.events().filter(function (e) { return e.status === "upcoming" && (!e.event_date || e.event_date >= today); })
      .sort(function (a, b) { if (a.event_date && b.event_date) return a.event_date < b.event_date ? -1 : 1; return a.event_date ? -1 : b.event_date ? 1 : a.sort_order - b.sort_order; });
    var next = up[0], taken = 0;
    if (next && seats.data) seats.data.forEach(function (s) { if (s.event_id === next.id) taken = s.seats_taken; });
    var tile = function (n, lbl, tab, ic) { return '<button class="stat link-tile" type="button" data-go="' + tab + '"><span class="lbl">' + icon(ic) + lbl + "</span><b>" + (n == null ? "-" : n) + "</b></button>"; };
    var html = head("Overview", "A quick look at what is happening with CYA online.") +
      (ready ? "" : '<div class="notice warm"><svg class="ic"><use href="#i-info"/></svg><div><strong>Some sections are not switched on yet</strong><p>Volunteers, partners, reservations, newsletter, gallery, feedback and visitor numbers need a one-time database update (migration_002.sql).</p></div></div>') +
      '<div class="cards">' + tile(res[0], "Volunteers", "volunteers", "users") + tile(res[1], "Partner enquiries", "partners", "hand") + tile(res[2], "Reservations", "reservations", "ticket") +
      tile(res[3], "Newsletter subscribers", "subscribers", "mail") + tile(avg, "Average feedback rating", "feedback", "star") + "</div>" +
      '<div class="two-col"><div class="card wide"><h2>Next event</h2>' + (next ? "<h3>" + esc(next.title) + '</h3><p class="muted">' + esc(C.fmtDate(next)) + (next.venue ? " &middot; " + esc(next.venue) : "") + "</p>" +
        '<p class="big">' + taken + " seat" + (taken === 1 ? "" : "s") + " booked" + (next.capacity ? ", " + Math.max(next.capacity - taken, 0) + " of " + next.capacity + " left" : " (no seat limit set)") + "</p>" +
        '<button class="btn bl sm" type="button" data-go="reservations">' + icon("ticket") + "<span>See reservations</span></button>" : '<p class="muted">No upcoming events yet.</p>') + "</div>" +
      '<div class="card wide"><h2>Recent activity</h2><ul class="act" data-activity><li class="muted">Loading...</li></ul></div></div>';
    el.innerHTML = html;
    if (!ready) { $("[data-activity]").innerHTML = '<li class="muted">Activity will appear here once the update is applied.</li>'; return; }
    var q = function (t, sel) { return sb.from(t).select(sel).order("created_at", { ascending: false }).limit(5); };
    var all = await Promise.all([q("volunteers", "full_name,created_at"), q("partners", "organisation,created_at"), q("reservations", "full_name,seats,created_at,events(title)"),
      q("subscribers", "email,created_at"), q("feedback", "rating,created_at,events(title)")]);
    var items = [];
    (all[0].data || []).forEach(function (r) { items.push([r.created_at, "users", esc(r.full_name) + " offered to volunteer"]); });
    (all[1].data || []).forEach(function (r) { items.push([r.created_at, "hand", esc(r.organisation) + " asked about partnering"]); });
    (all[2].data || []).forEach(function (r) { items.push([r.created_at, "ticket", esc(r.full_name) + " reserved " + r.seats + " seat" + (r.seats > 1 ? "s" : "") + (r.events ? " for " + esc(r.events.title) : "")]); });
    (all[3].data || []).forEach(function (r) { items.push([r.created_at, "mail", "New newsletter subscriber"]); });
    (all[4].data || []).forEach(function (r) { items.push([r.created_at, "star", "New feedback (" + r.rating + "/5)" + (r.events ? " for " + esc(r.events.title) : "")]); });
    items.sort(function (a, b) { return a[0] < b[0] ? 1 : -1; });
    $("[data-activity]").innerHTML = items.length ? items.slice(0, 10).map(function (i) { return "<li>" + icon(i[1]) + "<span>" + i[2] + '<small class="muted">' + dt(i[0]) + "</small></span></li>"; }).join("") : '<li class="muted">Nothing yet. New sign-ups and bookings will show here.</li>';
  }

  /* ---------- Tabs & events ---------- */
  var loaders = { overview: loadOverview, reservations: loadReservations, volunteers: function () { return loadPeople("volunteers"); }, partners: function () { return loadPeople("partners"); },
    gallery: loadGallery, subscribers: loadSubscribers, feedback: loadFeedback, stats: loadStats, events: function () { return C.reloadEvents(); } };
  function tab(name) {
    if (name !== "reservations") stopScan();
    current = name;
    document.querySelectorAll("#tabs [data-tab]").forEach(function (b) { var on = b.dataset.tab === name; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); b.removeAttribute("aria-selected"); var t = $("#secTitle"); if (on && t) t.textContent = b.textContent.trim(); });
    if (window.CYA_NAV) CYA_NAV.close();
    document.querySelectorAll("#vDash [data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    loaders[name]();
  }
  function bind() {
    $("#tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) { tab(b.dataset.tab); var c = document.querySelector(".content"); if (c) window.scrollTo(0, 0); } });
    var dash = $("#vDash");
    dash.addEventListener("click", function (e) {
      if (e.target.closest("[data-scan-start]")) return startScan();
      if (e.target.closest("[data-scan-stop]")) return stopScan();
      var b = e.target.closest("[data-go]"); if (b) return tab(b.dataset.go);
      b = e.target.closest("[data-checkin]"); if (b) return checkIn(b.dataset.checkin);
      b = e.target.closest("[data-rm]");
      if (b) { var t = b.dataset.rm, id = b.dataset.id;
        return confirmDel("Delete this entry?", "\u201C" + b.dataset.label + "\u201D will be permanently removed. This can't be undone.", async function () {
          var r = await sb.from(t).delete().eq("id", id); if (r.error) return toast(C.friendly(r.error));
          toast("Deleted."); loaders[current](); }); }
      b = e.target.closest("[data-gdel]");
      if (b) { var g = cache.gallery.find(function (x) { return x.id === b.dataset.gdel; });
        return confirmDel("Delete this photo?", "The photo will be removed from the website gallery. This can't be undone.", async function () {
          if (g.path) await sb.storage.from("gallery").remove([g.path]);
          var r = await sb.from("gallery").delete().eq("id", g.id); if (r.error) return toast(C.friendly(r.error));
          toast("Photo deleted."); loadGallery(); }); }
    });
    dash.addEventListener("input", function (e) {
      var k = e.target.dataset.search; if (!k) return;
      if (people[k]) drawPeople(k); else if (k === "subscribers") drawSubscribers(); else if (k === "feedback") drawFeedback(); else if (k === "reservations") drawReservations();
    });
    dash.addEventListener("change", async function (e) {
      var t = e.target;
      if (t.dataset.filter) return drawPeople(t.dataset.filter);
      if (t.hasAttribute("data-scan-file")) { if (t.files && t.files[0]) scanFile(t.files[0]); t.value = ""; return; }
      if (t.hasAttribute("data-evf")) { drawReservations(); if (scanCode) showScanResult(scanCode); return; }
      if (t.dataset.status) {
        var r = await sb.from(t.dataset.table).update({ status: t.value }).eq("id", t.dataset.status);
        if (r.error) return toast(C.friendly(r.error));
        var row = cache[t.dataset.table].find(function (x) { return x.id === t.dataset.status; }); if (row) row.status = t.value;
        toast("Status updated to " + t.value + "."); $('[data-count="' + t.dataset.table + '"]').innerHTML = countsLine(cache[t.dataset.table]); return;
      }
      if (t.dataset.cap || t.dataset.gev) {
        var upd = t.dataset.cap ? { caption: t.value.trim() || null } : { event_id: t.value || null };
        var r2 = await sb.from("gallery").update(upd).eq("id", t.dataset.cap || t.dataset.gev);
        toast(r2.error ? C.friendly(r2.error) : "Photo updated.");
      }
    });
    dash.addEventListener("submit", function (e) {
      if (e.target.matches("[data-gup]")) { e.preventDefault(); uploadGallery(e.target); }
      if (e.target.matches("[data-lookup]")) { e.preventDefault(); lastCode = e.target.code.value.trim().toUpperCase(); if (lastCode && !/^CYA-/.test(lastCode)) lastCode = "CYA-" + lastCode; lookupShow(); }
    });
    var onPhone = function () {
      if (current === "reservations" && cache.reservations) { drawReservations(); lookupShow(); }
      if (current === "volunteers" && cache.volunteers) drawPeople("volunteers");
    };
    if (phoneM.addEventListener) phoneM.addEventListener("change", onPhone);
    else if (phoneM.addListener) phoneM.addListener(onPhone);
  }

  window.CYA_ADMIN = {
    start: function () {
      C = window.CYA; if (!C) return; sb = C.sb; esc = C.esc; icon = C.icon; toast = C.toast;
      if (!started) { started = true; bind(); }
      var h = location.hash.slice(1); tab(loaders[h] ? h : "overview");
    },
    tab: function (n) { if (started) tab(n); }
  };
  if (window.CYA && !document.getElementById("vDash").hidden) window.CYA_ADMIN.start();
})();
