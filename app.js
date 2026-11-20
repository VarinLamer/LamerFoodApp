/* Lamerfood — ถ่ายรูปอาหาร นับแคลอรี่ด้วย ChatGPT */
(() => {
  "use strict";

  // ---------- Storage ----------
  const KEY_SETTINGS = "lamer.settings";
  const KEY_ENTRIES = "lamer.entries";
  const DEFAULT_SETTINGS = { apiKey: "", model: "gpt-4o-mini", goal: 2000 };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("save failed", e); return false; }
  }

  let settings = { ...DEFAULT_SETTINGS, ...load(KEY_SETTINGS, {}) };
  let entries = load(KEY_ENTRIES, {});

  // ---------- Helpers ----------
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n || 0).toLocaleString("th-TH");
  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TH_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const prettyDate = (k) => { const d = parseKey(k); return `${TH_DAYS[d.getDay()]} ${d.getDate()} ${TH_MONTHS[d.getMonth()]}`; };

  const MEALS = {
    breakfast: { label: "เช้า", emoji: "🍳" },
    lunch: { label: "กลางวัน", emoji: "🍜" },
    dinner: { label: "เย็น", emoji: "🍲" },
    snack: { label: "ของว่าง", emoji: "🧁" },
  };
  function mealByTime(d = new Date()) {
    const h = d.getHours();
    if (h >= 5 && h < 11) return "breakfast";
    if (h >= 11 && h < 15) return "lunch";
    if (h >= 17 && h < 22) return "dinner";
    return "snack";
  }

  let currentDate = dateKey();
  let draft = null;

  // ---------- Toast & confetti ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function hearts() {
    const box = $("#confetti");
    const icons = ["💗", "💖", "🩷", "✨", "🍓", "💕"];
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("span");
      s.textContent = icons[i % icons.length];
      s.style.left = Math.random() * 100 + "%";
      s.style.animationDelay = Math.random() * 0.4 + "s";
      s.style.setProperty("--r", (Math.random() * 120 - 60) + "deg");
      box.appendChild(s);
      setTimeout(() => s.remove(), 2400);
    }
  }

  // ---------- Navigation ----------
  function showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    if (name === "history") renderHistory();
    if (name === "settings") fillSettings();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

  // ---------- Today view ----------
  const CIRC = 2 * Math.PI * 84;
  function dayTotals(k) {
    const list = entries[k] || [];
    return list.reduce((acc, e) => {
      acc.kcal += e.total || 0;
      acc.p += e.macros?.p || 0;
      acc.c += e.macros?.c || 0;
      acc.f += e.macros?.f || 0;
      return acc;
    }, { kcal: 0, p: 0, c: 0, f: 0 });
  }

  function renderToday() {
    const today = dateKey();
    $("#dateLabel").textContent = currentDate === today ? `วันนี้ · ${prettyDate(currentDate)}`
      : currentDate === addDays(today, -1) ? `เมื่อวาน · ${prettyDate(currentDate)}` : prettyDate(currentDate);
    $("#nextDay").disabled = currentDate >= today;

    const goal = Number(settings.goal) || 2000;
    const t = dayTotals(currentDate);
    const pct = Math.min(t.kcal / goal, 1);
    const over = t.kcal > goal;
    const ring = $("#ringFill");
    ring.style.strokeDashoffset = String(CIRC * (1 - pct));
    ring.classList.toggle("over", over);
    ring.style.opacity = t.kcal > 0 ? "1" : "0";
    animateNumber($("#kcalEaten"), t.kcal);
    $("#kcalGoalLabel").textContent = `จาก ${fmt(goal)}`;
    const remain = $("#remainText");
    remain.textContent = over ? `เกินเป้ามา ${fmt(t.kcal - goal)} kcal` : t.kcal === 0 ? `เป้าหมาย ${fmt(goal)} kcal 💪` : `เหลืออีก ${fmt(goal - t.kcal)} kcal`;
    remain.classList.toggle("over", over);

    // Macro targets (rough): P 20%, C 50%, F 30% of goal
    const tgt = { p: goal * 0.2 / 4, c: goal * 0.5 / 4, f: goal * 0.3 / 9 };
    $("#mProtein").textContent = `${fmt(t.p)} g`;
    $("#mCarbs").textContent = `${fmt(t.c)} g`;
    $("#mFat").textContent = `${fmt(t.f)} g`;
    $("#bProtein").style.width = Math.min(100, (t.p / tgt.p) * 100) + "%";
    $("#bCarbs").style.width = Math.min(100, (t.c / tgt.c) * 100) + "%";
    $("#bFat").style.width = Math.min(100, (t.f / tgt.f) * 100) + "%";

    const list = (entries[currentDate] || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    $("#mealCount").textContent = `${list.length} รายการ`;
    $("#emptyState").style.display = list.length ? "none" : "block";
    $("#mealList").innerHTML = list.map((e) => {
      const m = MEALS[e.meal] || MEALS.snack;
      const name = e.items.map((i) => i.name).filter(Boolean).join(", ") || "อาหาร";
      const thumb = e.thumb ? `<img class="meal-thumb" src="${e.thumb}" alt="">` : `<div class="meal-thumb">${m.emoji}</div>`;
      return `<li class="meal">
        ${thumb}
        <div class="meal-info">
          <div class="meal-name" title="${esc(name)}">${esc(name)}</div>
          <div class="meal-meta"><span class="tag">${m.emoji} ${m.label}</span><span>${esc(e.time)} น.</span>${e.items.length > 1 ? `<span>· ${e.items.length} อย่าง</span>` : ""}</div>
        </div>
        <div class="meal-kcal"><b>${fmt(e.total)}</b><small>kcal</small></div>
        <div class="meal-actions">
          <button class="mini-btn" data-edit="${e.id}" aria-label="แก้ไข"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="mini-btn" data-del="${e.id}" aria-label="ลบ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
        </div>
      </li>`;
    }).join("");
  }

  function animateNumber(el, to) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    const start = performance.now();
    const dur = 700;
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
      el.textContent = fmt(v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  $("#prevDay").addEventListener("click", () => { currentDate = addDays(currentDate, -1); renderToday(); });
  $("#nextDay").addEventListener("click", () => { if (currentDate < dateKey()) { currentDate = addDays(currentDate, 1); renderToday(); } });
  $("#dateLabel").addEventListener("click", () => { currentDate = dateKey(); renderToday(); });

  $("#mealList").addEventListener("click", (ev) => {
    const ed = ev.target.closest("[data-edit]");
    const del = ev.target.closest("[data-del]");
    if (ed) {
      const e = (entries[currentDate] || []).find((x) => x.id === ed.dataset.edit);
      if (e) openEditor({ ...JSON.parse(JSON.stringify(e)), date: currentDate }, { editing: true });
    } else if (del) {
      if (!confirm("ลบรายการนี้ใช่ไหม?")) return;
      entries[currentDate] = (entries[currentDate] || []).filter((x) => x.id !== del.dataset.del);
      if (!entries[currentDate].length) delete entries[currentDate];
      save(KEY_ENTRIES, entries);
      renderToday();
      toast("ลบแล้ว 🗑️");
    }
  });

  // ---------- History ----------
  function renderHistory() {
    const goal = Number(settings.goal) || 2000;
    const today = dateKey();
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const vals = days.map((k) => dayTotals(k).kcal);
    const logged = vals.filter((v) => v > 0);
    $("#avgPill").textContent = `เฉลี่ย ${fmt(logged.length ? logged.reduce((a, b) => a + b, 0) / logged.length : 0)} kcal`;

    const W = 340, H = 210, top = 22, bottom = 30, left = 8, right = 8;
    const max = Math.max(goal * 1.15, ...vals) || 1;
    const ch = H - top - bottom;
    const slot = (W - left - right) / 7;
    const bw = Math.min(30, slot * 0.58);
    const y = (v) => top + ch - (v / max) * ch;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟแคลอรี่ 7 วัน">
      <defs><linearGradient id="barG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF5C9A"/><stop offset="100%" stop-color="#FFB3CF"/></linearGradient>
      <linearGradient id="barO" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E5484D"/><stop offset="100%" stop-color="#FF9EA2"/></linearGradient></defs>`;
    days.forEach((k, i) => {
      const v = vals[i];
      const cx = left + slot * i + slot / 2;
      const h = Math.max(v > 0 ? 6 : 3, (v / max) * ch);
      const fill = v > goal ? "url(#barO)" : v > 0 ? "url(#barG)" : "var(--track)";
      svg += `<rect class="bar-rect" x="${cx - bw / 2}" y="${top + ch - h}" width="${bw}" height="${h}" rx="${Math.min(10, bw / 2)}" fill="${fill}"/>`;
      if (v > 0) svg += `<text class="val" x="${cx}" y="${top + ch - h - 6}" text-anchor="middle">${fmt(v)}</text>`;
      const d = parseKey(k);
      svg += `<text x="${cx}" y="${H - 10}" text-anchor="middle" ${k === today ? 'style="fill:var(--pink-700);font-weight:600"' : ""}>${k === today ? "วันนี้" : TH_DAYS[d.getDay()] + d.getDate()}</text>`;
    });
    svg += `<line class="goal-line" x1="${left}" x2="${W - right}" y1="${y(goal)}" y2="${y(goal)}"/>
      <text x="${W - right}" y="${y(goal) - 5}" text-anchor="end" style="fill:var(--pink-700);font-size:10px">เป้า ${fmt(goal)}</text></svg>`;
    $("#weekChart").innerHTML = svg;

    const keys = Object.keys(entries).filter((k) => entries[k]?.length).sort().reverse().slice(0, 30);
    $("#dayList").innerHTML = keys.length ? keys.map((k) => {
      const t = dayTotals(k);
      const n = entries[k].length;
      return `<li class="day-item"><button data-day="${k}"><div class="d">${prettyDate(k)}${k === today ? " · วันนี้" : ""}</div>
        <div class="s">${n} รายการ · ${t.kcal > goal ? "เกินเป้า 🔺" : "อยู่ในเป้า 💗"}</div></button><div class="k">${fmt(t.kcal)} kcal</div></li>`;
    }).join("") : `<div class="empty"><div class="empty-emoji">📊</div><p>ยังไม่มีประวัติ</p></div>`;
  }
  $("#dayList").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-day]");
    if (!b) return;
    currentDate = b.dataset.day;
    renderToday();
    showView("today");
  });

  // ---------- Settings ----------
  function fillSettings() {
    $("#apiKey").value = settings.apiKey || "";
    $("#model").value = settings.model;
    $("#goal").value = settings.goal;
    markPreset();
  }
  function markPreset() {
    document.querySelectorAll(".chip[data-goal]").forEach((c) => c.classList.toggle("active", Number(c.dataset.goal) === Number($("#goal").value)));
  }
  function persistSettings() {
    const g = Math.round(Number($("#goal").value));
    settings = {
      apiKey: $("#apiKey").value.trim(),
      model: $("#model").value,
      goal: g >= 500 && g <= 6000 ? g : settings.goal,
    };
    save(KEY_SETTINGS, settings);
    renderToday();
  }
  $("#saveSettings").addEventListener("click", () => { persistSettings(); toast("บันทึกการตั้งค่าแล้ว ✨"); });
  $("#toggleKey").addEventListener("click", () => {
    const i = $("#apiKey");
    i.type = i.type === "password" ? "text" : "password";
    $("#toggleKey").textContent = i.type === "password" ? "แสดง" : "ซ่อน";
  });
  $("#goal").addEventListener("change", () => { persistSettings(); markPreset(); toast(`ตั้งเป้า ${fmt(settings.goal)} kcal แล้ว 🎯`); });
  document.querySelectorAll(".chip[data-goal]").forEach((c) => c.addEventListener("click", () => {
    $("#goal").value = c.dataset.goal;
    persistSettings(); markPreset();
    toast(`ตั้งเป้า ${fmt(settings.goal)} kcal แล้ว 🎯`);
  }));
  $("#testKey").addEventListener("click", async () => {
    persistSettings();
    if (!settings.apiKey) return toast("กรุณาใส่ API key ก่อนนะ");
    const btn = $("#testKey");
    btn.disabled = true; btn.textContent = "กำลังทดสอบ…";
    try {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${settings.apiKey}` } });
      toast(r.ok ? "คีย์ใช้งานได้ 🎉" : r.status === 401 ? "คีย์ไม่ถูกต้อง 😢" : `เกิดข้อผิดพลาด (${r.status})`);
    } catch { toast("เชื่อมต่อไม่ได้ ลองตรวจอินเทอร์เน็ตนะ"); }
    btn.disabled = false; btn.textContent = "ทดสอบคีย์";
  });
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lamerfood-${dateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!confirm("ล้างบันทึกอาหารทั้งหมด? (ลบแล้วกู้คืนไม่ได้)")) return;
    entries = {};
    save(KEY_ENTRIES, entries);
    renderToday(); renderHistory();
    toast("ล้างข้อมูลแล้ว");
  });

  // ---------- Sheet ----------
  const sheet = $("#sheet"), backdrop = $("#sheetBackdrop"), body = $("#sheetBody");
  let busy = false;
  function openSheet(html) { body.innerHTML = html; sheet.classList.add("show"); backdrop.classList.add("show"); sheet.scrollTop = 0; }
  function closeSheet() { if (busy) return; sheet.classList.remove("show"); backdrop.classList.remove("show"); draft = null; }
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  // ---------- Image handling ----------
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res(img); URL.revokeObjectURL(url); };
      img.onerror = () => { rej(new Error("อ่านรูปไม่ได้")); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }
  function resize(img, maxSide, quality, square = false) {
    let w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (square) {
      const s = Math.min(w, h);
      c.width = c.height = maxSide;
      ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, maxSide, maxSide);
    } else {
      const scale = Math.min(1, maxSide / Math.max(w, h));
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      ctx.drawImage(img, 0, 0, c.width, c.height);
    }
    return c.toDataURL("image/jpeg", quality);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!settings.apiKey) {
      toast("ใส่ OpenAI API key ในหน้าตั้งค่าก่อนนะ 🔑");
      showView("settings");
      setTimeout(() => $("#apiKey").focus(), 300);
      return;
    }
    let img;
    try { img = await loadImage(file); } catch (e) { return toast(e.message); }
    const full = resize(img, 1024, 0.82);
    const thumb = resize(img, 160, 0.7, true);

    busy = true;
    const phrases = ["กำลังดูว่าเป็นเมนูอะไร", "กำลังนับแคลอรี่", "กำลังคำนวณสารอาหาร", "ใกล้เสร็จแล้วน้า"];
    openSheet(`<div class="analyzing"><img class="preview-img" src="${full}" alt=""><div class="scan"></div></div>
      <div class="loading-text"><span id="loadPhrase">${phrases[0]}</span><span class="dots"><span></span><span></span><span></span></span></div>
      <p class="sub" style="text-align:center">ChatGPT กำลังวิเคราะห์รูปของคุณ 🍓</p>`);
    let pi = 0;
    const iv = setInterval(() => { const el = $("#loadPhrase"); if (el) el.textContent = phrases[++pi % phrases.length]; }, 1800);

    try {
      const result = await analyzeFood(full);
      clearInterval(iv); busy = false;
      if (!result.is_food || !result.items?.length) {
        openSheet(`<div class="err-box"><div class="e">🤔</div><h3>ไม่พบอาหารในรูป</h3><p>${esc(result.note || "ลองถ่ายให้เห็นจานอาหารชัดๆ อีกครั้งนะ")}</p>
          <div class="btn-row"><button class="primary-btn" id="retryBtn">ถ่ายใหม่</button><button class="ghost-btn" id="manualFromErr">ใส่เอง</button></div></div>`);
        $("#retryBtn").onclick = () => { closeSheet(); $("#fileInput").click(); };
        $("#manualFromErr").onclick = () => openEditor(newDraft([blankItem()], thumb));
        return;
      }
      const items = result.items.map((i) => ({
        name: i.name, portion: i.portion, calories: Math.round(i.calories),
        p: i.protein_g, c: i.carbs_g, f: i.fat_g, base: Math.round(i.calories) || 1,
      }));
      const d = newDraft(items, thumb);
      d.note = result.note;
      d.preview = full;
      openEditor(d);
    } catch (err) {
      clearInterval(iv); busy = false;
      openSheet(`<div class="err-box"><div class="e">😢</div><h3>วิเคราะห์ไม่สำเร็จ</h3><p>${esc(err.message)}</p>
        <div class="btn-row"><button class="primary-btn" id="retryBtn">ลองอีกครั้ง</button><button class="ghost-btn" id="manualFromErr">ใส่เอง</button></div></div>`);
      $("#retryBtn").onclick = () => handleFile(file);
      $("#manualFromErr").onclick = () => openEditor(newDraft([blankItem()], thumb));
    }
  }

  // ---------- OpenAI ----------
  const SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["is_food", "items", "total_calories", "note"],
    properties: {
      is_food: { type: "boolean" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g"],
          properties: {
            name: { type: "string", description: "ชื่อเมนูภาษาไทย" },
            portion: { type: "string", description: "ปริมาณโดยประมาณ เช่น 1 จาน (350 ก.)" },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
          },
        },
      },
      total_calories: { type: "number" },
      note: { type: "string", description: "คำแนะนำสั้นๆ ภาษาไทย 1 ประโยค" },
    },
  };

  async function analyzeFood(dataUrl) {
    let r;
    try {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.2,
          response_format: { type: "json_schema", json_schema: { name: "food_analysis", strict: true, schema: SCHEMA } },
          messages: [
            {
              role: "system",
              content: "คุณเป็นนักโภชนาการผู้เชี่ยวชาญอาหารไทยและอาหารสากล วิเคราะห์รูปอาหาร ระบุแต่ละเมนู/ส่วนประกอบหลักที่เห็น ประมาณปริมาณจากขนาดภาชนะ และประมาณแคลอรี่ โปรตีน คาร์บ ไขมัน อย่างสมจริง ตอบชื่อเมนูเป็นภาษาไทย ถ้าในรูปไม่มีอาหารหรือเครื่องดื่ม ให้ is_food=false และ items เป็นอาร์เรย์ว่าง",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "ช่วยบอกว่าในรูปนี้มีอาหารอะไรบ้าง และแต่ละอย่างกี่แคลอรี่" },
                { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
              ],
            },
          ],
        }),
      });
    } catch {
      throw new Error("เชื่อมต่อ OpenAI ไม่ได้ ลองตรวจอินเทอร์เน็ตนะ");
    }
    if (!r.ok) {
      let msg = "", code = "";
      try { const e = (await r.json())?.error || {}; msg = e.message || ""; code = e.code || e.type || ""; } catch {}
      if (r.status === 401) throw new Error("API key ไม่ถูกต้อง ลองตรวจในหน้าตั้งค่านะ");
      if (r.status === 429 && (code === "insufficient_quota" || /quota|billing/i.test(msg)))
        throw new Error("บัญชี OpenAI ไม่มีเครดิต API เหลือ — เติมเงินที่ platform.openai.com → Settings → Billing (แยกจาก ChatGPT Plus) แล้วลองใหม่");
      if (r.status === 429) throw new Error("เรียกถี่เกินไป รอสักครู่แล้วลองใหม่นะ");
      throw new Error(`OpenAI ตอบกลับผิดพลาด (${r.status}) ${msg}`);
    }
    const data = await r.json();
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal) throw new Error(msg.refusal);
    try { return JSON.parse(msg.content); }
    catch { throw new Error("อ่านผลลัพธ์จาก AI ไม่ได้ ลองใหม่อีกครั้งนะ"); }
  }

  // ---------- Editor ----------
  function blankItem() { return { name: "", portion: "", calories: 0, p: 0, c: 0, f: 0, base: 0 }; }
  function newDraft(items, thumb = null) {
    const now = new Date();
    return { id: null, date: currentDate, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, meal: mealByTime(now), thumb, items, note: "" };
  }
  function draftTotal() { return draft.items.reduce((s, i) => s + (Number(i.calories) || 0), 0); }

  function openEditor(d, { editing = false } = {}) {
    draft = d;
    draft.editing = editing;
    const title = editing ? "แก้ไขรายการ" : d.preview ? "เจอแล้ว! 🎉" : "เพิ่มรายการเอง";
    openSheet(`
      ${d.preview ? `<img class="preview-img" src="${d.preview}" alt="">` : ""}
      <h3>${title}</h3>
      <p class="sub">${d.preview ? "ตรวจสอบและแก้ไขชื่อเมนูหรือแคลอรี่ได้ก่อนบันทึก" : "ใส่ชื่อเมนูและแคลอรี่"}</p>
      <div class="total-banner"><span>รวมทั้งหมด</span><div><b id="draftTotal">${fmt(draftTotal())}</b> <span>kcal</span></div></div>
      <div id="itemsBox"></div>
      <button class="add-item" id="addItem">+ เพิ่มอีกอย่าง</button>
      ${d.note ? `<p class="note">💡 ${esc(d.note)}</p>` : ""}
      <p class="label-sm">มื้อ</p>
      <div class="meal-pick">${Object.entries(MEALS).map(([k, m]) => `<button data-meal="${k}" class="${k === d.meal ? "active" : ""}"><span class="e">${m.emoji}</span>${m.label}</button>`).join("")}</div>
      <label class="field"><span>เวลา</span><input type="time" id="draftTime" value="${esc(d.time)}" style="width:100%;padding:12px 14px;border-radius:14px;border:1.5px solid var(--border);background:var(--card-solid)"></label>
      <div class="btn-row"><button class="primary-btn" id="saveDraft">💗 บันทึก</button><button class="ghost-btn" id="cancelDraft">ยกเลิก</button></div>
    `);
    renderItems();

    $("#addItem").onclick = () => { draft.items.push(blankItem()); renderItems(); const ins = $("#itemsBox").querySelectorAll(".name-in"); ins[ins.length - 1]?.focus(); };
    body.querySelectorAll("[data-meal]").forEach((b) => b.onclick = () => {
      draft.meal = b.dataset.meal;
      body.querySelectorAll("[data-meal]").forEach((x) => x.classList.toggle("active", x === b));
    });
    $("#draftTime").oninput = (e) => { draft.time = e.target.value; };
    $("#cancelDraft").onclick = closeSheet;
    $("#saveDraft").onclick = commitDraft;
  }

  function renderItems() {
    const box = $("#itemsBox");
    box.innerHTML = draft.items.map((it, i) => `
      <div class="item-edit" data-i="${i}">
        <input type="text" class="name-in" placeholder="ชื่อเมนู เช่น ข้าวมันไก่" value="${esc(it.name)}">
        <div class="kcal-in"><input type="number" class="kcal" inputmode="numeric" min="0" value="${it.calories || ""}" placeholder="0"></div>
        <button class="mini-btn rm" aria-label="ลบ"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        ${it.portion || it.p ? `<div class="portion">${it.portion ? esc(it.portion) + " · " : ""}P ${fmt(it.p)}g · C ${fmt(it.c)}g · F ${fmt(it.f)}g</div>` : ""}
      </div>`).join("");
    box.querySelectorAll(".item-edit").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector(".name-in").oninput = (e) => { draft.items[i].name = e.target.value; };
      row.querySelector(".kcal").oninput = (e) => { draft.items[i].calories = Math.max(0, Number(e.target.value) || 0); $("#draftTotal").textContent = fmt(draftTotal()); };
      row.querySelector(".rm").onclick = () => {
        draft.items.splice(i, 1);
        if (!draft.items.length) draft.items.push(blankItem());
        renderItems();
        $("#draftTotal").textContent = fmt(draftTotal());
      };
    });
  }

  function commitDraft() {
    const items = draft.items
      .map((i) => ({ ...i, name: i.name.trim(), calories: Math.round(Number(i.calories) || 0) }))
      .filter((i) => i.name || i.calories);
    if (!items.length) return toast("ใส่ชื่อเมนูหรือแคลอรี่อย่างน้อย 1 อย่างนะ");
    // Scale macros if calories were edited relative to AI estimate
    items.forEach((i) => {
      if (!i.name) i.name = "อาหาร";
      if (i.base > 0 && i.calories !== i.base) {
        const k = i.calories / i.base;
        i.p = i.p * k; i.c = i.c * k; i.f = i.f * k; i.base = i.calories;
      }
    });
    const entry = {
      id: draft.id || uid(),
      time: draft.time || "12:00",
      meal: draft.meal,
      thumb: draft.thumb,
      items,
      total: items.reduce((s, i) => s + i.calories, 0),
      macros: items.reduce((m, i) => ({ p: m.p + (i.p || 0), c: m.c + (i.c || 0), f: m.f + (i.f || 0) }), { p: 0, c: 0, f: 0 }),
    };
    const k = draft.date;
    const list = (entries[k] || []).filter((x) => x.id !== entry.id);
    list.push(entry);
    entries[k] = list;
    if (!save(KEY_ENTRIES, entries)) {
      entry.thumb = null; // storage full — retry without the photo
      if (!save(KEY_ENTRIES, entries)) { toast("พื้นที่เก็บข้อมูลเต็ม บันทึกไม่ได้ 😢"); return; }
      toast("พื้นที่เต็ม จึงบันทึกโดยไม่เก็บรูปนะ");
    }
    const wasEditing = draft.editing;
    closeSheet();
    currentDate = k;
    renderToday();
    showView("today");
    if (!wasEditing) { hearts(); toast(`บันทึกแล้ว +${fmt(entry.total)} kcal 💗`); }
    else toast("อัปเดตแล้ว ✨");
  }

  // ---------- Inputs ----------
  $("#fab").addEventListener("click", () => $("#fileInput").click());
  $("#navCamera").addEventListener("click", () => $("#galleryInput").click());
  $("#fileInput").addEventListener("change", (e) => { handleFile(e.target.files[0]); e.target.value = ""; });
  $("#galleryInput").addEventListener("change", (e) => { handleFile(e.target.files[0]); e.target.value = ""; });
  $("#manualAddBtn").addEventListener("click", () => openEditor(newDraft([blankItem()])));

  // ---------- Init ----------
  (function greet() {
    const h = new Date().getHours();
    $("#greeting").textContent = h < 11 ? "อรุณสวัสดิ์ค่ะ ☀️ เช้านี้กินอะไรดี" : h < 15 ? "สวัสดีตอนกลางวันค่ะ 🌸" : h < 19 ? "สวัสดีตอนบ่ายค่ะ 🍵" : "สวัสดีตอนค่ำค่ะ 🌙";
  })();
  renderToday();
})();
