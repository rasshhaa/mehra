/**
 * MEHRA — Audit / missing-feature hub screens (stakeholder connectivity + AI via Groq /mehra-bot)
 * Loaded after index.html main script; uses window.API, toast, _fbDb helpers.
 */
(function () {
  if (window.__MEHRA_HUBS__) return;
  window.__MEHRA_HUBS__ = true;

  function mehraApiBase() {
    if (typeof window !== "undefined" && window.API) return window.API;
    if (typeof window !== "undefined" && window.location)
      return window.location.origin;
    return "";
  }

  async function mehraBotAsk(userText) {
    if (!userText || !String(userText).trim()) return "";
    const res = await fetch(`${mehraApiBase()}/mehra-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: String(userText).trim() }],
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.detail || "Mehra bot failed");
    }
    const data = await res.json();
    return data.reply || "";
  }
  window.mehraBotAsk = mehraBotAsk;

  /* ── Owner hub ── */
  function _hubCard(title, id, bodyHtml) {
    return `<div class="mehra-hub-card" id="${id}"><h3>${title}</h3>${bodyHtml}</div>`;
  }

  async function mehraResolveHubPlate() {
    const act = (localStorage.getItem("mehra_active_plate") || "").trim();
    if (act) return { plate: act, source: "saved" };
    const uid = window._currentUser?.uid;
    if (!uid) return { plate: "", source: "none" };
    try {
      const m = await window._fsGetDoc(
        window._fsDoc(window._fbDb, "users", uid, "profile", "mulkiya")
      );
      if (m && m.exists()) {
        const p = (m.data().plateNumber || "").trim();
        return { plate: p, source: "mulkiya" };
      }
    } catch (e) {}
    return { plate: "", source: "none" };
  }
  window.mehraResolveHubPlate = mehraResolveHubPlate;

  window.initOwnerHub = async function initOwnerHub() {
    const root = document.getElementById("ownerHubMount");
    if (!root) return;
    const uid = window._currentUser?.uid;
    const hubPl = await mehraResolveHubPlate();
    let plate = hubPl.plate || "—",
      make = "—",
      year = "—";
    if (uid) {
      try {
        const m = await window._fsGetDoc(
          window._fsDoc(window._fbDb, "users", uid, "profile", "mulkiya")
        );
        if (m && m.exists()) {
          const d = m.data();
          make = d.make || d.bodyType || make;
          year = d.year || year;
        }
      } catch (e) {}
    }
    const plLabel =
      hubPl.source === "saved"
        ? `Active saved plate: <strong>${hubPl.plate}</strong> (fines + driving score use this) <button type="button" class="btn btn-sm" onclick="mehraClearActivePlate()">Use profile plate</button>`
        : `Profile plate: <strong>${plate}</strong>`;
    const reminders = JSON.parse(
      localStorage.getItem("mehra_owner_maint") || "[]"
    );
    const remHtml =
      reminders.length > 0
        ? reminders
            .map(
              (r, i) =>
                `<div class="mehra-hub-row"><span>${r.label}</span><span>${r.due}</span><button type="button" class="btn btn-sm" onclick="mehraRemoveMaint(${i})">✕</button></div>`
            )
            .join("")
        : '<p class="mehra-hub-note">No reminders yet. Add one below.</p>';
    root.innerHTML = `
      ${_hubCard("AI maintenance scheduler", "oh-maint", `<p class="mehra-hub-note">Predictive reminders based on your vehicle profile. Stored locally for quick access.</p>
        <div class="mehra-hub-row"><label>Service type</label><input id="ohMaintLabel" placeholder="e.g. Oil + filter"></div>
        <div class="mehra-hub-row"><label>Due (date)</label><input type="date" id="ohMaintDue"></div>
        <button type="button" class="btn btn-primary" onclick="mehraAddMaintReminder()">Add reminder</button>
        <div class="mehra-hub-list">${remHtml}</div>
        <button type="button" class="btn" onclick="mehraAskMaintAI()">Ask AI: prioritise my maintenance</button>
        <pre class="mehra-hub-out" id="ohMaintAiOut"></pre>`)}
      ${_hubCard("RTA fines &amp; live payment (MEHRA demo gateway)", "oh-fine", `<p class="mehra-hub-note">Lists fines from <code>rtaFines</code>. <strong>Pay in MEHRA</strong> runs a demo gateway (server updates status + transaction id). You can also pay via your emirate&rsquo;s official portal.</p>
        <p class="mehra-plate-line">${plLabel}</p>
        <button type="button" class="btn btn-primary" onclick="mehraLoadOwnerFines()">Load / refresh fines</button>
        <div id="ohFinesList" class="mehra-hub-list">—</div>`)}
      ${_hubCard("Vehicle comparison", "oh-cmp", `<p class="mehra-hub-note">Compare two vehicles (plate + key facts).</p>
        <div class="mehra-hub-row2"><input id="ohP1" placeholder="Plate A"><input id="ohP2" placeholder="Plate B"></div>
        <button type="button" class="btn btn-primary" onclick="mehraCompareVehicles()">Compare</button>
        <div id="ohCmpOut" class="mehra-hub-out"></div>`)}
      ${_hubCard("AI resale price estimator", "oh-resale", `<p class="mehra-hub-note">Groq estimate from vehicle summary (indicative only).</p>
        <p><strong>Current profile:</strong> ${make} ${year} · ${plate}</p>
        <div class="mehra-hub-row"><label>Mileage (km)</label><input type="number" id="ohKm" placeholder="45000"></div>
        <button type="button" class="btn btn-primary" onclick="mehraResaleAI()">Estimate resale (AED)</button>
        <pre class="mehra-hub-out" id="ohResaleOut"></pre>`)}
      ${_hubCard("Multi-vehicle switcher (saved)", "oh-multi", `<p class="mehra-hub-note">Save alternate plate labels for quick switching in MEHRA flows.</p>
        <div class="mehra-hub-row"><input id="ohAltPlate" placeholder="Dubai B 12345"></div>
        <button type="button" class="btn btn-primary" onclick="mehraSaveAltVehicle()">Save alternate plate</button>
        <div id="ohAltList" class="mehra-hub-list"></div>`)}
      ${_hubCard("Insurance renewal assistant", "oh-ins", `<p class="mehra-hub-note">AI checklist before renewal; connect broker separately.</p>
        <button type="button" class="btn btn-primary" onclick="mehraInsRenewalAI()">Generate renewal checklist</button>
        <pre class="mehra-hub-out" id="ohInsOut"></pre>`)}
      ${_hubCard("AI driving behaviour score (indicative)", "oh-drive", `<p class="mehra-hub-note">Blends RTA fine history + claims in MEHRA (not telematics).</p>
        <button type="button" class="btn btn-primary" onclick="mehraDrivingScoreAI()">Estimate risk score</button>
        <pre class="mehra-hub-out" id="ohDriveOut"></pre>`)}
    `;
    mehraRenderAltVehicles();
  };

  window.mhraSetMaintOut = (el, text) => {
    const o = document.getElementById(el);
    if (o) o.textContent = text;
  };
  window.mehraAddMaintReminder = function () {
    const label = (document.getElementById("ohMaintLabel")?.value || "").trim();
    const due = document.getElementById("ohMaintDue")?.value || "";
    if (!label || !due) return toast("Add label and date", "error");
    const arr = JSON.parse(localStorage.getItem("mehra_owner_maint") || "[]");
    arr.push({ label, due });
    localStorage.setItem("mehra_owner_maint", JSON.stringify(arr));
    toast("Reminder saved", "success");
    initOwnerHub();
  };
  window.mehraRemoveMaint = function (idx) {
    const arr = JSON.parse(localStorage.getItem("mehra_owner_maint") || "[]");
    arr.splice(idx, 1);
    localStorage.setItem("mehra_owner_maint", JSON.stringify(arr));
    initOwnerHub();
  };
  window.mehraAskMaintAI = async function () {
    const el = document.getElementById("ohMaintAiOut");
    if (el) el.textContent = "Asking Mehra bot…";
    const uid = window._currentUser?.uid;
    let prof = "Unknown vehicle";
    if (uid) {
      const m = await window._fsGetDoc(
        window._fsDoc(window._fbDb, "users", uid, "profile", "mulkiya")
      ).catch(() => null);
      if (m && m.exists()) prof = JSON.stringify(m.data());
    }
    const reminders = JSON.parse(
      localStorage.getItem("mehra_owner_maint") || "[]"
    );
    try {
      const r = await mehraBotAsk(
        `You are a UAE vehicle maintenance assistant. Vehicle profile: ${prof}. Upcoming user reminders: ${JSON.stringify(
          reminders
        )}. Reply with: (1) top 3 priority actions, (2) what to do this month, (3) what can wait. Short bullets, no markdown headings.`
      );
      if (el) el.textContent = r;
    } catch (e) {
      if (el) el.textContent = e.message;
    }
  };
  function mehraEsc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  window.mehraClosePayOverlay = function () {
    const el = document.getElementById("mehraPayOverlay");
    if (el) el.remove();
  };

  /** Demo gateway: POST /pay-rta-fine (Firebase Admin updates fine). */
  window.mehraPayRtaFine = function (fineId, amount, plate) {
    window.mehraClosePayOverlay();
    const uid = window._currentUser?.uid || "";
    const wrap = document.createElement("div");
    wrap.id = "mehraPayOverlay";
    wrap.className = "mehra-pay-overlay";
    wrap.innerHTML = `
      <div class="mehra-pay-modal" role="dialog" aria-modal="true" aria-labelledby="mehraPayTitle">
        <h4 id="mehraPayTitle">Pay fine (MEHRA demo)</h4>
        <p class="mehra-hub-note">Amount <strong>AED ${mehraEsc(amount)}</strong> · Plate <strong>${mehraEsc(plate)}</strong></p>
        <p class="mehra-hub-note">This simulates a card checkout. No real charge — the server records <code>paid</code> + a transaction id in Firestore.</p>
        <label class="mehra-pay-label">Cardholder name <input type="text" id="mehraPayName" placeholder="As on card" autocomplete="name"></label>
        <label class="mehra-pay-label">Last 4 digits <input type="text" id="mehraPayLast4" maxlength="4" inputmode="numeric" placeholder="4242"></label>
        <label class="mehra-pay-check"><input type="checkbox" id="mehraPayAgree" checked> I authorise this demo payment for the amount shown.</label>
        <div class="mehra-pay-actions">
          <button type="button" class="btn" onclick="mehraClosePayOverlay()">Cancel</button>
          <button type="button" class="btn btn-primary" onclick="mehraConfirmFinePay(${JSON.stringify(fineId)}, ${JSON.stringify(plate)}, ${JSON.stringify(uid)})">Pay now</button>
        </div>
      </div>`;
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) window.mehraClosePayOverlay();
    });
    document.body.appendChild(wrap);
  };

  window.mehraConfirmFinePay = async function (fineId, plate, ownerUid) {
    const agree = document.getElementById("mehraPayAgree");
    if (agree && !agree.checked) {
      toast("Confirm the authorisation checkbox", "error");
      return;
    }
    const base = mehraApiBase();
    try {
      const res = await fetch(`${base}/pay-rta-fine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fine_id: fineId,
          payer_role: "owner",
          plate: plate,
          owner_uid: ownerUid || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || res.statusText);
      window.mehraClosePayOverlay();
      toast(`Paid — ref ${j.transaction_id || ""}`, "success");
      await window.mehraLoadOwnerFines();
      if (typeof window.renderRtaFines === "function") window.renderRtaFines();
    } catch (e) {
      toast(e.message || "Payment failed", "error");
    }
  };

  window.mehraLoadOwnerFines = async function () {
    const out = document.getElementById("ohFinesList");
    if (!out) return;
    out.textContent = "Loading…";
    const hub = await mehraResolveHubPlate();
    const plate = hub.plate || "";
    if (!plate) {
      out.innerHTML =
        "<p>Save Mulkiya in profile with a plate, or set an <strong>active</strong> saved plate in Multi-vehicle switcher.</p>";
      return;
    }
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "rtaFines")
      );
      const pn = String(plate).replace(/\s/g, "").toLowerCase();
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (f) =>
            String(f.plate || "")
              .replace(/\s/g, "")
              .toLowerCase() === pn
        );
      if (!rows.length) {
        out.innerHTML = "<p>No RTA fines found for this plate in MEHRA data.</p>";
        return;
      }
      out.innerHTML = rows
        .map((f) => {
          const paid = (f.status || "").toLowerCase() === "paid";
          const payBtn = paid
            ? `<span class="mehra-paid-pill">Paid${f.transactionId ? " · " + mehraEsc(f.transactionId) : ""}</span>`
            : `<button type="button" class="btn btn-primary btn-sm" onclick="mehraPayRtaFine(${JSON.stringify(f.id)}, ${Number(f.amount) || 0}, ${JSON.stringify(plate)})">Pay in MEHRA (demo)</button>`;
          return `<div class="mehra-fine-line">
            <div><strong>${mehraEsc(f.violation || "Fine")}</strong><br><span class="mehra-hub-note">AED ${Number(f.amount) || 0} · ${mehraEsc(f.status || "active")}</span></div>
            <div class="mehra-fine-actions">${payBtn}</div>
          </div>`;
        })
        .join("");
    } catch (e) {
      out.textContent = "Could not load fines.";
    }
  };
  window.mehraCompareVehicles = async function () {
    const p1 = (document.getElementById("ohP1")?.value || "").trim();
    const p2 = (document.getElementById("ohP2")?.value || "").trim();
    const out = document.getElementById("ohCmpOut");
    if (!p1 || !p2) return toast("Enter two plates", "error");
    if (out) out.textContent = "Comparing…";
    try {
      const users = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "users")
      );
      const findPlate = async (pNorm) => {
        for (const u of users.docs) {
          const m = await window._fsGetDoc(
            window._fsDoc(
              window._fbDb,
              "users",
              u.id,
              "profile",
              "mulkiya"
            )
          ).catch(() => null);
          if (!m || !m.exists()) continue;
          const d = m.data();
          if (
            String(d.plateNumber || "")
              .replace(/\s/g, "")
              .toLowerCase() === pNorm
          ) {
            return d;
          }
        }
        return null;
      };
      const n1 = p1.replace(/\s/g, "").toLowerCase();
      const n2 = p2.replace(/\s/g, "").toLowerCase();
      const a = await findPlate(n1);
      const b = await findPlate(n2);
      const line = (d, name) =>
        d
          ? `${name}: ${d.make || "—"} ${d.bodyType || ""} ${d.year || ""} · insurance ${d.insuranceCompany || "—"} · exp ${d.registrationExpiry || "—"}`
          : `${name}: (not found in MEHRA profiles)`;
      if (out)
        out.textContent = `${line(a, "A")}\n${line(
          b,
          "B"
        )}\n\nTip: both vehicles use the same Mulkiya store — unified verification across stakeholders.`;
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };
  window.mehraResaleAI = async function () {
    const km = document.getElementById("ohKm")?.value || "";
    const out = document.getElementById("ohResaleOut");
    if (out) out.textContent = "Estimating…";
    const uid = window._currentUser?.uid;
    let prof = "";
    if (uid) {
      const m = await window._fsGetDoc(
        window._fsDoc(window._fbDb, "users", uid, "profile", "mulkiya")
      ).catch(() => null);
      if (m && m.exists()) prof = JSON.stringify(m.data());
    }
    try {
      const r = await mehraBotAsk(
        `You are a UAE used-car pricing assistant. Vehicle: ${prof}. Mileage km: ${km}. Give a realistic AED range for private sale in current UAE market, 5 bullet factors, 1 line disclaimer. Plain text, no # headings.`
      );
      if (out) out.textContent = r;
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };
  function mehraRenderAltVehicles() {
    const el = document.getElementById("ohAltList");
    if (!el) return;
    const raw = localStorage.getItem("mehra_alt_plates");
    const arr = raw ? JSON.parse(raw) : [];
    const active = (localStorage.getItem("mehra_active_plate") || "").trim();
    if (!arr.length) {
      el.innerHTML = "<p>No extra plates saved.</p>";
      return;
    }
    el.innerHTML = arr
      .map(
        (p, i) =>
          `<div class="mehra-hub-row"><span>${mehraEsc(p)}${active && active === p.trim() ? " <em>(active)</em>" : ""}</span>
          <button type="button" class="btn btn-sm" onclick="mehraSetActivePlateByIndex(${i})">Set active</button>
          <button type="button" class="btn btn-sm" onclick="mehraRemoveAlt(${i})">remove</button></div>`
      )
      .join("");
  }
  window.mehraSetActivePlateByIndex = function (i) {
    const arr = JSON.parse(localStorage.getItem("mehra_alt_plates") || "[]");
    const p = arr[i];
    if (!p) return;
    localStorage.setItem("mehra_active_plate", String(p).trim());
    toast("Active vehicle plate set — fines & driving score use this", "success");
    initOwnerHub();
  };
  window.mehraClearActivePlate = function () {
    localStorage.removeItem("mehra_active_plate");
    toast("Using profile Mulkiya plate", "success");
    initOwnerHub();
  };
  window.mehraSaveAltVehicle = function () {
    const v = (document.getElementById("ohAltPlate")?.value || "").trim();
    if (!v) return;
    const arr = JSON.parse(localStorage.getItem("mehra_alt_plates") || "[]");
    if (!arr.includes(v)) arr.push(v);
    localStorage.setItem("mehra_alt_plates", JSON.stringify(arr));
    toast("Saved", "success");
    mehraRenderAltVehicles();
  };
  window.mehraRemoveAlt = function (i) {
    const arr = JSON.parse(localStorage.getItem("mehra_alt_plates") || "[]");
    arr.splice(i, 1);
    localStorage.setItem("mehra_alt_plates", JSON.stringify(arr));
    mehraRenderAltVehicles();
  };
  window.mehraDrivingScoreAI = async function () {
    const out = document.getElementById("ohDriveOut");
    if (out) out.textContent = "Analysing…";
    const uid = window._currentUser?.uid;
    const hub = await mehraResolveHubPlate();
    let plate = hub.plate || "";
    let fineCount = 0;
    let claimCount = 0;
    try {
      if (plate) {
        const fs = await window._fsGetDocs(
          window._fsCollection(window._fbDb, "rtaFines")
        );
        const pn = String(plate).replace(/\s/g, "").toLowerCase();
        fineCount = fs.docs.filter(
          (d) =>
            String(d.data().plate || "")
              .replace(/\s/g, "")
              .toLowerCase() === pn
        ).length;
      }
      if (uid) {
        const cs = await window._fsGetDocs(
          window._fsCollection(window._fbDb, "insuranceClaims")
        );
        claimCount = cs.docs.filter(
          (d) => d.data().ownerId === uid
        ).length;
      }
    } catch (e) {
      if (out) out.textContent = e.message;
      return;
    }
    try {
      out.textContent = await mehraBotAsk(
        `UAE driver risk (not telematics). Plate ${plate || "unknown"}: ${fineCount} RTA fine row(s) in MEHRA, ${claimCount} owner claim(s). Reply with: (1) indicative score 0-100 where 100 is best, (2) 3 habits to improve, (3) one disclaimer. Plain text, short.`
      );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsRenewalAI = async function () {
    const out = document.getElementById("ohInsOut");
    if (out) out.textContent = "Thinking…";
    const uid = window._currentUser?.uid;
    let prof = "unknown";
    if (uid) {
      const m = await window._fsGetDoc(
        window._fsDoc(window._fbDb, "users", uid, "profile", "mulkiya")
      ).catch(() => null);
      if (m && m.exists()) prof = JSON.stringify(m.data());
    }
    try {
      const r = await mehraBotAsk(
        `UAE insurance renewal. Vehicle profile: ${prof}. Produce: checklist (docs, NCD, prior claims), typical pitfalls, when to start renewal before expiry. Short bullets, plain text.`
      );
      if (out) out.textContent = r;
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  /* ── Garage hub ── */
  async function mehraGarageProfileName() {
    const uid = window._currentUser?.uid;
    if (!uid) return "";
    try {
      const d = await window._fsGetDoc(
        window._fsDoc(window._fbDb, "users", uid, "profile", "garage")
      );
      if (d && d.exists()) {
        const g = d.data();
        return (g.name || g.garage?.name || "").trim();
      }
    } catch (e) {}
    return (document.getElementById("garageName")?.value || "").trim();
  }
  window.mehraGarageProfileName = mehraGarageProfileName;

  window.initGarageHub = function initGarageHub() {
    const g = document.getElementById("garageHubMount");
    if (!g) return;
    if (window._ghRevUnsub) {
      try {
        window._ghRevUnsub();
      } catch (e) {}
      window._ghRevUnsub = null;
    }
    if (window._ghChatUnsub) {
      try {
        window._ghChatUnsub();
      } catch (e) {}
      window._ghChatUnsub = null;
    }
    g.innerHTML = `
      ${_hubCard("AI repair cost estimator", "gh-cost", `<p class="mehra-hub-note">Rough labour + parts <strong>AED</strong> band from job text (indicative — not a binding quote).</p>
        <textarea id="ghJob" rows="3" placeholder="e.g. Front bumper + headlamp + paint"></textarea>
        <button type="button" class="btn btn-primary" onclick="mehraGarageCostAI()">Run estimate</button>
        <pre class="mehra-hub-out" id="ghCostOut"></pre>`)}
      ${_hubCard("Parts inventory AI suggest", "gh-parts", `<p class="mehra-hub-note">Fast-moving stock to hold for your lane.</p>
        <div class="mehra-hub-row"><input id="ghVin" placeholder="VIN or make/model" style="width:100%"></div>
        <button type="button" class="btn btn-primary" onclick="mehraGaragePartsAI()">Suggest parts to stock</button>
        <pre class="mehra-hub-out" id="ghPartsOut"></pre>`)}
      ${_hubCard("Bay & slot load (quick)", "gh-bay", `<p class="mehra-hub-note">Count of <code>appointments</code> in MEHRA.</p>
        <button type="button" class="btn btn-primary" onclick="mehraGarageBay()">Load snapshot</button>
        <pre class="mehra-hub-out" id="ghBayOut"></pre>`)}
      ${_hubCard("Bay scheduling optimizer (AI)", "gh-bayopt", `<p class="mehra-hub-note">Uses sample appointment times + bot to suggest staggering / bays.</p>
        <button type="button" class="btn btn-primary" onclick="mehraGarageBayOpt()">Run optimizer</button>
        <pre class="mehra-hub-out" id="ghBayOptOut"></pre>`)}
      ${_hubCard("Real-time garage reviews", "gh-rev", `<p class="mehra-hub-note">Live list from <code>garageReviews</code> for this garage (add demo row if empty).</p>
        <div id="ghReviewsList" class="mehra-gh-reviews">Loading…</div>
        <button type="button" class="btn" onclick="mehraGarageAddDemoReview()">Add demo 5-star review</button>`)}
      ${_hubCard("Revenue analytics", "gh-revrec", `<p class="mehra-hub-note">Aggregates <code>insuranceClaims</code> (approved) + <code>appointments</code> for your garage name where possible.</p>
        <button type="button" class="btn btn-primary" onclick="mehraGarageRevenue()">Load revenue snapshot</button>
        <pre class="mehra-hub-out" id="ghRevOut"></pre>
        <button type="button" class="btn" onclick="mehraGarageRevenueAI()">AI narrative (brief)</button>
        <pre class="mehra-hub-out" id="ghRevAiOut"></pre>`)}
      ${_hubCard("AI defect trend report", "gh-trend", `<p class="mehra-hub-note">Damage themes from network claims, weighted toward this garage if matched.</p>
        <button type="button" class="btn btn-primary" onclick="mehraGarageDefectAI()">Build defect trend</button>
        <pre class="mehra-hub-out" id="ghTrendOut"></pre>`)}
      ${_hubCard("Technician performance (AI)", "gh-tech", `<p class="mehra-hub-note">Team-level coaching ideas (not individual performance scores).</p>
        <button type="button" class="btn btn-primary" onclick="mehraGarageTechAI()">Run technician brief</button>
        <pre class="mehra-hub-out" id="ghTechOut"></pre>`)}
      ${_hubCard("Garage–insurer chat (thread)", "gh-chthread", `<p class="mehra-hub-note">Thread in <code>garageInsurerChat</code> (you, insurer, or AI-simulated insurer).</p>
        <div id="ghInsChatList" class="mehra-gh-chat"></div>
        <div class="mehra-hub-row" style="margin-top:8px"><input type="text" id="ghInsChatIn" placeholder="Message insurer…" style="flex:1" onkeypress="if(event.key==='Enter'){event.preventDefault();mehraGiChatSend();}"></div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-primary" onclick="mehraGiChatSend()">Send</button>
          <button type="button" class="btn" onclick="mehraGiChatSimInsurer()">Simulate insurer reply (AI)</button>
        </div>`)}
      ${_hubCard("Garage–insurer: draft email", "gh-chat", `<p class="mehra-hub-note">Polish a formal email to the insurer (copy off-platform).</p>
        <textarea id="ghInsMsg" rows="2" placeholder="Approved amount / job scope / question…"></textarea>
        <button type="button" class="btn btn-primary" onclick="mehraGarageInsDraft()">Draft with AI</button>
        <pre class="mehra-hub-out" id="ghInsOut"></pre>`)}
    `;
    window.mehraMountGarageReviews();
    window.mehraMountGiChat();
  };
  window.mehraGarageCostAI = async function () {
    const job = document.getElementById("ghJob")?.value || "";
    const o = document.getElementById("ghCostOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `UAE repair workshop. Job: ${job}. Reply with: likely labour hours range, parts categories, and AED cost LOW-MID-HIGH band. No markdown #. Short.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };
  window.mehraGaragePartsAI = async function () {
    const v = document.getElementById("ghVin")?.value || "generic sedan";
    const o = document.getElementById("ghPartsOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `List 8 high-turnover service parts a UAE garage should stock for vehicles like: ${v}. One line per item.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };
  window.mehraGarageBay = async function () {
    const o = document.getElementById("ghBayOut");
    if (o) o.textContent = "Loading…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "appointments")
      );
      const n = snap.size;
      o.textContent = `Open appointments in Firestore: ${n}. Suggestion: if many are pending same morning, stagger 45–60 min or open extra bay for inspection lane. (Connect Tasjeel slot sync separately.)`;
    } catch (e) {
      o.textContent = e.message;
    }
  };

  window.mehraGarageBayOpt = async function () {
    const o = document.getElementById("ghBayOptOut");
    if (o) o.textContent = "Optimising…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "appointments")
      );
      const gname = await mehraGarageProfileName();
      const sample = snap.docs.slice(0, 45).map((d) => {
        const x = d.data() || {};
        return {
          garage: x.garage || x.garageName,
          date: x.date || x.appointmentDate || x.slotDate,
          time: x.time || x.timeSlot || x.startTime,
          status: x.status,
        };
      });
      o.textContent = await mehraBotAsk(
        `You are a UAE service bay scheduler. Our garage name (focus): ${gname || "any"}. Sample appointments JSON: ${JSON.stringify(
          sample
        )}. Reply with: (1) 4 bullet optimisation plan: stagger, bay assignment, buffer minutes, re-inspection lane; (2) risk if we keep current spacing; (3) one KPI to track. Plain text, short.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  function mehraClaimMatchesGarage(c, gname) {
    if (!gname) return true;
    const a = String(c.garageName || c.garage || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const b = gname.toLowerCase().replace(/\s+/g, " ").trim();
    if (!a || !b) return true;
    return a.includes(b) || b.includes(a) || a.replace(/\s/g, "") === b.replace(/\s/g, "");
  }

  window.mehraMountGarageReviews = function () {
    const el = document.getElementById("ghReviewsList");
    if (!el) return;
    const uid = window._currentUser?.uid;
    if (!uid) {
      el.innerHTML = "<p>Sign in as a garage user.</p>";
      return;
    }
    if (window._ghRevUnsub) {
      try {
        window._ghRevUnsub();
      } catch (e) {}
      window._ghRevUnsub = null;
    }
    try {
      const col = window._fsCollection(window._fbDb, "garageReviews");
      const q = window._fsQuery(
        col,
        window._fsWhere("garageId", "==", uid)
      );
      window._ghRevUnsub = window._fsOnSnapshot(
        q,
        (snap) => {
          const rows = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort(
              (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
            );
          if (!rows.length) {
            el.innerHTML =
              "<p class=\"mehra-hub-note\">No reviews yet — add a demo row below.</p>";
            return;
          }
          el.innerHTML = rows
            .map(
              (r) =>
                `<div class="mehra-rev-row"><span class="mehra-rev-stars">★ ${r.rating != null ? r.rating : "—"}</span> <span class="mehra-rev-txt">${mehraEsc(r.text || "")}</span> <span class="mehra-rev-meta">${mehraEsc(r.author || "Customer")} · live</span></div>`
            )
            .join("");
        },
        (err) => {
          el.innerHTML = `<p class="mehra-hub-note">Could not sync reviews. ${mehraEsc(
            err && err.message ? err.message : String(err)
          )}</p>`;
        }
      );
    } catch (e) {
      el.innerHTML = `<p>${mehraEsc(e.message)}</p>`;
    }
  };

  window.mehraGarageAddDemoReview = async function () {
    const uid = window._currentUser?.uid;
    if (!uid) return toast("Sign in as garage", "error");
    try {
      await window._fsAddDoc(
        window._fsCollection(window._fbDb, "garageReviews"),
        {
          garageId: uid,
          rating: 5,
          text: "Great communication and honest estimate — will return.",
          author: "Demo customer",
          createdAt: Date.now(),
        }
      );
      if (typeof toast === "function")
        toast("Demo review added", "success");
    } catch (e) {
      if (typeof toast === "function") toast(e.message, "error");
    }
  };

  let _ghRevOutCache = "";
  window.mehraGarageRevenue = async function () {
    const o = document.getElementById("ghRevOut");
    if (o) o.textContent = "Loading…";
    const gname = await mehraGarageProfileName();
    try {
      const [cSnap, aSnap] = await Promise.all([
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "insuranceClaims")
        ),
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "appointments")
        ),
      ]);
      let claimSum = 0;
      let claimN = 0;
      cSnap.docs.forEach((d) => {
        const c = d.data() || {};
        if (!mehraClaimMatchesGarage(c, gname)) return;
        const st = (c.status || "").toLowerCase();
        if (st === "approved" && c.approvedAmount) {
          claimSum += Number(c.approvedAmount) || 0;
          claimN += 1;
        }
      });
      let apptN = 0;
      aSnap.docs.forEach((d) => {
        const a = d.data() || {};
        if (!gname) {
          apptN += 1;
          return;
        }
        const gn = (a.garage || a.garageName || "").toLowerCase();
        if (gn.includes(gname.toLowerCase().slice(0, 3)) || gname.toLowerCase().includes(gn.slice(0, 3)))
          apptN += 1;
      });
      const text = `Garage: ${gname || "—"}\nApproved claims (matched): ${claimN} · total approved AED: ${claimSum.toFixed(0)}\nAppointment rows loosely matched: ${apptN}\nNote: match uses garage name; tune fields in production.`;
      _ghRevOutCache = text;
      if (o) o.textContent = text;
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraGarageRevenueAI = async function () {
    const o = document.getElementById("ghRevAiOut");
    if (o) o.textContent = "…";
    if (!_ghRevOutCache) await window.mehraGarageRevenue();
    try {
      o.textContent = await mehraBotAsk(
        `Garage revenue snapshot:\n${_ghRevOutCache}\nGive a 5-line COO-style brief: where money comes from, leakage risk, one upsell, one cost control. No markdown #.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMountGiChat = function () {
    const el = document.getElementById("ghInsChatList");
    if (!el) return;
    const uid = window._currentUser?.uid;
    if (!uid) {
      el.innerHTML = "<p>Sign in to use chat.</p>";
      return;
    }
    if (window._ghChatUnsub) {
      try {
        window._ghChatUnsub();
      } catch (e) {}
      window._ghChatUnsub = null;
    }
    try {
      const col = window._fsCollection(window._fbDb, "garageInsurerChat");
      const q = window._fsQuery(
        col,
        window._fsWhere("garageId", "==", uid)
      );
      window._ghChatUnsub = window._fsOnSnapshot(
        q,
        (snap) => {
          const rows = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
          if (!rows.length) {
            el.innerHTML =
              "<p class=\"mehra-hub-note\">No messages yet. Send an update to the insurer.</p>";
            return;
          }
          el.innerHTML = rows
            .map((m) => {
              const ins = (m.side || m.role) === "insurer";
              return `<div class="mehra-gichat ${ins ? "ins" : "grg"}"><span class="mehra-gichat-who">${ins ? "Insurer" : "Garage"}</span>${mehraEsc(
                m.text || ""
              )}</div>`;
            })
            .join("");
          el.scrollTop = el.scrollHeight;
        },
        (err) => {
          el.innerHTML = `<p>${mehraEsc(err.message || err)}</p>`;
        }
      );
    } catch (e) {
      el.innerHTML = `<p>${mehraEsc(e.message)}</p>`;
    }
  };

  window.mehraGiChatSend = async function () {
    const uid = window._currentUser?.uid;
    const inp = document.getElementById("ghInsChatIn");
    const t = (inp && inp.value ? inp.value : "").trim();
    if (!uid || !t) return;
    try {
      await window._fsAddDoc(
        window._fsCollection(window._fbDb, "garageInsurerChat"),
        { garageId: uid, side: "garage", text: t, ts: Date.now() }
      );
      inp.value = "";
    } catch (e) {
      if (typeof toast === "function") toast(e.message, "error");
    }
  };

  window.mehraGiChatSimInsurer = async function () {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    try {
      const col = window._fsCollection(window._fbDb, "garageInsurerChat");
      const q = window._fsQuery(
        col,
        window._fsWhere("garageId", "==", uid)
      );
      const snap = await window._fsGetDocs(q);
      const lines = snap.docs
        .map((d) => d.data().text)
        .filter(Boolean)
        .slice(-8);
      const reply = await mehraBotAsk(
        `You are a UAE motor claims officer replying in chat. Last messages: ${JSON.stringify(
          lines
        )}. Reply in 2-3 short sentences: confirm or ask for VIN, photos, or tax invoice. Plain text, no name.`
      );
      await window._fsAddDoc(col, {
        garageId: uid,
        side: "insurer",
        text: reply,
        ts: Date.now(),
      });
    } catch (e) {
      if (typeof toast === "function") toast(e.message, "error");
    }
  };

  window.mehraGarageDefectAI = async function () {
    const o = document.getElementById("ghTrendOut");
    if (o) o.textContent = "Analysing…";
    const gname = await mehraGarageProfileName();
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      const all = snap.docs.map((d) => d.data());
      const mine = gname
        ? all.filter((c) => mehraClaimMatchesGarage(c, gname))
        : all;
      const use = (mine.length ? mine : all).slice(0, 25);
      o.textContent = await mehraBotAsk(
        `AI defect / damage trend for workshop${gname ? " " + gname : ""}. Sample claims (abridged JSON): ${JSON.stringify(
          use
        )}. Output: (1) top 3 defect themes, (2) 2 process fixes, (3) one metric to track. Short bullets, plain text.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };
  window.mehraGarageTechAI = async function () {
    const o = document.getElementById("ghTechOut");
    if (o) o.textContent = "…";
    const gname = await mehraGarageProfileName();
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      o.textContent = await mehraBotAsk(
        `Technician team performance (aggregate). Garage: ${
          gname || "UAE workshop"
        }. Total claims in dataset: ${snap.size}. Give: (1) 4 coaching themes, (2) 2 quality gates for lift-off checks, (3) 1 thing to never skip on EV vs ICE. No individual names. Short bullets.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };
  window.mehraGarageInsDraft = async function () {
    const note = document.getElementById("ghInsMsg")?.value || "";
    const o = document.getElementById("ghInsOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `Draft a professional email from a UAE garage to an insurer. Context: ${note}. Ask for written AED limit confirmation and list 2 attachments to include. Plain text.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };

  /* ── Insurance risk desk (full audit module) ── */
  window.initInsRiskDesk = async function initInsRiskDesk() {
    const el = document.getElementById("insRiskMount");
    if (!el) return;
    el.innerHTML = `<div class="mehra-hub-root">
      ${_hubCard("AI fraud detection", "ir-fraud", `<p class="mehra-hub-note">Optional plate filter. Uses <code>insuranceClaims</code>.</p>
        <div class="mehra-hub-row"><input type="text" id="irPlate" placeholder="Filter by plate (optional)"></div>
        <button type="button" class="btn btn-primary" onclick="mehraInsFraudAI()">Run fraud detection</button>
        <pre class="mehra-hub-out" id="irFraudOut"></pre>`)}
      ${_hubCard("Risk profiling per vehicle", "ir-veh", `<p class="mehra-hub-note">Builds a profile from all claims for one plate (loss history, severity hints).</p>
        <div class="mehra-hub-row"><input type="text" id="irVehPlate" placeholder="Plate number"></div>
        <button type="button" class="btn btn-primary" onclick="mehraInsVehicleRiskAI()">Profile risk</button>
        <pre class="mehra-hub-out" id="irVehOut"></pre>`)}
      ${_hubCard("Premium pricing AI", "ir-prem", `<p class="mehra-hub-note">Indicative motor premium range — not a quote.</p>
        <div class="mehra-hub-row2"><input type="text" id="irPremPlate" placeholder="Plate (optional)"><input type="text" id="irNcd" placeholder="NCD % (e.g. 25)"></div>
        <div class="mehra-hub-row"><input type="text" id="irPremVeh" placeholder="e.g. 2020 SUV Dubai"></div>
        <button type="button" class="btn btn-primary" onclick="mehraInsPremiumAI()">Estimate premium</button>
        <pre class="mehra-hub-out" id="irPremOut"></pre>`)}
      ${_hubCard("Cross-claim pattern analysis", "ir-cross", `<p class="mehra-hub-note">Finds repeat plates / clusters across the claim book.</p>
        <button type="button" class="btn btn-primary" onclick="mehraInsCrossClaimAI()">Analyse patterns</button>
        <pre class="mehra-hub-out" id="irCrossOut"></pre>`)}
      ${_hubCard("Garage performance scoring", "ir-ga", `<p class="mehra-hub-note">Ranks partner garages from claim outcomes in MEHRA.</p>
        <button type="button" class="btn btn-primary" onclick="mehraInsGarageScoreAI()">Score garages</button>
        <pre class="mehra-hub-out" id="irGarageOut"></pre>`)}
      ${_hubCard("AI negotiation assistant", "ir-neg", `<p class="mehra-hub-note">Talking points for repair cost / total loss discussion.</p>
        <textarea id="irNegCtx" rows="3" placeholder="Scene: e.g. owner wants 45k, our desk is 32k approved…"></textarea>
        <button type="button" class="btn btn-primary" onclick="mehraInsNegotiateAI()">Get negotiation lines</button>
        <pre class="mehra-hub-out" id="irNegOut"></pre>`)}
      ${_hubCard("Policy renewal automation (brief)", "ir-renew", `<p class="mehra-hub-note">Scans Mulkiya policy expiry fields for holders in MEHRA; outputs renewal worklist + AI next steps.</p>
        <button type="button" class="btn btn-primary" onclick="mehraInsRenewalAuto()">Build renewal worklist</button>
        <pre class="mehra-hub-out" id="irRenewOut"></pre>`)}
      ${_hubCard("Inspector dispatch system (AI assist)", "ir-disp", `<p class="mehra-hub-note">Suggests triage for field inspectors from pending / complex claims. Region filter optional.</p>
        <div class="mehra-hub-row"><input type="text" id="irDispReg" placeholder="Region e.g. Dubai (optional)"></div>
        <button type="button" class="btn btn-primary" onclick="mehraInsDispatchAI()">Propose dispatch plan</button>
        <pre class="mehra-hub-out" id="irDispOut"></pre>`)}
    </div>`;
  };

  window.mehraInsFraudAI = async function () {
    const plate = (document.getElementById("irPlate")?.value || "").trim();
    const out = document.getElementById("irFraudOut");
    if (out) out.textContent = "Scoring…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      const subset = snap.docs
        .map((d) => d.data())
        .filter(
          (c) =>
            !plate ||
            String(c.plate || "")
              .toLowerCase()
              .includes(plate.toLowerCase())
        );
      if (out)
        out.textContent = await mehraBotAsk(
          `You are a UAE insurance SIU assistant (fraud detection). Claim subset JSON: ${JSON.stringify(
            subset.slice(0, 15)
          )}. Task: (1) fraud / moral hazard signals, (2) repeat-vehicle red flags, (3) next investigation steps, (4) data gaps. Plain bullets.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsVehicleRiskAI = async function () {
    const p = (document.getElementById("irVehPlate")?.value || "").trim();
    const out = document.getElementById("irVehOut");
    if (!p) {
      if (typeof toast === "function") toast("Enter a plate", "error");
      return;
    }
    if (out) out.textContent = "Profiling…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      const pn = p.replace(/\s/g, "").toLowerCase();
      const rows = snap.docs
        .map((d) => d.data())
        .filter(
          (c) =>
            String(c.plate || "")
              .replace(/\s/g, "")
              .toLowerCase() === pn
        );
      if (out)
        out.textContent = await mehraBotAsk(
          `Per-vehicle risk profile (UAE). Plate ${p}. Claim history (JSON): ${JSON.stringify(
            rows.slice(0, 20)
          )}. Output: (1) risk band Low/Med/High with 1-line rationale, (2) frequency vs severity, (3) next underwriting actions, (4) T&C watch-outs. Short bullets, plain text.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsPremiumAI = async function () {
    const plate = (document.getElementById("irPremPlate")?.value || "").trim();
    const ncd = (document.getElementById("irNcd")?.value || "").trim();
    const veh = (document.getElementById("irPremVeh")?.value || "").trim();
    const out = document.getElementById("irPremOut");
    if (out) out.textContent = "Estimating…";
    try {
      if (out)
        out.textContent = await mehraBotAsk(
          `UAE motor comprehensive premium (indicative, not a quote). Vehicle desc: ${veh || "not specified"}. Plate: ${
            plate || "N/A"
          }. NCD: ${ncd || "unknown"}. Return: (1) AED range low-high for similar risk bucket, (2) 4 rating factors, (3) 2 add-ons to mention, (4) one compliance disclaimer. Plain text.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsCrossClaimAI = async function () {
    const out = document.getElementById("irCrossOut");
    if (out) out.textContent = "Analysing…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      const byPlate = {};
      snap.docs.forEach((d) => {
        const c = d.data() || {};
        const pl = String(c.plate || "unknown")
          .replace(/\s/g, "")
          .toLowerCase();
        if (!pl) return;
        byPlate[pl] = (byPlate[pl] || 0) + 1;
      });
      const repeats = Object.entries(byPlate)
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
      if (out)
        out.textContent = await mehraBotAsk(
          `Cross-claim network analysis. Total claims: ${snap.size}. Plates with >1 claim (sample): ${JSON.stringify(
            repeats
          )}. Full book summary keys only: ${
            Object.keys(byPlate).length
          } unique plates. Task: (1) suspicious repeat patterns, (2) link to anti-fraud, (3) 3 monitoring KPIs, (4) data quality caveats. Short bullets.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsGarageScoreAI = async function () {
    const out = document.getElementById("irGarageOut");
    if (out) out.textContent = "Scoring…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      const byG = {};
      snap.docs.forEach((d) => {
        const c = d.data() || {};
        const g = (c.garageName || c.garage || "—").trim() || "—";
        if (!byG[g]) byG[g] = { n: 0, approved: 0, sum: 0 };
        byG[g].n += 1;
        if ((c.status || "").toLowerCase() === "approved") {
          byG[g].approved += 1;
          byG[g].sum += Number(c.approvedAmount) || 0;
        }
      });
      if (out)
        out.textContent = await mehraBotAsk(
          `Garage performance from claims. Aggregates JSON: ${JSON.stringify(
            byG
          )}. Task: (1) rank top 3 partner garages for cycle time proxy (implied), (2) 2 underperforming signals, (3) recommended scorecard fields. Plain bullets.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsNegotiateAI = async function () {
    const ctx = (document.getElementById("irNegCtx")?.value || "").trim();
    const out = document.getElementById("irNegOut");
    if (out) out.textContent = "…";
    if (!ctx) {
      if (typeof toast === "function") toast("Add negotiation context", "error");
      return;
    }
    try {
      if (out)
        out.textContent = await mehraBotAsk(
          `You are a UAE motor claims negotiator. Situation: ${ctx}. Output: (1) opening line, (2) 3 fact-based levers, (3) walk-away point framing, (4) documentation to request. No markdown #.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsRenewalAuto = async function () {
    const out = document.getElementById("irRenewOut");
    if (out) out.textContent = "Scanning policy holders…";
    try {
      const users = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "users")
      );
      const upcoming = [];
      for (const doc of users.docs) {
        try {
          const m = await window._fsGetDoc(
            window._fsDoc(
              window._fbDb,
              "users",
              doc.id,
              "profile",
              "mulkiya"
            )
          );
          if (!m.exists()) continue;
          const d = m.data();
          if (!d.insurancePolicy || d.insurancePolicy === "—") continue;
          upcoming.push({
            plate: d.plateNumber,
            pol: d.insurancePolicy,
            insExp: d.insuranceExpiry,
            regExp: d.registrationExpiry,
            owner: d.ownerName,
          });
        } catch (e) {}
      }
      if (out)
        out.textContent = await mehraBotAsk(
          `Policy renewal automation planner. Mulkiya-based holders sample (up to 40): ${JSON.stringify(
            upcoming.slice(0, 40)
          )}. Task: (1) prioritise by expiry, (2) comms pack sequence (email/SMS), (3) 3 blockers, (4) what to ask Tasjeel/RTA for. Plain bullets. If empty list, say to onboard policies in MEHRA.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraInsDispatchAI = async function () {
    const reg = (document.getElementById("irDispReg")?.value || "").trim();
    const out = document.getElementById("irDispOut");
    if (out) out.textContent = "Planning…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "insuranceClaims")
      );
      const pending = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (c) =>
            (c.status || "").toLowerCase() === "pending" ||
            (c.status || "").toLowerCase() === "submitted"
        );
      if (out)
        out.textContent = await mehraBotAsk(
          `Inspector dispatch (field motor claims). Region filter: ${reg || "all UAE"}. Pending/submitted claim sample: ${JSON.stringify(
            pending.slice(0, 18)
          )}. Suggest: (1) 4 visits ordered by risk/amount, (2) kit checklist per visit, (3) 2 red flags for desk before dispatch, (4) ETA narrative. If no pending rows, state that and suggest backfill. Plain bullets.`
        );
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  /* ── RTA operations (audit: heatmap, prediction, ANPR feed, transfer, brief, Tasjeel check, notifications) ── */
  window.initRtaHeatmap = function initRtaHeatmap() {
    const el = document.getElementById("rtaHeatmapMount");
    if (!el) return;
    el.innerHTML = `
    <div class="mehra-hub-root">
      ${_hubCard("AI road safety heatmap", "rta-hm", `<p class="mehra-hub-note">Regional risk styling; “high” corridors can align with recorded fine <code>location</code> fields when present.</p>
        <div class="mehra-heatmap" aria-label="Risk heatmap" id="rtaHeatCells">
          <div class="mehra-hm a">DXB N — High</div><div class="mehra-hm b">SHJ — Med</div><div class="mehra-hm c">AD — Low</div>
          <div class="mehra-hm d">Sheikh Z — High</div><div class="mehra-hm e">E611 — Med</div>
        </div>
        <button type="button" class="btn btn-primary" onclick="mehraRtaHeatmapFromData()">Weight cells from MEHRA fine data</button>
        <pre class="mehra-hub-out" id="rtaHmDataOut"></pre>`)}
      ${_hubCard("Predictive violation scoring (AI)", "rta-pred", `<p class="mehra-hub-note">Model-style risk tiers from aggregated <code>rtaFines</code> — not calibrated enforcement KPIs.</p>
        <button type="button" class="btn btn-primary" onclick="mehraRtaPredictViol()">Run predictive scoring</button>
        <pre class="mehra-hub-out" id="rtaPredOut"></pre>`)}
      ${_hubCard("Plate recognition feed", "rta-anpr", `<p class="mehra-hub-note">Recent plates from issued fines (demo ANPR ingest through same datastore).</p>
        <button type="button" class="btn btn-primary" onclick="mehraRtaPlateFeed()">Refresh feed</button>
        <div id="rtaPlateFeed" class="rta-plate-feed">—</div>`)}
      ${_hubCard("Ownership transfer workflow", "rta-own", `<p class="mehra-hub-note">Checklist for sellers/buyers; formal transfer remains on authority systems.</p>
        <div class="mehra-hub-row"><input type="text" id="rtaOwnPlate" placeholder="Plate"></div>
        <button type="button" class="btn btn-primary" onclick="mehraRtaOwnershipAI()">AI workflow + blockers</button>
        <pre class="mehra-hub-out" id="rtaOwnOut"></pre>`)}
      ${_hubCard("AI-generated enforcement brief", "rta-br", `<p class="mehra-hub-note">Daily-style ops summary across fines + stakeholder signals.</p>
        <button type="button" class="btn btn-primary" onclick="mehraRtaEnforcementBrief()">Generate brief</button>
        <pre class="mehra-hub-out" id="rtaBriefOut"></pre>`)}
      ${_hubCard("Cross-check Tasjeel results", "rta-tj", `<p class="mehra-hub-note">Flags plate-level gaps between <code>rtaFines</code> and <code>tasjeelResults</code>.</p>
        <button type="button" class="btn btn-primary" onclick="mehraRtaCrossTasjeel()">Run cross-check</button>
        <pre class="mehra-hub-out" id="rtaTjCkOut"></pre>`)}
      ${_hubCard("Violation pattern brief", "rta-vp", `<p class="mehra-hub-note">Operational patterns from uploaded fine rows.</p>
        <button type="button" class="btn btn-primary" onclick="mehraRtaViolAI()">AI: violation patterns</button>
        <pre class="mehra-hub-out" id="rtaViolOut" style="min-height:60px;margin-top:8px"></pre>`)}
    </div>`;
  };

  window.mehraRtaHeatmapFromData = async function () {
    const out = document.getElementById("rtaHmDataOut");
    if (out) out.textContent = "Loading…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "rtaFines")
      );
      const locBuckets = {};
      snap.docs.forEach((d) => {
        const x = d.data() || {};
        const raw = String(x.location || x.violation || "general")
          .toLowerCase()
          .slice(0, 48);
        const key =
          raw.includes("dubai") || raw.includes("dxb")
            ? "DXB"
            : raw.includes("sharjah") || raw.includes("shj")
              ? "SHJ"
              : raw.includes("abu") || raw.includes("ad ")
                ? "AD"
                : "Other";
        locBuckets[key] = (locBuckets[key] || 0) + 1;
      });
      const cells = document.getElementById("rtaHeatCells");
      if (cells)
        cells.innerHTML = `<div class="mehra-hm a">DXB · ${locBuckets.DXB ?? 0} fines</div>
        <div class="mehra-hm b">SHJ · ${locBuckets.SHJ ?? 0} fines</div>
        <div class="mehra-hm c">AD · ${locBuckets.AD ?? 0} fines</div>
        <div class="mehra-hm d">Other · ${locBuckets.Other ?? 0}</div>
        <div class="mehra-hm e">Total · ${snap.size}</div>`;
      if (out)
        out.textContent = JSON.stringify(locBuckets, null, 2);
    } catch (e) {
      if (out) out.textContent = e.message;
    }
  };

  window.mehraRtaPredictViol = async function () {
    const o = document.getElementById("rtaPredOut");
    if (o) o.textContent = "Scoring…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "rtaFines")
      );
      const samples = snap.docs.slice(0, 40).map((d) => d.data());
      o.textContent = await mehraBotAsk(
        `RTA predictive risk (demo). Aggregated fines sample (${snap.size} total rows). JSON sample: ${JSON.stringify(
          samples
        ).slice(0, 4500)}. Output: (1) 3 hotspots by violation type frequency, (2) plates or segments to watch, (3) score bands 1-5 explanation, (4) what GIS/time data would tighten the model. Short bullets.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraRtaPlateFeed = async function () {
    const el = document.getElementById("rtaPlateFeed");
    if (!el) return;
    el.innerHTML = "Loading…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "rtaFines")
      );
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 25);
      if (!rows.length) {
        el.innerHTML =
          "<p class=\"mehra-hub-note\">No fines yet — feed fills when fines are logged.</p>";
        return;
      }
      el.innerHTML = `<table class="rta-feed-table"><thead><tr><th>Time</th><th>Plate</th><th>Confidence</th><th>Violation</th></tr></thead><tbody>${rows
        .map((r) => {
          const t = r.issuedAt || (r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 16) : "—");
          return `<tr><td>${mehraEsc(String(t))}</td><td><code>${mehraEsc(
            String(r.plate || "—")
          )}</code></td><td>demo OK</td><td>${mehraEsc(String(r.violation || "—"))}</td></tr>`;
        })
        .join("")}</tbody></table><p class="mehra-hub-note">Production would stream live camera LPR payloads into the same datastore.</p>`;
    } catch (e) {
      el.innerHTML = mehraEsc(e.message);
    }
  };

  window.mehraRtaOwnershipAI = async function () {
    const plate = (document.getElementById("rtaOwnPlate")?.value || "").trim();
    const o = document.getElementById("rtaOwnOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `UAE ownership transfer checklist for RTA-aligned desk workflow. Plate context: ${plate || "not specified"}. Provide: numbered steps seller/buyer/lien/bank/Tasjeel/insurer, blocking conditions, and docs bundle. Plain text bullets.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraRtaEnforcementBrief = async function () {
    const o = document.getElementById("rtaBriefOut");
    if (o) o.textContent = "Drafting…";
    try {
      const [fi, ap, cl] = await Promise.all([
        window._fsGetDocs(window._fsCollection(window._fbDb, "rtaFines")),
        window._fsGetDocs(window._fsCollection(window._fbDb, "appointments")),
        window._fsGetDocs(window._fsCollection(window._fbDb, "insuranceClaims")),
      ]);
      o.textContent = await mehraBotAsk(
        `Generate a daily enforcement brief for RTA command. Counts: fines ${fi.size}, appointments ${ap.size}, insurance claims ${cl.size}. Summarise: priority zones, outstanding fine volume, cross-agency follow-ups, 3 briefing bullets for leadership. Plain text.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraRtaCrossTasjeel = async function () {
    const o = document.getElementById("rtaTjCkOut");
    if (o) o.textContent = "Cross-checking…";
    try {
      const [fs, ts] = await Promise.all([
        window._fsGetDocs(window._fsCollection(window._fbDb, "rtaFines")),
        window._fsGetDocs(window._fsCollection(window._fbDb, "tasjeelResults")),
      ]);
      const norm = (s) =>
        String(s || "")
          .replace(/\s/g, "")
          .toLowerCase();
      const finePlates = new Set(fs.docs.map((d) => norm(d.data().plate)));
      const tjRows = ts.docs.map((d) => ({ id: d.id, ...d.data() }));
      const tjFail = new Set(
        tjRows
          .filter((x) =>
            ["failed", "conditional", "reject", "fail"].includes(
              String(x.status || "").toLowerCase()
            )
          )
          .map((x) => norm(x.plate))
      );
      const tjOk = new Set(
        tjRows
          .filter((x) =>
            ["passed", "pass", "completed"].includes(
              String(x.status || "").toLowerCase()
            )
          )
          .map((x) => norm(x.plate))
      );
      let miss = [];
      tjFail.forEach((pl) => {
        if (!finePlates.has(pl)) miss.push(`Tasjeel fail but no MEHRA fine row: ${pl}`);
      });
      const summary = `Fine-linked plates (unique-ish): ${finePlates.size}. Tasjeel fail plates: ${tjFail.size}. Tasjeel pass plates: ${tjOk.size}. Sample gaps:\n${miss.slice(0, 12).join("\n") || "—"}`;
      o.textContent =
        summary +
        "\n\n" +
        (await mehraBotAsk(
          `RTA/Tasjeel alignment analysis: ${summary}. Reply with: (1) interpretation of gaps, (2) when mismatch is expected, (3) 2 process fixes. Short bullets.`
        ));
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraRtaViolAI = async function () {
    const o = document.getElementById("rtaViolOut");
    if (o) o.textContent = "…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "rtaFines")
      );
      o.textContent = await mehraBotAsk(
        `RTA analyst. We have ${snap.size} fine rows in MEHRA. Give: (1) 3 enforcement priorities, (2) cluster labels, (3) data needed for stronger prediction. Short bullets.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };
  window.initRtaSync = async function initRtaSync() {
    const el = document.getElementById("rtaSyncMount");
    if (!el) return;
    el.textContent = "Loading cross-stakeholder snapshot…";
    try {
      const [f, ap, tj, cl, mk] = await Promise.all([
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "rtaFines")
        ),
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "appointments")
        ),
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "tasjeelResults")
        ),
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "insuranceClaims")
        ),
        window._fsGetDocs(
          window._fsCollection(window._fbDb, "marketplace")
        ),
      ]);
      let withOwner = 0;
      let orphan = 0;
      f.docs.forEach((d) => {
        const x = d.data() || {};
        if (x.linkedOwnerId) withOwner++;
        else orphan++;
      });
      el.innerHTML = `<div class="mehra-hub-list">
        <div class="mehra-hub-row"><span>RTA fines (records)</span><strong>${f.size}</strong></div>
        <div class="mehra-hub-row"><span>Appointments (garage/owner)</span><strong>${ap.size}</strong></div>
        <div class="mehra-hub-row"><span>Tasjeel inspection results</span><strong>${tj.size}</strong></div>
        <div class="mehra-hub-row"><span>Insurance claims</span><strong>${cl.size}</strong></div>
        <div class="mehra-hub-row"><span>Marketplace listings</span><strong>${mk.size}</strong></div>
      </div>
      ${_hubCard("Fine notification → owner inbox", "rta-ftn", `<p class="mehra-hub-note">When issuing a fine under <strong>Traffic Fines</strong>, MEHRA looks up the plate against registered vehicles / Mulkiya. If <code>linkedOwnerId</code> is resolved, we call <strong>notifyUser</strong> so the driver sees an in-app message (automatic). Unlinked plates stay “orphan” for manual chase.</p>
        <pre class="mehra-hub-out" style="min-height:auto">Issued fines with inbox path: ${withOwner}<br>Unlinked plates (no inbox auto-notify path): ${orphan}<br>Add owner vehicle + plate in MEHRA to increase match rate.</pre>
        <p class="mehra-hub-note">There is still no UAE-wide SMS/email from this sandbox — escalation is inbox + Ops follow-up outside MEHRA when needed.</p>`)}
      <p class="mehra-hub-note" style="margin-top:14px">These collections anchor cross-stakeholder workflows so desks are not on disconnected spreadsheets.</p>`;
    } catch (e) {
      el.textContent = "Could not load: " + e.message;
    }
  };

  /* ── Tasjeel advanced ── */
  window.initTasjeelAdvanced = function initTasjeelAdvanced() {
    const el = document.getElementById("tasjeelAdvMount");
    if (!el) return;
    el.innerHTML = `${_hubCard("Pre-screen risk (AI + history)", "tj-pre", `<p class="mehra-hub-note">Uses plate + last MEHRA inspection if present.</p>
        <input id="tjPl" placeholder="Plate">
        <button type="button" class="btn btn-primary" onclick="mehraTjPrescreen()">Run pre-screen</button>
        <pre class="mehra-hub-out" id="tjPreOut"></pre>`)}
      ${_hubCard("Re-inspection scheduler (AI assist)", "tj-re", `<p class="mehra-hub-note">Suggests slot pressure based on <code>appointments</code>.</p>
        <button type="button" class="btn btn-primary" onclick="mehraTjReinsp()">Propose re-inspection plan</button>
        <pre class="mehra-hub-out" id="tjReOut"></pre>`)}`;
  };
  window.mehraTjPrescreen = async function () {
    const p = (document.getElementById("tjPl")?.value || "").trim();
    const o = document.getElementById("tjPreOut");
    if (o) o.textContent = "…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "tasjeelResults")
      );
      const last = snap.docs
        .map((d) => d.data())
        .filter(
          (r) =>
            p &&
            String(r.plate || "")
              .toLowerCase()
              .includes(p.toLowerCase())
        )
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
      o.textContent = await mehraBotAsk(
        `Tasjeel pre-inspection. Plate query: ${p}. Last result object: ${JSON.stringify(
          last || {}
        )}. Give: likely fail points, 4-point bay checklist, whether to route to express lane. Short bullets.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };
  window.mehraTjReinsp = async function () {
    const o = document.getElementById("tjReOut");
    if (o) o.textContent = "…";
    try {
      const ap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "appointments")
      );
      o.textContent = await mehraBotAsk(
        `Tasjeel centre. We have ${ap.size} appointments. Propose: how to batch failed re-tests, spare bay allocation, 3 bullet SOP. Short.`
      );
    } catch (e) {
      o.textContent = e.message;
    }
  };

  /* ── Marketplace AI desk (full audit module) ── */
  window.initMktAiDesk = async function initMktAiDesk() {
    const el = document.getElementById("mktAiMount");
    if (!el) return;
    if (window._mktInqUnsub) {
      try {
        window._mktInqUnsub();
      } catch (e) {}
      window._mktInqUnsub = null;
    }
    el.innerHTML = `<div class="mehra-hub-root">
      ${_hubCard("AI price recommendation", "mkt-pr", `<p class="mehra-hub-note">Fair AED band vs your ask.</p>
        <div class="mehra-hub-row2"><input id="mktP" placeholder="Listing price AED"><input id="mktKm" placeholder="Mileage"></div>
        <div class="mehra-hub-row"><input id="mktT" placeholder="Vehicle title e.g. 2020 Nissan Patrol"></div>
        <button type="button" class="btn btn-primary" onclick="mehraMktPriceAI()">Get price recommendation</button>
        <pre class="mehra-hub-out" id="mktPriceOut"></pre>`)}
      ${_hubCard("Buyer inquiry / chat (demo thread)", "mkt-ch", `<p class="mehra-hub-note">Firestore <code>marketplaceInquiries</code> tied to operator UID.</p>
        <div class="mehra-hub-row"><input id="mktInqLid" placeholder="Listing ID (optional)"></div>
        <div id="mktChatList" class="mehra-gh-chat" style="min-height:140px;background:rgba(0,0,0,0.2)"></div>
        <div class="mehra-hub-row" style="margin-top:8px"><input id="mktChatIn" placeholder="Reply to buyer…" style="flex:1" onkeypress="if(event.key==='Enter'){event.preventDefault();mehraMktInqSend();}"></div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-primary" onclick="mehraMktInqSend()">Send reply</button>
          <button type="button" class="btn" onclick="mehraMktInqSimBuyer()">Simulate buyer message</button>
        </div>`)}
      ${_hubCard("AI listing quality score", "mkt-lq", `<p class="mehra-hub-note">Score from stored listing payload.</p>
        <div class="mehra-hub-row"><input id="mktLid" placeholder="Firestore listing document ID"></div>
        <button type="button" class="btn btn-primary" onclick="mehraMktListingQualityAI()">Score listing</button>
        <pre class="mehra-hub-out" id="mktLqOut"></pre>`)}
      ${_hubCard("RTA ownership transfer (links)", "mkt-rta", `<p class="mehra-hub-note">Authoritative transfer is outside MEHRA; start from RTA/emirate portals.</p>
        <ul class="mehra-mkt-links">
          <li><a href="https://www.rta.ae/wps/portal/rta/ae/home/traffic-services/vehicle-licensing/registering-buying-used-vehicle" target="_blank" rel="noopener">RTA · Register/buy used vehicle (Dubai)</a></li>
          <li><a href="https://www.rta.ae" target="_blank" rel="noopener">rta.ae — open other Emirates from their authorities</a>.</li>
        </ul>
        <button type="button" class="btn btn-primary" onclick="mehraMktTransferChecklistAI()">AI readiness checklist</button>
        <pre class="mehra-hub-out" id="mktRtaAiOut"></pre>`)}
      ${_hubCard("Insurance cert check on sale", "mkt-ins", `<p class="mehra-hub-note">Manual paste — does not validate with insurers.</p>
        <textarea id="mktInsTxt" rows="3" placeholder="Policy no. / insurer / expiry / notes"></textarea>
        <button type="button" class="btn btn-primary" onclick="mehraMktInsCertAI()">AI review checklist</button>
        <pre class="mehra-hub-out" id="mktInsOut"></pre>`)}
      ${_hubCard("Demand / trend analytics AI", "mkt-dem", `<button type="button" class="btn btn-primary" onclick="mehraMktDemandTrendAI()">Analyse marketplace book</button>
        <pre class="mehra-hub-out" id="mktDemOut"></pre>`)}
      ${_hubCard("Fraud listing detector", "mkt-fr", `<div class="mehra-hub-row"><input id="mktFrLid" placeholder="Listing ID or blank for book scan"></div>
        <button type="button" class="btn btn-primary" onclick="mehraMktFraudListingAI()">Run fraud detector</button>
        <pre class="mehra-hub-out" id="mktFrOut"></pre>`)}
      ${_hubCard("Buyer credit / eligibility (AI)", "mkt-cr", `<div class="mehra-hub-row2"><input id="mktInc" placeholder="Monthly income AED (optional)"><input id="mktSal" placeholder="UAE months employed"></div>
        <div class="mehra-hub-row"><input id="mktBk" placeholder="cash / bank loan / captive"></div>
        <button type="button" class="btn btn-primary" onclick="mehraMktBuyerEligibilityAI()">Assess framing (not underwriting)</button>
        <pre class="mehra-hub-out" id="mktCredOut"></pre>`)}
    </div>`;
    window.mehraMountMktInquiryFeed();
  };

  window.mehraMktPriceAI = async function () {
    const price = document.getElementById("mktP")?.value;
    const km = document.getElementById("mktKm")?.value;
    const title = document.getElementById("mktT")?.value;
    const o = document.getElementById("mktPriceOut");
    if (o) o.textContent = "…";
    try {
      if (o)
        o.textContent = await mehraBotAsk(
          `UAE classified car marketplace. Vehicle: ${title}. Asking AED ${price}, km ${km}. Tasks: (1) recommended AED ask range vs market (low-mid-high), (2) 3 rationale bullets, (3) negotiation margin tip. Plain text.`
        );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMountMktInquiryFeed = async function () {
    const uid = window._currentUser?.uid;
    const el = document.getElementById("mktChatList");
    if (!el) return;
    if (!uid) {
      el.innerHTML = "<p>Operator login required.</p>";
      return;
    }
    if (window._mktInqUnsub) {
      try {
        window._mktInqUnsub();
      } catch (e) {}
      window._mktInqUnsub = null;
    }
    const col = window._fsCollection(window._fbDb, "marketplaceInquiries");
    try {
      const q = window._fsQuery(col, window._fsWhere("operatorUid", "==", uid));
      window._mktInqUnsub = window._fsOnSnapshot(
        q,
        (snap) => {
          const rows = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
          if (!rows.length) {
            el.innerHTML =
              '<p class="mehra-hub-note">No inquiries yet.</p>';
            return;
          }
          el.innerHTML = rows
            .map((r) => {
              const buyer = String(r.fromRole || "").includes("buyer");
              return `<div class="mehra-gichat ${
                buyer ? "ins" : "grg"
              }"><span class="mehra-gichat-who">${buyer ? "Buyer" : "Ops"}${
                r.listingId ? " · " + mehraEsc(String(r.listingId)) : ""
              }</span>${mehraEsc(r.body || r.message || "")}</div>`;
            })
            .join("");
          el.scrollTop = el.scrollHeight;
        },
        async () => {
          try {
            const snap = await window._fsGetDocs(col);
            const rows = snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .filter((r) => r.operatorUid === uid)
              .sort((a, b) => (a.ts || 0) - (b.ts || 0));
            if (!rows.length) {
              el.innerHTML =
                '<p class="mehra-hub-note">Fallback: no readable rows.</p>';
              return;
            }
            el.innerHTML = rows
              .map((r) => {
                const buyer = String(r.fromRole || "").includes(
                  "buyer"
                );
                return `<div class="mehra-gichat ${
                  buyer ? "ins" : "grg"
                }"><span class="mehra-gichat-who">${
                  buyer ? "Buyer" : "Ops"
                }</span>${mehraEsc(r.body || r.message || "")}</div>`;
              })
              .join("");
          } catch (err) {
            el.innerHTML = mehraEsc(err.message);
          }
        }
      );
    } catch (e) {
      el.innerHTML = '<p class="mehra-hub-note">' + mehraEsc(e.message) + "</p>";
    }
  };

  window.mehraMktInqSend = async function () {
    const uid = window._currentUser?.uid;
    const body = (document.getElementById("mktChatIn")?.value || "").trim();
    const listingId = (
      document.getElementById("mktInqLid")?.value || ""
    ).trim();
    if (!uid || !body) return;
    try {
      await window._fsAddDoc(
        window._fsCollection(window._fbDb, "marketplaceInquiries"),
        {
          operatorUid: uid,
          listingId: listingId || null,
          body,
          fromRole: "operator",
          ts: Date.now(),
        }
      );
      const inp = document.getElementById("mktChatIn");
      if (inp) inp.value = "";
    } catch (e) {
      if (typeof toast === "function") toast(e.message, "error");
    }
  };

  window.mehraMktInqSimBuyer = async function () {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    const listingId = (
      document.getElementById("mktInqLid")?.value || ""
    ).trim();
    try {
      await window._fsAddDoc(
        window._fsCollection(window._fbDb, "marketplaceInquiries"),
        {
          operatorUid: uid,
          listingId: listingId || null,
          body: "[Buyer demo] Is the inspection PDF available and can we see the vehicle this week?",
          fromRole: "buyer_demo",
          ts: Date.now(),
        }
      );
    } catch (e) {
      if (typeof toast === "function") toast(e.message, "error");
    }
  };

  window.mehraMktListingQualityAI = async function () {
    const id = (document.getElementById("mktLid")?.value || "").trim();
    const o = document.getElementById("mktLqOut");
    if (o) o.textContent = "…";
    if (!id) {
      if (typeof toast === "function") toast("Enter listing ID", "error");
      return;
    }
    try {
      const ref = window._fsDoc(window._fbDb, "marketplace", id);
      const d = await window._fsGetDoc(ref);
      if (!d.exists()) {
        if (o) o.textContent = "Listing not found.";
        return;
      }
      const data = d.data();
      if (o)
        o.textContent = await mehraBotAsk(
          `UAE marketplace listing QA. JSON (truncated as needed): ${JSON.stringify(data).slice(0, 6000)}. Output: quality score X/100, improvements, moderation flags — plain text.`
        );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMktTransferChecklistAI = async function () {
    const o = document.getElementById("mktRtaAiOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `Buyer/seller transfer readiness after private sale UAE: numbered checklist linking insurance, Tasjeel, RTA/emirate nuances, escrow caution; no hallucinated portal steps. Plain bullets.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMktInsCertAI = async function () {
    const txt = (document.getElementById("mktInsTxt")?.value || "").trim();
    const o = document.getElementById("mktInsOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `Insurance certificate review for resale (desk aid). Paste: "${txt}". List completeness checks, inconsistencies, what to validate with insurer. If empty paste, say what collector should capture. Plain bullets.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMktDemandTrendAI = async function () {
    const o = document.getElementById("mktDemOut");
    if (o) o.textContent = "…";
    try {
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "marketplace")
      );
      const all = snap.docs.map((d) => d.data());
      const prices = all
        .map((x) => Number(x.price) || 0)
        .filter((p) => p > 0);
      const avg = prices.length
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : 0;
      const sold = all.filter((x) => x.status === "sold").length;
      if (o)
        o.textContent = await mehraBotAsk(
          `Market demand/trends. N=${snap.size}, sold=${sold}, approx avg price AED=${avg}. Give demand signals + cohort ideas + one anomaly scan — bullets.`
        );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMktFraudListingAI = async function () {
    const lid = (document.getElementById("mktFrLid")?.value || "").trim();
    const o = document.getElementById("mktFrOut");
    if (o) o.textContent = "…";
    try {
      if (lid) {
        const d = await window._fsGetDoc(
          window._fsDoc(window._fbDb, "marketplace", lid)
        );
        if (!d.exists()) {
          if (o) o.textContent = "Listing not found.";
          return;
        }
        const data = d.data();
        if (o)
          o.textContent = await mehraBotAsk(
            `Fraud-detector on single listing: ${JSON.stringify(data).slice(0, 5000)} — severity, signals, escalation — plain text.`
          );
        return;
      }
      const snap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, "marketplace")
      );
      const sample = snap.docs.slice(0, 20).map((d) => d.data());
      if (o)
        o.textContent = await mehraBotAsk(
          `Fraud pattern sweep on marketplace sample (${snap.size} total): ${JSON.stringify(sample).slice(0, 6000)} — cohort risks + ops rules — plain bullets.`
        );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };

  window.mehraMktBuyerEligibilityAI = async function () {
    const inc = (document.getElementById("mktInc")?.value || "").trim();
    const sal = (document.getElementById("mktSal")?.value || "").trim();
    const bk = (document.getElementById("mktBk")?.value || "").trim();
    const o = document.getElementById("mktCredOut");
    if (o) o.textContent = "…";
    try {
      o.textContent = await mehraBotAsk(
        `Buyer credit/eligibility guidance (informational NOT underwriting). Income AED/mo=${inc||"?"}, UAE months=${sal||"?"}, product=${bk||"?"}. Output eligibility framing docs needed disclaimers plain bullets.`
      );
    } catch (e) {
      if (o) o.textContent = e.message;
    }
  };
})();
