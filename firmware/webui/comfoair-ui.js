// Custom web interface for comfoair-esp32 (ESPHome web_server, js_include).
// Reads live values from /events (server-sent events) and controls the unit
// through the REST API. Login is handled by the browser (web_server auth).
(() => {
  "use strict";

  // --- Entity mapping (ESPHome ids "domain/Name") -------------------------
  const E = {
    climate: "climate/Ventilation",
    level: "sensor/Level",
    outside: "sensor/Outside air", supply: "sensor/Supply air",
    extract: "sensor/Extract air", exhaust: "sensor/Exhaust air",
    supplyPct: "sensor/Supply fan", exhaustPct: "sensor/Exhaust fan",
    supplyRpm: "sensor/Supply fan speed", exhaustRpm: "sensor/Exhaust fan speed",
    supplyRunning: "binary_sensor/Supply fan running",
    panel: "switch/Wall panel",
    boost: "button/Boost", boostMinutes: "sensor/Boost duration",
    bypassPos: "sensor/Bypass position", bypassOpen: "binary_sensor/Bypass open",
    summer: "binary_sensor/Summer mode", frost: "binary_sensor/Frost protection active",
    frostLevel: "text_sensor/Frost protection level", preheat: "binary_sensor/Preheating active",
    filterDirty: "binary_sensor/Filter dirty", filterHours: "sensor/Filter hours",
    filterState: "text_sensor/Filter status", filterWeeks: "sensor/Filter warning after weeks",
    hours: ["sensor/Hours level 0", "sensor/Hours level 1",
            "sensor/Hours level 2", "sensor/Hours level 3"],
    hoursBypass: "sensor/Hours bypass open",
    supplyLevels: [0, 1, 2, 3].map(i => `number/Supply level ${i}`),
    exhaustLevels: [0, 1, 2, 3].map(i => `number/Exhaust level ${i}`),
    syncLevels: "button/Write fan levels to unit",
    bathOn: "sensor/Bathroom switch on delay", bathOff: "sensor/Bathroom switch off delay",
    wifi: "sensor/WiFi signal", version: "text_sensor/ESPHome version",
    status: "binary_sensor/Status", led: "light/Status LED",
  };

  // Fan modes of the component: OFF = level 0 (away) … HIGH = level 3
  const LEVELS = [
    ["OFF", "Away", "0"], ["LOW", "Low", "1"],
    ["MEDIUM", "Medium", "2"], ["HIGH", "High", "3"],
  ];

  const state = {};
  let title = "Ventilation", uptime = 0, connected = false;

  // --- Helpers -------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const num = id => { const v = state[id]?.value; const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
  const on = id => state[id]?.value === true || state[id]?.state === "ON";
  const fmt = (v, digits = 1) => v === null ? "–" : v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtInt = v => v === null ? "–" : Math.round(v).toLocaleString("en-GB");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const url = (id, action, params = "") => "/" + id.split("/").map(encodeURIComponent).join("/") + "/" + action + params;

  async function post(id, action, params = "") {
    try {
      const res = await fetch(url(id, action, params), { method: "POST", body: "" });
      if (!res.ok) throw new Error("HTTP " + res.status);
    } catch (err) {
      toast("Command failed: " + err.message, true);
    }
  }

  function toast(text, isError = false) {
    const t = $("#toast");
    t.textContent = text;
    t.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.className = "toast"), 3000);
  }

  // --- Page layout ------------------------------------------------
  const CSS = `
  :root{--bg:#f4f2ee;--card:#fff;--text:#1d1c1a;--muted:#6f6a63;--line:#e3dfd8;--accent:#0b7a75;
    --accent-soft:#dff1ef;--cold:#2f6fd6;--warm:#d9622b;--warn:#b26a00;--warn-soft:#fff3dc;--err:#b3261e;
    --shadow:0 1px 2px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);color-scheme:light}
  @media (prefers-color-scheme:dark){:root{--bg:#121313;--card:#1c1d1d;--text:#eeece8;--muted:#a19d96;
    --line:#2c2d2d;--accent:#3fc2b9;--accent-soft:#163533;--cold:#6aa2ff;--warm:#ff8f5a;--warn:#f0b54a;
    --warn-soft:#3a2d12;--err:#ff7a70;--shadow:none;color-scheme:dark}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:980px;margin:0 auto;padding:16px}
  header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin:4px 0 16px}
  h1{font-size:22px;margin:0;letter-spacing:-.01em}
  .meta{display:flex;gap:14px;color:var(--muted);font-size:13px;flex-wrap:wrap}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--err);margin-right:6px;vertical-align:1px}
  .dot.ok{background:#2fa36b}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow)}
  .grid{display:grid;gap:12px}
  .g2{grid-template-columns:1.15fr .85fr}
  .levels{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .lvl{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:12px;padding:12px 6px;
    font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;transition:.15s}
  .lvl b{font-size:22px;line-height:1}
  .lvl span{font-size:13px;color:var(--muted)}
  .lvl:hover{border-color:var(--accent)}
  .lvl.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .lvl.active span{color:#fff;opacity:.9}
  .row{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
  .btn{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:10px;padding:9px 14px;
    font:inherit;cursor:pointer}
  .btn:hover{border-color:var(--accent)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .toggle{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
  .sw{width:40px;height:22px;border-radius:11px;background:var(--line);position:relative;transition:.15s;flex:none}
  .sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
  .toggle.on .sw{background:var(--accent)}
  .toggle.on .sw::after{left:21px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px;font-weight:600}
  .hx{width:100%;height:auto;display:block}
  .hx text{fill:var(--text);font:600 15px system-ui,sans-serif}
  .hx .lbl{fill:var(--muted);font:500 11px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em}
  .eff{margin-top:6px;color:var(--muted);font-size:13px;text-align:center}
  .fan{margin-bottom:14px}
  .bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin-top:6px}
  .bar i{display:block;height:100%;background:var(--accent);border-radius:5px;transition:width .4s}
  .small{font-size:13px;color:var(--muted)}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .chip{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
  .chip.act{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
  .alert{display:none;align-items:center;gap:12px;background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn);
    border-radius:12px;padding:12px 16px;font-weight:600}
  .alert.show{display:flex}
  details.card{padding:0}
  details summary{list-style:none;cursor:pointer;padding:14px 16px;font-weight:600;display:flex;justify-content:space-between}
  details summary::after{content:"▸";color:var(--muted);transition:.15s}
  details[open] summary::after{transform:rotate(90deg)}
  details .body{padding:0 16px 16px}
  table{width:100%;border-collapse:collapse}
  td,th{padding:7px 4px;border-bottom:1px solid var(--line);text-align:left;font-weight:400}
  th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  td.r,th.r{text-align:right}
  input[type=number]{width:72px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);
    color:var(--text);font:inherit;text-align:right}
  .hbar{height:6px;border-radius:3px;background:var(--accent);opacity:.7}
  .log{background:#0e0f0f;color:#d6d3cd;border-radius:10px;padding:10px;height:260px;overflow:auto;
    font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
  .log .w{color:#f0b54a}.log .e{color:#ff7a70}.log .d{color:#8b8780}
  .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%) translateY(80px);background:var(--text);color:var(--bg);
    padding:10px 16px;border-radius:10px;transition:.25s;font-size:14px;z-index:9}
  .toast.show{transform:translateX(-50%) translateY(0)}
  .toast.error{background:var(--err);color:#fff}
  footer{color:var(--muted);font-size:12px;text-align:center;margin:20px 0 8px}
  @media (max-width:720px){.g2{grid-template-columns:1fr}.levels{grid-template-columns:repeat(2,1fr)}}
  `;

  // Heat exchanger diagram: outside → supply (into the house), extract → exhaust (out of the house)
  const HX_SVG = `
  <svg class="hx" viewBox="0 0 420 230" role="img" aria-label="Heat exchanger with four temperatures">
    <defs>
      <marker id="ac" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--cold)"/></marker>
      <marker id="aw" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--warm)"/></marker>
    </defs>
    <text class="lbl" x="18" y="18">Outside</text><text class="lbl" x="402" y="18" text-anchor="end">House</text>
    <path d="M118,72 L178,115 L242,115 L298,156" fill="none" stroke="var(--cold)" stroke-width="5" stroke-linecap="round" marker-end="url(#ac)"/>
    <path d="M302,72 L242,115 L178,115 L122,156" fill="none" stroke="var(--warm)" stroke-width="5" stroke-linecap="round" marker-end="url(#aw)"/>
    <rect x="170" y="80" width="80" height="70" rx="10" fill="var(--card)" stroke="var(--line)" stroke-width="2" transform="rotate(45 210 115)"/>
    <text class="lbl" x="210" y="119" text-anchor="middle">HX</text>
    <text x="18" y="52" id="t-out">–</text><text class="lbl" x="18" y="70">Outside air</text>
    <text x="402" y="52" text-anchor="end" id="t-ext">–</text><text class="lbl" x="402" y="70" text-anchor="end">Extract air</text>
    <text x="18" y="196" id="t-exh">–</text><text class="lbl" x="18" y="214">Exhaust air</text>
    <text x="402" y="196" text-anchor="end" id="t-sup">–</text><text class="lbl" x="402" y="214" text-anchor="end">Supply air</text>
  </svg>`;

  function build() {
    document.title = title;
    document.head.insertAdjacentHTML("beforeend",
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style>`);
    document.body.innerHTML = `
    <div class="wrap">
      <header>
        <h1 id="title">${esc(title)}</h1>
        <div class="meta"><span><span class="dot" id="conn"></span><span id="conn-text">connecting …</span></span>
          <span id="wifi"></span><span id="uptime"></span></div>
      </header>
      <div class="grid">
        <section class="card">
          <h2>Ventilation level</h2>
          <div class="levels" id="levels">${LEVELS.map(([m, name, n]) =>
            `<button class="lvl" data-mode="${m}"><b>${n}</b><span>${name}</span></button>`).join("")}</div>
          <div class="row actions">
            <button class="btn" id="boost">Boost</button>
            <label class="toggle" id="panel"><span class="sw"></span><span>Wall panel</span></label>
          </div>
        </section>
        <div class="alert" id="alert-filter">⚠ <span id="alert-filter-text">Filter dirty</span></div>
        <div class="grid g2">
          <section class="card"><h2>Temperatures</h2>${HX_SVG}<div class="eff" id="eff"></div></section>
          <section class="card"><h2>Fans</h2>
            <div class="fan"><div class="row"><span>Supply</span><span><b id="sup-pct">–</b> <span class="small" id="sup-rpm"></span></span></div>
              <div class="bar"><i id="sup-bar" style="width:0"></i></div></div>
            <div class="fan"><div class="row"><span>Exhaust</span><span><b id="exh-pct">–</b> <span class="small" id="exh-rpm"></span></span></div>
              <div class="bar"><i id="exh-bar" style="width:0"></i></div></div>
            <h2 style="margin-top:18px">Status</h2>
            <div class="chips" id="chips"></div>
          </section>
        </div>
        <details class="card" id="settings"><summary>Settings</summary><div class="body">
          <table><thead><tr><th>Level</th><th class="r">Supply %</th><th class="r">Exhaust %</th></tr></thead>
            <tbody>${LEVELS.map((l, i) => `<tr><td>${l[2]} · ${l[1]}</td>
              <td class="r"><input type="number" data-id="${E.supplyLevels[i]}"></td>
              <td class="r"><input type="number" data-id="${E.exhaustLevels[i]}"></td></tr>`).join("")}</tbody></table>
          <p class="small">Changed values apply after “Write fan levels to unit”.</p>
          <div class="actions"><button class="btn primary" id="sync">Write fan levels to unit</button></div>
          <table style="margin-top:14px"><tbody>
            <tr><td>Boost duration</td><td class="r" id="v-boostmin">–</td></tr>
            <tr><td>Bathroom switch on delay</td><td class="r" id="v-bathon">–</td></tr>
            <tr><td>Bathroom switch off delay</td><td class="r" id="v-bathoff">–</td></tr>
          </tbody></table>
        </div></details>
        <details class="card"><summary>Maintenance</summary><div class="body">
          <table><tbody id="hours"></tbody></table>
          <table style="margin-top:14px"><tbody>
            <tr><td>Filter status</td><td class="r" id="v-filterstate">–</td></tr>
            <tr><td>Filter hours</td><td class="r" id="v-filterhours">–</td></tr>
            <tr><td>Filter warning after</td><td class="r" id="v-filterweeks">–</td></tr>
          </tbody></table>
        </div></details>
        <details class="card" id="system"><summary>System</summary><div class="body">
          <table><tbody>
            <tr><td>Firmware</td><td class="r small" id="v-version">–</td></tr>
            <tr><td>Status LED</td><td class="r"><label class="toggle" id="led" style="justify-content:flex-end"><span class="sw"></span></label></td></tr>
          </tbody></table>
          <h2 style="margin-top:16px">Update firmware</h2>
          <form id="ota" class="row" style="flex-wrap:wrap">
            <input type="file" name="update" accept=".bin" required>
            <button class="btn primary" type="submit">Upload</button>
          </form>
          <p class="small" id="ota-status"></p>
          <h2 style="margin-top:16px">Log</h2>
          <div class="log" id="log"></div>
        </div></details>
      </div>
      <footer>comfoair-esp32 · ESPHome</footer>
    </div>
    <div class="toast" id="toast"></div>`;

    $("#levels").addEventListener("click", ev => {
      const b = ev.target.closest(".lvl"); if (!b) return;
      post(E.climate, "set", "?fan_mode=" + b.dataset.mode);
      toast("Level " + b.querySelector("span").textContent);
    });
    $("#boost").addEventListener("click", () => { post(E.boost, "press"); toast("Boost started"); });
    $("#panel").addEventListener("click", () => post(E.panel, on(E.panel) ? "turn_off" : "turn_on"));
    $("#led").addEventListener("click", () => post(E.led, "toggle"));
    $("#sync").addEventListener("click", () => {
      if (confirm("Write the fan levels to the ventilation unit now?")) { post(E.syncLevels, "press"); toast("Fan levels written"); }
    });
    document.querySelectorAll("input[data-id]").forEach(inp =>
      inp.addEventListener("change", () => post(inp.dataset.id, "set", "?value=" + encodeURIComponent(inp.value))));
    $("#ota").addEventListener("submit", uploadFirmware);
    // http://<address>/#open expands all sections
    if (location.hash === "#open") document.querySelectorAll("details").forEach(d => (d.open = true));
  }

  // --- Update view -------------------------------------------
  function render() {
    $("#conn").className = "dot" + (connected ? " ok" : "");
    $("#conn-text").textContent = connected ? "connected" : "disconnected";
    const rssi = num(E.wifi);
    $("#wifi").textContent = rssi === null ? "" : `WiFi ${rssi} dBm`;
    if (uptime) {
      const d = Math.floor(uptime / 86400), h = Math.floor(uptime % 86400 / 3600), m = Math.floor(uptime % 3600 / 60);
      $("#uptime").textContent = "up " + (d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`);
    }

    const mode = state[E.climate]?.fan_mode;
    document.querySelectorAll(".lvl").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    $("#panel").classList.toggle("on", on(E.panel));
    $("#led").classList.toggle("on", on(E.led));

    const tOut = num(E.outside), tSup = num(E.supply), tExt = num(E.extract), tExh = num(E.exhaust);
    $("#t-out").textContent = fmt(tOut) + " °C"; $("#t-sup").textContent = fmt(tSup) + " °C";
    $("#t-ext").textContent = fmt(tExt) + " °C"; $("#t-exh").textContent = fmt(tExh) + " °C";
    // Recovery is only meaningful with enough temperature difference and the bypass closed
    let eff = "";
    if ([tOut, tSup, tExt].every(v => v !== null) && tExt - tOut >= 5 && !on(E.bypassOpen)) {
      const r = Math.max(0, Math.min(100, (tSup - tOut) / (tExt - tOut) * 100));
      eff = `Heat recovery approx. ${Math.round(r)} %`;
    } else if (on(E.bypassOpen)) eff = "Bypass open – outside air bypasses the heat exchanger";
    $("#eff").textContent = eff;

    const sp = num(E.supplyPct), ep = num(E.exhaustPct);
    $("#sup-pct").textContent = sp === null ? "–" : sp + " %";
    $("#exh-pct").textContent = ep === null ? "–" : ep + " %";
    $("#sup-bar").style.width = (sp || 0) + "%"; $("#exh-bar").style.width = (ep || 0) + "%";
    const sr = num(E.supplyRpm), er = num(E.exhaustRpm);
    $("#sup-rpm").textContent = sr === null ? "" : fmtInt(sr) + " rpm";
    $("#exh-rpm").textContent = er === null ? "" : fmtInt(er) + " rpm";

    const bp = num(E.bypassPos);
    const chips = [
      [`Bypass ${on(E.bypassOpen) ? "open" : "closed"}${bp ? ` (${bp} %)` : ""}`, on(E.bypassOpen)],
      ["Summer mode", on(E.summer)],
      [`Frost protection${on(E.frost) ? " active" : ""}`, on(E.frost)],
      ["Preheating", on(E.preheat)],
      ["Supply fan", on(E.supplyRunning)],
    ];
    $("#chips").innerHTML = chips.map(([t, a]) => `<span class="chip${a ? " act" : ""}">${esc(t)}</span>`).join("");

    const dirty = on(E.filterDirty);
    $("#alert-filter").classList.toggle("show", dirty);
    if (dirty) $("#alert-filter-text").textContent =
      `Filter dirty – ${fmtInt(num(E.filterHours))} h, replacement due`;

    document.querySelectorAll("input[data-id]").forEach(inp => {
      const s = state[inp.dataset.id]; if (!s || document.activeElement === inp) return;
      inp.min = s.min_value; inp.max = s.max_value; inp.step = s.step; inp.value = s.value;
    });
    const show = (sel, id, unit) => { const v = num(id); $(sel).textContent = v === null ? "–" : fmtInt(v) + unit; };
    show("#v-boostmin", E.boostMinutes, " min"); show("#v-bathon", E.bathOn, " min"); show("#v-bathoff", E.bathOff, " min");
    show("#v-filterhours", E.filterHours, " h"); show("#v-filterweeks", E.filterWeeks, " weeks");
    $("#v-filterstate").textContent = ({ Full: "full – replacement due", Ok: "OK" })[state[E.filterState]?.state] ?? state[E.filterState]?.state ?? "–";
    $("#v-version").textContent = state[E.version]?.state ?? "–";

    const hrs = E.hours.map(num), max = Math.max(1, ...hrs.filter(v => v !== null));
    $("#hours").innerHTML = LEVELS.map((l, i) => `<tr><td style="width:160px;white-space:nowrap">Level ${l[2]} · ${l[1]}</td>
      <td><div class="hbar" style="width:${(hrs[i] || 0) / max * 100}%"></div></td>
      <td class="r" style="width:90px">${fmtInt(hrs[i])} h</td></tr>`).join("") +
      `<tr><td>Bypass open</td><td></td><td class="r">${fmtInt(num(E.hoursBypass))} h</td></tr>`;
  }

  let renderPending = false;
  const scheduleRender = () => { if (!renderPending) { renderPending = true; requestAnimationFrame(() => { renderPending = false; render(); }); } };

  // --- Log and firmware upload -----------------------------------------
  function appendLog(line) {
    const box = $("#log"); if (!box) return;
    const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
    const cls = /^\[E\]/.test(clean) ? "e" : /^\[W\]/.test(clean) ? "w" : /^\[[DV]/.test(clean) ? "d" : "";
    const div = document.createElement("div"); if (cls) div.className = cls;
    div.textContent = new Date().toLocaleTimeString("en-GB") + "  " + clean;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    box.appendChild(div);
    while (box.childNodes.length > 300) box.removeChild(box.firstChild);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function uploadFirmware(ev) {
    ev.preventDefault();
    const form = ev.target, status = $("#ota-status");
    if (!confirm("Upload new firmware? The board restarts afterwards.")) return;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/update");
    xhr.upload.onprogress = e => { if (e.lengthComputable) status.textContent = `Uploading … ${Math.round(e.loaded / e.total * 100)} %`; };
    xhr.onload = () => { status.textContent = xhr.status === 200 ? "Done – the board is restarting." : "Error: HTTP " + xhr.status; };
    xhr.onerror = () => { status.textContent = "Upload failed."; };
    xhr.send(new FormData(form));
  }

  // --- Live connection -------------------------------------------------
  function connect() {
    const es = new EventSource("/events");
    es.addEventListener("open", () => { connected = true; scheduleRender(); });
    es.addEventListener("error", () => { connected = false; scheduleRender(); });
    es.addEventListener("ping", ev => {
      try {
        const d = JSON.parse(ev.data || "{}");
        if (d.title) { title = d.title; $("#title").textContent = title; document.title = title; }
        if (d.uptime) uptime = d.uptime;
      } catch (_) { /* ping without payload */ }
      connected = true; scheduleRender();
    });
    es.addEventListener("state", ev => {
      try { const d = JSON.parse(ev.data); state[d.id] = Object.assign(state[d.id] || {}, d); scheduleRender(); }
      catch (err) { console.warn("Invalid event", err); }
    });
    es.addEventListener("log", ev => appendLog(ev.data));
  }

  // Preview without a board: window.KWL_DEMO provides test data
  window.KWL_UI = { state, render: scheduleRender };
  const start = () => {
    build();
    if (window.KWL_DEMO) { window.KWL_DEMO(state); connected = true; uptime = 93784; render(); }
    else { connect(); setInterval(() => { uptime += 1; }, 1000); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
