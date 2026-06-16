/**
 * AutoVault — automated accident report flow (voice → scan → plate → police → confirm).
 */
(function (global) {
  if (global.__ACC_AUTO_FLOW__) return;
  global.__ACC_AUTO_FLOW__ = true;

  const API = () => global.location.origin;

  const state = {
    step: 1,
    scanMode: null,
    stream: null,
    scanInterval: null,
    scanning: false,
    scanData: null,
    voiceIntake: null,
    plateOcr: null,
    policeOcr: null,
    tpInsurance: null,
    faultStance: null,
    suggestedGarage: null,
    metadata: null,
    mulkiya: null,
    defectsSeen: new Set(),
    frameCount: 0,
    uploadProcessing: false,
    scanFrames: [],
    mergedDefects: [],
    platePreviewUrl: null,
    policePreviewUrl: null,
    plateParsing: false,
    policeParsing: false,
    intakeProcessing: false,
    voiceRecording: false,
  };

  let voiceRecorder = null;
  let voiceChunks = [];

  async function authHdr() {
    if (typeof global.getAuthBearerHeader === "function") {
      return global.getAuthBearerHeader(true).catch(() => null);
    }
    return null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg, type) {
    if (typeof global.toast === "function") global.toast(msg, type || "info");
  }

  function parseApiError(body, fallback) {
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg || String(d)).join(", ");
    return fallback || "Request failed";
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith("image/")) return true;
    return /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || "");
  }

  function needsPlateStep() {
    return !!state.voiceIntake?.other_vehicles_involved;
  }

  function labelize(s) {
    return String(s || "").replace(/_/g, " ").trim() || "—";
  }

  async function postScanFrame(blobOrFile, name) {
    const fd = new FormData();
    fd.append("file", blobOrFile, name || "frame.jpg");
    const res = await fetch(`${API()}/accident/scan-frame`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseApiError(data, "Damage scan failed"));
    return data;
  }

  function setScanDoneVisible(show) {
    const btn = $("accAutoScanDone");
    if (btn) btn.classList.toggle("visible", !!show);
  }

  function revokeScanFrameUrls() {
    state.scanFrames.forEach((f) => {
      if (f.originalUrl) {
        try {
          URL.revokeObjectURL(f.originalUrl);
        } catch (_) {}
      }
    });
    state.scanFrames = [];
  }

  function revokePlatePreview() {
    if (state.platePreviewUrl) {
      try {
        URL.revokeObjectURL(state.platePreviewUrl);
      } catch (_) {}
      state.platePreviewUrl = null;
    }
  }

  function revokePolicePreview() {
    if (state.policePreviewUrl) {
      try {
        URL.revokeObjectURL(state.policePreviewUrl);
      } catch (_) {}
      state.policePreviewUrl = null;
    }
  }

  function annotatedSrc(frame) {
    if (!frame) return "";
    if (frame.annotatedPath) return `${API()}/${frame.annotatedPath}?t=${Date.now()}`;
    if (frame.annotatedB64) return `data:image/jpeg;base64,${frame.annotatedB64}`;
    return frame.originalUrl || "";
  }

  function renderAccumulatedDefectList() {
    const root = $("accAutoDefectList");
    if (!root) return;
    const defects = state.mergedDefects || [];
    if (!defects.length) {
      root.innerHTML = "";
      return;
    }
    root.innerHTML = defects
      .map((d) => {
        const part = d.part || d.label || "Unknown";
        const conf = Math.round(Number(d.confidence) || 0);
        const sev = d.severity_tier || d.severity || "";
        return `<span class="acc-auto-tag">${part} ${conf}%${sev ? ` · ${labelize(sev)}` : ""}</span>`;
      })
      .join("");
  }

  function mergeDefectsIntoState(defects) {
    if (!Array.isArray(defects) || !defects.length) return;
    defects.forEach((d) => {
      const key = (d.part || d.label || "").toLowerCase();
      if (!key) return;
      const idx = state.mergedDefects.findIndex(
        (x) => (x.part || x.label || "").toLowerCase() === key
      );
      if (idx < 0) state.mergedDefects.push(d);
      else if (Number(d.confidence || 0) > Number(state.mergedDefects[idx].confidence || 0)) {
        state.mergedDefects[idx] = d;
      }
    });
    renderAccumulatedDefectList();
  }

  async function resizeImageFile(file, maxDim = 1280, quality = 0.82) {
    if (!file || !isImageFile(file)) return file;
    if (file.size < 450000 && typeof createImageBitmap !== "function") return file;
    try {
      if (typeof createImageBitmap !== "function") return file;
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      if (scale >= 1 && file.size < 900000) {
        bitmap.close();
        return file;
      }
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const blob = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
      return blob || file;
    } catch (_) {
      return file;
    }
  }

  function setScanHud(text, pct) {
    const label = $("accAutoScanHudText");
    const fill = $("accAutoScanProgressFill");
    if (label && text) label.textContent = text;
    if (fill && pct != null) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  function syncUploadViewportAspect(imgEl) {
    const wrap = $("accAutoCamWrap");
    if (!wrap || !imgEl?.naturalWidth || !imgEl.naturalHeight) return;
    wrap.style.aspectRatio = `${imgEl.naturalWidth} / ${imgEl.naturalHeight}`;
  }

  function clearUploadViewportAspect() {
    const wrap = $("accAutoCamWrap");
    if (wrap) wrap.style.aspectRatio = "";
  }

  function bindUploadPreviewAspect(preview) {
    if (!preview) return;
    const onReady = () => syncUploadViewportAspect(preview);
    if (preview.complete && preview.naturalWidth) onReady();
    else preview.addEventListener("load", onReady, { once: true });
  }

  function showUploadScanViewport(previewUrl) {
    const live = $("accAutoLiveScan");
    const upload = $("accAutoUploadScan");
    const picker = $("accAutoScanModePicker");
    const video = $("accAutoVideo");
    const preview = $("accAutoUploadPreview");
    const wrap = $("accAutoCamWrap");
    if (picker) picker.style.display = "none";
    if (upload) upload.style.display = "none";
    if (live) live.style.display = "block";
    if (video) video.style.display = "none";
    if (wrap) {
      wrap.classList.add("is-scanning", "acc-auto-cam-wrap--upload");
      wrap.classList.remove("has-annotation");
    }
    if (preview) {
      preview.hidden = false;
      preview.src = previewUrl || "";
      bindUploadPreviewAspect(preview);
    }
    const overlay = $("accAutoOverlay");
    if (overlay) overlay.removeAttribute("src");
    const hud = $("accAutoScanHud");
    if (hud) hud.hidden = false;
    setScanHud("Starting AI damage scan…", 4);
  }

  function stopUploadScanUi() {
    const wrap = $("accAutoCamWrap");
    if (wrap) wrap.classList.remove("is-scanning");
    setScanHud("Scan complete", 100);
    const hud = $("accAutoScanHud");
    if (hud) {
      setTimeout(() => {
        hud.hidden = true;
      }, 1400);
    }
  }

  function resetScanViewport() {
    const video = $("accAutoVideo");
    const preview = $("accAutoUploadPreview");
    const wrap = $("accAutoCamWrap");
    const overlay = $("accAutoOverlay");
    const hud = $("accAutoScanHud");
    if (video) video.style.display = "";
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    if (wrap) {
      wrap.classList.remove("is-scanning", "has-annotation", "acc-auto-cam-wrap--upload");
    }
    clearUploadViewportAspect();
    if (overlay) overlay.removeAttribute("src");
    if (hud) hud.hidden = true;
    setScanHud("", 0);
  }

  function buildHeroShot(src, badge, badgeClass, caption) {
    if (!src) {
      return `<div class="acc-auto-hero-shot"><div class="acc-auto-shot-caption">${caption}</div></div>`;
    }
    return `<div class="acc-auto-hero-shot">
      <img src="${src}" alt="${caption}" loading="lazy" />
      <span class="acc-auto-shot-badge ${badgeClass}">${badge}</span>
      <div class="acc-auto-shot-caption">${caption}</div>
    </div>`;
  }

  function renderDamageVisuals() {
    const root = $("accAutoScanResults");
    const hero = $("accAutoDamageHero");
    const gallery = $("accAutoDamageGallery");
    if (!root || !state.scanFrames.length) {
      if (root) root.style.display = "none";
      return;
    }
    root.style.display = "";
    const latest = state.scanFrames[state.scanFrames.length - 1];
    const orig = latest.originalUrl || annotatedSrc(latest);
    const ann = annotatedSrc(latest) || orig;
    const defects = $("accAutoDefectCount")?.textContent || "0";

    if (hero) {
      hero.innerHTML =
        buildHeroShot(orig, "Original", "original", `Photo ${latest.index + 1} — uploaded capture`) +
        buildHeroShot(
          ann,
          "AI annotated",
          "annotated",
          `${defects} damage area(s) · AI pre-assessment`
        );
    }

    const title = $("accAutoResultsTitle");
    if (title) {
      title.textContent =
        state.scanFrames.length > 1
          ? `${state.scanFrames.length} photos analyzed`
          : "Damage scan complete";
    }

    if (gallery) {
      if (state.scanFrames.length <= 1) {
        gallery.innerHTML = "";
        gallery.style.display = "none";
      } else {
        gallery.style.display = "";
        gallery.innerHTML = state.scanFrames
          .map((f, i) => {
            const src = annotatedSrc(f) || f.originalUrl;
            if (!src) return "";
            return `<div class="acc-auto-gallery-tile">
              <img src="${src}" alt="Damage photo ${i + 1}" loading="lazy" />
              <span class="acc-auto-shot-badge annotated">IMG ${i + 1}</span>
            </div>`;
          })
          .join("");
      }
    }
  }

  function renderDefectList() {
    const root = $("accAutoDefectList");
    if (!root) return;
    const defects =
      state.scanData?.defect_details ||
      state.scanData?.defects_enriched ||
      [];
    if (!defects.length) {
      root.innerHTML = "";
      return;
    }
    root.innerHTML = defects
      .map((d) => {
        const part = d.part || d.label || "Unknown";
        const conf = Math.round(Number(d.confidence) || 0);
        const sev = d.severity_tier || d.severity || "";
        return `<span class="acc-auto-tag">${part} ${conf}%${sev ? ` · ${labelize(sev)}` : ""}</span>`;
      })
      .join("");
  }

  function renderVoiceIntakeCards() {
    const root = $("accAutoIntakeCards");
    const toScan = $("accAutoToScan");
    const v = state.voiceIntake;
    if (!root || !v) return;

    const otherYes = !!v.other_vehicles_involved;
    root.innerHTML = `
      <div class="acc-auto-intake-card ${otherYes ? "yes" : "no"}">
        <label>Other vehicles</label>
        <strong>${otherYes ? "Yes — involved" : "No — single vehicle"}</strong>
      </div>
      <div class="acc-auto-intake-card">
        <label>Incident type</label>
        <strong>${labelize(v.incident_type)}</strong>
      </div>
      <div class="acc-auto-intake-card ${v.injuries ? "yes" : "no"}">
        <label>Injuries</label>
        <strong>${v.injuries_label || (v.injuries ? "Injuries reported" : "No injuries — property only")}</strong>
      </div>`;
    root.style.display = "";
    if (toScan) toScan.style.display = "";
  }

  function renderFormalDescription(text) {
    const box = $("accAutoFormalDesc");
    if (!box) return;
    if (!text) {
      box.innerHTML = "";
      box.style.display = "none";
      return;
    }
    box.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "Formal incident description";
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(strong);
    box.appendChild(p);
    box.style.display = "";
  }

  function setIntakeComposerBusy(busy) {
    state.intakeProcessing = !!busy;
    const send = $("accAutoTextSend");
    const mic = $("accAutoVoiceMic");
    const ta = $("accAutoIncidentText");
    if (send) send.disabled = !!busy;
    if (mic) mic.disabled = !!busy && !state.voiceRecording;
    if (ta) ta.disabled = !!busy && !state.voiceRecording;
  }

  function setVoiceRecordingUi(active) {
    state.voiceRecording = !!active;
    const composer = $("accAutoComposer");
    const mic = $("accAutoVoiceMic");
    const hint = $("accAutoVoiceHint");
    if (composer) composer.classList.toggle("recording", !!active);
    if (mic) mic.classList.toggle("recording", !!active);
    if (hint) {
      hint.textContent = active
        ? "Recording… tap mic again when finished"
        : "GPS, weather and lighting captured silently";
    }
  }

  function applyVoiceIntakeResult(data) {
    state.voiceIntake = data;
    const ta = $("accAutoIncidentText");
    if (ta && data.transcript) ta.value = data.transcript;
    renderFormalDescription(data.formal_description || data.transcript || "");
    const st = $("accAutoVoiceStatus");
    if (st) st.textContent = "";
    renderVoiceIntakeCards();
  }

  async function submitTextIntake() {
    const ta = $("accAutoIncidentText");
    const text = (ta?.value || "").trim();
    if (!text) {
      toast("Describe what happened first", "error");
      ta?.focus();
      return;
    }
    if (state.intakeProcessing) return;
    const st = $("accAutoVoiceStatus");
    setIntakeComposerBusy(true);
    if (st) st.textContent = "Analyzing your description…";
    const fd = new FormData();
    fd.append("transcript", text);
    try {
      const res = await fetch(`${API()}/accident/text-intake`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(data, "Could not analyze description"));
      applyVoiceIntakeResult(data);
      toast("Incident analyzed", "success");
    } catch (e) {
      if (st) st.textContent = "Analysis failed — try again.";
      toast(String(e.message || e), "error");
    } finally {
      setIntakeComposerBusy(false);
    }
  }

  function resetScanPanel() {
    stopAccidentScan();
    revokeScanFrameUrls();
    resetScanViewport();
    state.scanMode = null;
    state.defectsSeen = new Set();
    state.mergedDefects = [];
    state.frameCount = 0;
    state.uploadProcessing = false;
    const picker = $("accAutoScanModePicker");
    const live = $("accAutoLiveScan");
    const upload = $("accAutoUploadScan");
    if (picker) picker.style.display = "";
    if (live) live.style.display = "none";
    if (upload) upload.style.display = "none";
    const files = $("accAutoDamageFiles");
    if (files) files.value = "";
    const tags = $("accAutoDefectTags");
    if (tags) tags.innerHTML = "";
    const countEl = $("accAutoDefectCount");
    if (countEl) countEl.textContent = "0";
    const overlay = $("accAutoOverlay");
    if (overlay) overlay.removeAttribute("src");
    const results = $("accAutoScanResults");
    if (results) results.style.display = "none";
    const hero = $("accAutoDamageHero");
    if (hero) hero.innerHTML = "";
    const gallery = $("accAutoDamageGallery");
    if (gallery) gallery.innerHTML = "";
    const defectList = $("accAutoDefectList");
    if (defectList) defectList.innerHTML = "";
    const st = $("accAutoScanStatus");
    if (st) st.textContent = "Choose live scan or upload photos to begin.";
    setScanDoneVisible(false);
  }

  function resetPlatePanel() {
    revokePlatePreview();
    state.plateOcr = null;
    state.tpInsurance = null;
    const input = $("accAutoPlateFile");
    if (input) input.value = "";
    const wrap = $("accAutoPlatePreviewWrap");
    if (wrap) wrap.style.display = "none";
    const img = $("accAutoPlatePreviewImg");
    if (img) img.removeAttribute("src");
    const card = $("accAutoPlateConfirmCard");
    if (card) {
      card.innerHTML = "";
      card.style.display = "none";
    }
    const cont = $("accAutoPlateContinue");
    if (cont) cont.style.display = "none";
  }

  function resetPolicePanel() {
    revokePolicePreview();
    state.policeOcr = null;
    const input = $("accAutoPoliceFile");
    if (input) input.value = "";
    const wrap = $("accAutoPolicePreviewWrap");
    if (wrap) wrap.style.display = "none";
    const img = $("accAutoPolicePreviewImg");
    if (img) img.removeAttribute("src");
    const badges = $("accAutoPoliceBadges");
    if (badges) {
      badges.innerHTML = "";
      badges.style.display = "none";
    }
    const st = $("accAutoPoliceStatus");
    if (st) st.textContent = "";
    const cont = $("accAutoPoliceContinue");
    if (cont) cont.style.display = "none";
  }

  function resetVoicePanel() {
    if (voiceRecorder && voiceRecorder.state !== "inactive") {
      try {
        voiceRecorder.stop();
      } catch (_) {}
    }
    voiceRecorder = null;
    voiceChunks = [];
    state.voiceIntake = null;
    state.intakeProcessing = false;
    state.voiceRecording = false;
    const ta = $("accAutoIncidentText");
    if (ta) {
      ta.value = "";
      ta.disabled = false;
    }
    setVoiceRecordingUi(false);
    setIntakeComposerBusy(false);
    const st = $("accAutoVoiceStatus");
    if (st) st.textContent = "";
    const hint = $("accAutoVoiceHint");
    if (hint) hint.textContent = "GPS, weather and lighting captured silently";
    renderFormalDescription("");
    const cards = $("accAutoIntakeCards");
    if (cards) {
      cards.innerHTML = "";
      cards.style.display = "none";
    }
    const toScan = $("accAutoToScan");
    if (toScan) toScan.style.display = "none";
  }

  function setStep(n) {
    state.step = n;
    const skipPlate = !needsPlateStep();

    [1, 2, 3, 4, 5].forEach((i) => {
      const panel = $(`accAutoPanel${i}`);
      const pip = document.querySelector(`.acc-auto-pip[data-step="${i}"]`);
      if (panel) panel.style.display = i === n ? "" : "none";
      if (pip) {
        pip.classList.toggle("active", i === n);
        const done =
          i < n && !(i === 3 && skipPlate);
        pip.classList.toggle("done", done);
        if (i === 3) {
          pip.classList.toggle("acc-auto-pip--skipped", skipPlate);
        }
      }
    });

    const fill = $("accAutoProg");
    if (fill) fill.style.width = `${((n - 1) / 4) * 100}%`;

    if (n === 2 && !state.scanData && state.frameCount < 1) resetScanPanel();
    if (n === 5) renderConfirmSummary();
  }

  function goToNext() {
    const s = state.step;
    if (s === 1) setStep(2);
    else if (s === 2) setStep(needsPlateStep() ? 3 : 4);
    else if (s === 3) setStep(4);
    else if (s === 4) setStep(5);
  }

  async function loadVehicleContext() {
    const uid = global._currentUser?.uid;
    if (!uid) return;
    let mulkiya = global._activeVehicle || {};
    if (!mulkiya.make && global._fsGetDocs) {
      try {
        const vSnap = await global._fsGetDocs(
          global._fsCollection(global._fbDb, "users", uid, "vehicles")
        );
        if (!vSnap.empty) mulkiya = vSnap.docs[0].data();
      } catch (_) {}
    }
    state.mulkiya = mulkiya;
    const vehicle = [mulkiya.make, mulkiya.bodyType, mulkiya.year].filter(Boolean).join(" ") || "—";
    const preview = $("accAutoVehiclePreview");
    if (preview) {
      preview.innerHTML = `<strong>${vehicle}</strong> · ${mulkiya.plateNumber || "—"} · ${mulkiya.insuranceCompany || "Insurer —"}`;
    }
  }

  async function captureSilentMetadata() {
    let lat = null;
    let lon = null;
    let reverse = "";
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 })
      );
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
      try {
        const g = await fetch(`${API()}/api/mehr/reverse-geocode?lat=${lat}&lon=${lon}`);
        if (g.ok) {
          const j = await g.json();
          reverse = j.address || j.display_name || j.label || "";
        }
      } catch (_) {}
    } catch (_) {}
    try {
      const q = new URLSearchParams();
      if (lat != null) q.set("lat", String(lat));
      if (lon != null) q.set("lon", String(lon));
      if (reverse) q.set("reverse_geocode", reverse);
      const res = await fetch(`${API()}/accident/context?${q}`);
      if (res.ok) {
        const j = await res.json();
        state.metadata = { ...(j.metadata || {}), gps_lat: lat, gps_lon: lon, reverse_geocode: reverse };
      }
    } catch (_) {
      state.metadata = {
        incident_date: new Date().toISOString().slice(0, 10),
        incident_time: new Date().toTimeString().slice(0, 5),
        reverse_geocode: reverse,
        gps_lat: lat,
        gps_lon: lon,
      };
    }
  }

  function applyScanFrameResponse(data, originalSource) {
    let originalUrl = null;
    if (originalSource instanceof Blob) {
      originalUrl = URL.createObjectURL(originalSource);
    }
    state.frameCount += 1;
    state.scanFrames.push({
      index: state.scanFrames.length,
      originalUrl,
      annotatedB64: data.annotated_frame || null,
      annotatedPath: null,
      defectCount: data.frame_defects || 0,
    });

    const tags = $("accAutoDefectTags");
    const countEl = $("accAutoDefectCount");
    if (countEl) countEl.textContent = String(data.total_unique_parts || 0);
    if (data.defects_enriched && tags) {
      data.defects_enriched.forEach((d) => {
        const k = (d.part || d.label || "").toLowerCase();
        if (!k || state.defectsSeen.has(k)) return;
        state.defectsSeen.add(k);
        const tag = document.createElement("span");
        tag.className = "acc-auto-tag";
        tag.textContent = `${d.part || d.label} ${Math.round(d.confidence || 0)}%`;
        tags.appendChild(tag);
      });
    }
    mergeDefectsIntoState(data.defects_enriched);
    if (data.annotated_frame) {
      const img = $("accAutoOverlay");
      const wrap = $("accAutoCamWrap");
      if (img) img.src = `data:image/jpeg;base64,${data.annotated_frame}`;
      if (wrap) wrap.classList.add("has-annotation");
    }
    const st = $("accAutoScanStatus");
    if (st) {
      const modeLabel = state.scanMode === "upload" ? "photo(s)" : "frames";
      st.textContent = `${data.total_unique_parts || 0} damage area(s) · ${state.frameCount} ${modeLabel}`;
    }
    renderDamageVisuals();
    if (state.frameCount > 0) setScanDoneVisible(true);
  }

  async function chooseScanMode(mode) {
    if (mode !== "live" && mode !== "upload") return;
    if (state.uploadProcessing) return;
    if (state.scanning) stopAccidentScan();

    state.scanMode = mode;
    const picker = $("accAutoScanModePicker");
    if (picker) picker.style.display = "none";
    state.defectsSeen = new Set();
    state.mergedDefects = [];
    state.frameCount = 0;
    revokeScanFrameUrls();
    const tags = $("accAutoDefectTags");
    if (tags) tags.innerHTML = "";
    const countEl = $("accAutoDefectCount");
    if (countEl) countEl.textContent = "0";
    setScanDoneVisible(false);
    const results = $("accAutoScanResults");
    if (results) results.style.display = "none";
    const defectList = $("accAutoDefectList");
    if (defectList) defectList.innerHTML = "";

    try {
      await fetch(`${API()}/accident/reset-scan`, { method: "POST" });
    } catch (_) {}

    if (mode === "live") {
      const live = $("accAutoLiveScan");
      if (live) live.style.display = "block";
      const upload = $("accAutoUploadScan");
      if (upload) upload.style.display = "none";
      await startAccidentScan();
    } else {
      const upload = $("accAutoUploadScan");
      if (upload) upload.style.display = "block";
      const live = $("accAutoLiveScan");
      if (live) live.style.display = "none";
      resetScanViewport();
      const st = $("accAutoScanStatus");
      if (st) st.textContent = "Select one or more damage photos to analyze.";
      setTimeout(() => {
        const inp = $("accAutoDamageFiles");
        if (inp) inp.click();
      }, 120);
    }
  }

  function backToScanModes() {
    resetScanPanel();
    fetch(`${API()}/accident/reset-scan`, { method: "POST" }).catch(() => {});
  }

  async function startAccidentScan() {
    if (state.scanning || state.scanMode !== "live") return;
    state.scanning = true;
    const video = $("accAutoVideo");
    const preview = $("accAutoUploadPreview");
    const wrap = $("accAutoCamWrap");
    const overlay = $("accAutoScanStatus");
    if (preview) preview.hidden = true;
    if (video) video.style.display = "block";
    if (wrap) wrap.classList.add("is-scanning");
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (video) {
        video.srcObject = state.stream;
        await video.play();
      }
      if (overlay) overlay.textContent = "Walk around your vehicle — AI is detecting damage live…";
      state.scanInterval = setInterval(sendAccidentFrame, 1400);
    } catch (_) {
      toast("Camera access required for live scan", "error");
      if (overlay) overlay.textContent = "Camera blocked — allow camera access or use upload photos instead.";
      state.scanning = false;
    }
  }

  function stopAccidentScan() {
    if (state.scanInterval) clearInterval(state.scanInterval);
    state.scanInterval = null;
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    const video = $("accAutoVideo");
    if (video) video.srcObject = null;
    const wrap = $("accAutoCamWrap");
    if (wrap && state.scanMode === "live") wrap.classList.remove("is-scanning");
    state.scanning = false;
  }

  async function sendAccidentFrame() {
    const video = $("accAutoVideo");
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) return;
    try {
      applyScanFrameResponse(await postScanFrame(blob, "frame.jpg"), blob);
    } catch (e) {
      const st = $("accAutoScanStatus");
      if (st) st.textContent = String(e.message || e);
      toast(String(e.message || e), "error");
    }
  }

  async function processDamageUpload(input) {
    const files = Array.from(input?.files || []).filter(isImageFile);
    if (!files.length) {
      toast("Please choose image files (JPG, PNG, etc.)", "error");
      return;
    }
    if (state.uploadProcessing) return;

    if (!state.scanMode) {
      state.scanMode = "upload";
      const picker = $("accAutoScanModePicker");
      if (picker) picker.style.display = "none";
    }

    state.uploadProcessing = true;
    const st = $("accAutoScanStatus");
    revokeScanFrameUrls();
    state.defectsSeen = new Set();
    state.mergedDefects = [];
    state.frameCount = 0;
    $("accAutoDefectTags") && ($("accAutoDefectTags").innerHTML = "");
    const countEl = $("accAutoDefectCount");
    if (countEl) countEl.textContent = "0";
    setScanDoneVisible(false);
    const defectList = $("accAutoDefectList");
    if (defectList) defectList.innerHTML = "";

    const firstPreview = URL.createObjectURL(files[0]);
    showUploadScanViewport(firstPreview);

    let prepared = [];
    try {
      await fetch(`${API()}/accident/reset-scan`, { method: "POST" });

      setScanHud(`Preparing ${files.length} photo(s)…`, 8);
      prepared = await Promise.all(
        files.map(async (f, i) => ({
          name: f.name || `damage_${i + 1}.jpg`,
          blob: await resizeImageFile(f),
          previewUrl: URL.createObjectURL(f),
        }))
      );

      for (let i = 0; i < prepared.length; i++) {
        const item = prepared[i];
        const previewImg = $("accAutoUploadPreview");
        const wrap = $("accAutoCamWrap");
        if (previewImg) {
          previewImg.src = item.previewUrl;
          bindUploadPreviewAspect(previewImg);
        }
        if (wrap) wrap.classList.remove("has-annotation");
        const overlayImg = $("accAutoOverlay");
        if (overlayImg) overlayImg.removeAttribute("src");

        const pct = Math.round(12 + ((i + 0.35) / prepared.length) * 78);
        setScanHud(`AI scanning photo ${i + 1} of ${prepared.length}…`, pct);
        if (st) st.textContent = `Scanning photo ${i + 1} of ${prepared.length}…`;

        applyScanFrameResponse(await postScanFrame(item.blob, item.name), item.blob);
      }

      stopUploadScanUi();
      const areas = $("accAutoDefectCount")?.textContent || "0";
      if (st) {
        st.textContent = `${files.length} photo(s) scanned · ${areas} damage area(s) detected`;
      }
      renderDamageVisuals();
      renderAccumulatedDefectList();
      setScanDoneVisible(true);
      toast("Damage scan complete", "success");
    } catch (e) {
      stopUploadScanUi();
      if (st) st.textContent = "Could not analyze one or more photos — try again.";
      toast(String(e.message || e), "error");
    } finally {
      preparedPreviewUrls(prepared).forEach((u) => {
        if (u && u !== firstPreview) {
          try {
            URL.revokeObjectURL(u);
          } catch (_) {}
        }
      });
      try {
        URL.revokeObjectURL(firstPreview);
      } catch (_) {}
      state.uploadProcessing = false;
    }
  }

  function preparedPreviewUrls(prepared) {
    return (prepared || []).map((p) => p.previewUrl).filter(Boolean);
  }

  async function finishAccidentScan() {
    if (!state.scanMode) {
      toast("Choose live scan or upload photos first", "error");
      return;
    }
    if (state.frameCount < 1) {
      toast(
        state.scanMode === "upload" ? "Upload at least one damage photo" : "Capture at least one scan frame",
        "error"
      );
      return;
    }
    stopAccidentScan();
    const btn = $("accAutoScanDone");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Building AI report…";
    }
    const m = state.mulkiya || {};
    const fd = new FormData();
    fd.append("vin", m.vin || "");
    fd.append("make", m.make || "");
    fd.append("vehicle_model", m.bodyType || m.model || "");
    fd.append("year", m.year || "");
    fd.append("mileage", m.mileage || "");
    try {
      const res = await fetch(`${API()}/accident/finalize-scan`, { method: "POST", body: fd });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(payload, "Scan finalize failed"));
      state.scanData = payload;
      const paths = payload.annotated_images || [];
      paths.forEach((p, i) => {
        if (state.scanFrames[i]) state.scanFrames[i].annotatedPath = p;
      });
      renderDamageVisuals();
      renderDefectList();
      toast("Damage scan complete", "success");
      goToNext();
    } catch (e) {
      toast(String(e.message || e), "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Continue →";
      }
    }
  }

  async function startVoiceNote() {
    if (state.voiceRecording || state.intakeProcessing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      voiceRecorder = new MediaRecorder(stream);
      voiceRecorder.ondataavailable = (e) => {
        if (e.data.size) voiceChunks.push(e.data);
      };
      voiceRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setVoiceRecordingUi(false);
        setIntakeComposerBusy(true);
        const st = $("accAutoVoiceStatus");
        if (st) st.textContent = "Transcribing with Groq Whisper…";
        const blob = new Blob(voiceChunks, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, "accident_voice.webm");
        try {
          const res = await fetch(`${API()}/accident/voice-intake`, { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(parseApiError(data, "Voice intake failed"));
          applyVoiceIntakeResult(data);
          toast("Voice note processed", "success");
        } catch (e) {
          if (st) st.textContent = "Voice processing failed — try again.";
          toast(String(e.message || e), "error");
        } finally {
          setIntakeComposerBusy(false);
          voiceRecorder = null;
        }
      };
      voiceRecorder.start();
      setVoiceRecordingUi(true);
    } catch (_) {
      setVoiceRecordingUi(false);
      toast("Microphone access required", "error");
    }
  }

  function stopVoiceNote() {
    if (voiceRecorder && voiceRecorder.state !== "inactive") voiceRecorder.stop();
  }

  function toggleVoiceRecording() {
    if (state.voiceRecording) stopVoiceNote();
    else startVoiceNote();
  }

  function onIncidentTextKeydown(e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    submitTextIntake();
  }

  function previewPlateFile(file) {
    if (!file || !isImageFile(file)) return;
    revokePlatePreview();
    state.platePreviewUrl = URL.createObjectURL(file);
    const wrap = $("accAutoPlatePreviewWrap");
    const img = $("accAutoPlatePreviewImg");
    if (img) img.src = state.platePreviewUrl;
    if (wrap) wrap.style.display = "";
    const card = $("accAutoPlateConfirmCard");
    if (card) {
      card.style.display = "none";
      card.innerHTML = "";
    }
    const cont = $("accAutoPlateContinue");
    if (cont) cont.style.display = "none";
  }

  function previewPoliceFile(file) {
    if (!file || !isImageFile(file)) return;
    revokePolicePreview();
    state.policePreviewUrl = URL.createObjectURL(file);
    const wrap = $("accAutoPolicePreviewWrap");
    const img = $("accAutoPolicePreviewImg");
    if (img) img.src = state.policePreviewUrl;
    if (wrap) wrap.style.display = "";
    const badges = $("accAutoPoliceBadges");
    if (badges) {
      badges.innerHTML = "";
      badges.style.display = "none";
    }
    const cont = $("accAutoPoliceContinue");
    if (cont) cont.style.display = "none";
  }

  function renderPlateConfirmCard() {
    const card = $("accAutoPlateConfirmCard");
    const cont = $("accAutoPlateContinue");
    if (!card) return;
    const plate = state.plateOcr || {};
    const ins = state.tpInsurance || {};
    card.innerHTML = `
      <h4>Plate confirmed</h4>
      <div><strong>Plate:</strong> ${plate.plate_number || "—"}${plate.emirate ? ` · ${plate.emirate}` : ""}</div>
      <div><strong>RTA insurer:</strong> ${ins.insurance_company || "—"}${ins.policy_number ? ` · ${ins.policy_number}` : ""}</div>`;
    card.style.display = "";
    if (cont) cont.style.display = "";
  }

  function renderPoliceBadges() {
    const root = $("accAutoPoliceBadges");
    const cont = $("accAutoPoliceContinue");
    const police = state.policeOcr || {};
    if (!root) return;
    const ref = police.police_reference || "—";
    const track = labelize(police.reporting_track || "self_report");
    const claim = labelize(police.claim_type || "comprehensive");
    root.innerHTML = `
      <span class="acc-auto-conf-badge">Ref ${ref}</span>
      <span class="acc-auto-conf-badge">Track: ${track}</span>
      <span class="acc-auto-conf-badge">Claim: ${claim}</span>`;
    root.style.display = "";
    if (cont) cont.style.display = "";
  }

  async function parsePlateEvidence() {
    const plateInput = $("accAutoPlateFile");
    const file = plateInput?.files?.[0];
    if (!file) {
      toast("Photograph the other vehicle's plate", "error");
      return;
    }
    if (state.plateParsing) return;
    state.plateParsing = true;
    const cont = $("accAutoPlateContinue");
    if (cont) cont.style.display = "none";
    const card = $("accAutoPlateConfirmCard");
    if (card) {
      card.style.display = "none";
      card.innerHTML = "<p>Reading plate &amp; RTA insurer…</p>";
      card.style.display = "";
    }
    const fd = new FormData();
    fd.append("plate_image", file);
    try {
      const res = await fetch(`${API()}/accident/parse-evidence`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(j, "Plate parse failed"));
      state.plateOcr = j.plate_ocr || {};
      state.tpInsurance = j.third_party_insurance || {};
      renderPlateConfirmCard();
      toast("Plate & insurer confirmed", "success");
    } catch (e) {
      if (card) {
        card.innerHTML = "<p>Could not read plate photo — try again.</p>";
        card.style.display = "";
      }
      toast(String(e.message || e), "error");
    } finally {
      state.plateParsing = false;
    }
  }

  async function parsePoliceEvidence() {
    const policeInput = $("accAutoPoliceFile");
    const file = policeInput?.files?.[0];
    if (!file) {
      toast("Photograph the police / Muroor app screen", "error");
      return;
    }
    if (state.policeParsing) return;
    state.policeParsing = true;
    const st = $("accAutoPoliceStatus");
    if (st) st.textContent = "Reading police reference & claim type…";
    const cont = $("accAutoPoliceContinue");
    if (cont) cont.style.display = "none";
    const fd = new FormData();
    fd.append("police_image", file);
    try {
      const res = await fetch(`${API()}/accident/parse-evidence`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(j, "Police parse failed"));
      state.policeOcr = j.police_ocr || {};
      if (st) {
        st.textContent = state.policeOcr.police_reference
          ? `Police reference ${state.policeOcr.police_reference} confirmed.`
          : "Police screen captured.";
      }
      renderPoliceBadges();
      toast("Police evidence confirmed", "success");
    } catch (e) {
      if (st) st.textContent = "Could not read police screenshot — try again.";
      toast(String(e.message || e), "error");
    } finally {
      state.policeParsing = false;
    }
  }

  function resolveNotifyInsurer() {
    const ownerIns = (state.mulkiya || {}).insuranceCompany || "";
    if (state.faultStance === "at_fault") return ownerIns;
    const tpIns = state.tpInsurance?.insurance_company || "";
    if (needsPlateStep() && tpIns) return tpIns;
    return ownerIns;
  }

  function renderGarageSuggest(garages) {
    const root = $("accAutoGarageSuggest");
    if (!root) return;
    const g = state.suggestedGarage || garages?.[0] || {};
    if (!g.name) {
      root.style.display = "none";
      root.innerHTML = "";
      return;
    }
    root.innerHTML = `
      <strong>Suggested approved garage</strong>
      ${g.name} · ${g.address || ""}${g.rating ? ` · ★ ${g.rating}` : ""}${g.distance_km ? ` · ${g.distance_km} km` : ""}`;
    root.style.display = "";
  }

  async function selectFaultStance(stance) {
    if (stance !== "victim" && stance !== "at_fault") return;
    state.faultStance = stance;
    document.querySelectorAll("#sec-reportAccident .acc-auto-fault-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.fault === stance);
    });
    const insurer = resolveNotifyInsurer();
    try {
      const res = await fetch(
        `${API()}/accident/approved-garages?insurer=${encodeURIComponent(insurer)}`
      );
      const j = await res.json().catch(() => ({}));
      const garages = j.garages || [];
      state.suggestedGarage = garages[0] || {};
      renderGarageSuggest(garages);
    } catch (_) {
      state.suggestedGarage = {};
      renderGarageSuggest([]);
    }
    const submit = $("accAutoSubmitBtn");
    if (submit) submit.disabled = false;
  }

  function renderConfirmSummary() {
    const root = $("accAutoConfirmBody");
    if (!root) return;
    const m = state.mulkiya || {};
    const meta = state.metadata || {};
    const police = state.policeOcr || {};
    const v = state.voiceIntake || {};
    const ai = (state.scanData && state.scanData.ai_analysis) || {};
    const scanMethod = state.scanMode === "upload" ? "Uploaded photos" : "Live camera scan";
    const otherLabel = needsPlateStep() ? "Yes — other vehicle" : "No — single vehicle";
    root.innerHTML = `
      <div class="acc-auto-confirm-grid">
        <div><label>Vehicle</label><strong>${[m.make, m.bodyType, m.year].filter(Boolean).join(" ") || "—"}</strong></div>
        <div><label>Your insurer</label><strong>${m.insuranceCompany || "—"}</strong></div>
        <div><label>Other vehicles</label><strong>${otherLabel}</strong></div>
        <div><label>Incident</label><strong>${labelize(v.incident_type)} · ${v.injuries_label || (v.injuries ? "Injuries" : "No injuries")}</strong></div>
        <div><label>Damage capture</label><strong>${scanMethod}</strong></div>
        <div><label>When</label><strong>${meta.incident_date || "—"} ${meta.incident_time || ""}</strong></div>
        <div><label>Where</label><strong>${meta.incident_location || meta.reverse_geocode || "GPS captured"}</strong></div>
        <div><label>Weather / light</label><strong>${meta.weather || "—"} · ${meta.lighting || "—"}</strong></div>
        <div><label>Damage areas</label><strong>${state.scanData?.unique_defect_types ?? "—"} (AI pre-assessment)</strong></div>
        <div><label>Other plate</label><strong>${state.plateOcr?.plate_number || (needsPlateStep() ? "—" : "N/A")}</strong></div>
        <div><label>Third-party insurer</label><strong>${state.tpInsurance?.insurance_company || (needsPlateStep() ? "—" : "N/A")}</strong></div>
        <div><label>Police ref</label><strong>${police.police_reference || "—"}</strong></div>
        <div><label>Track / claim</label><strong>${labelize(police.reporting_track)} · ${labelize(police.claim_type)}</strong></div>
        <div><label>Health score</label><strong>${ai.health_score ?? "—"}/100</strong></div>
      </div>
      <p class="acc-auto-disclaimer">Cost estimate is <strong>pre-assessment only</strong>. Official bilingual PDF will be blockchain-sealed and sent to your insurer API.</p>`;

    state.faultStance = null;
    state.suggestedGarage = null;
    document.querySelectorAll("#sec-reportAccident .acc-auto-fault-btn").forEach((btn) => {
      btn.classList.remove("selected");
    });
    const garage = $("accAutoGarageSuggest");
    if (garage) {
      garage.innerHTML = "";
      garage.style.display = "none";
    }
    const submit = $("accAutoSubmitBtn");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Confirm & submit to insurer";
    }
  }

  async function submitAccidentAutoClaim() {
    const uid = global._currentUser?.uid;
    if (!uid) return toast("Please log in", "error");
    if (!state.scanData) return toast("Complete the damage scan first", "error");
    if (!state.voiceIntake) return toast("Record your voice note first", "error");
    if (!state.faultStance) return toast("Select your fault position", "error");
    if (!state.policeOcr?.police_reference && !state.policeOcr?.claim_type) {
      return toast("Capture police / Muroor confirmation first", "error");
    }

    const btn = $("accAutoSubmitBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting to insurer…";
    }
    const m = state.mulkiya || {};
    let ownerName = global._currentUser?.email || "";
    try {
      const meta = await global._fsGetDoc(global._fsDoc(global._fbDb, "users", uid, "profile", "meta"));
      if (meta.exists() && meta.data().owner) {
        const o = meta.data().owner;
        ownerName = [o.firstName, o.lastName].filter(Boolean).join(" ") || ownerName;
      }
    } catch (_) {}

    const payload = {
      ownerId: uid,
      ownerName,
      ownerEmail: global._currentUser?.email || "",
      mulkiya: m,
      scan_data: state.scanData,
      voice: state.voiceIntake,
      plate_ocr: state.plateOcr || {},
      police_ocr: state.policeOcr || {},
      third_party_insurance: state.tpInsurance || {},
      metadata: state.metadata || {},
      gps_lat: state.metadata?.gps_lat ?? null,
      gps_lon: state.metadata?.gps_lon ?? null,
      reverse_geocode: state.metadata?.reverse_geocode || state.metadata?.incident_location || "",
      fault_stance: state.faultStance,
      suggested_garage: state.suggestedGarage || {},
    };

    try {
      const hdr = await authHdr();
      const res = await fetch(`${API()}/accident/auto-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(hdr || {}) },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseApiError(j, "Submit failed"));

      const claim = j.claim || {};
      const claimId = j.claim_id || claim.id;
      const tpLookup = j.third_party_owner_lookup || {};

      if (global._fsSetDoc && global._fbDb) {
        const timeline = [
          global.pushClaimTicketEventPayload?.({
            ts: Date.now(),
            type: "ticket_opened",
            actor: "owner",
            message: `Auto accident report submitted — ${claim.insurerReference || claimId}.`,
          }) || { ts: Date.now(), type: "ticket_opened", actor: "owner", message: "Auto flow submitted" },
        ];
        await global._fsSetDoc(global._fsDoc(global._fbDb, "insuranceClaims", claimId), {
          ...claim,
          ticketTimeline: timeline,
        });
        if (typeof global.syncAccidentToRta === "function") {
          await global.syncAccidentToRta({ ...claim, id: claimId });
        }
        if (typeof global.notifyUser === "function") {
          const pdfLink = j.official_report_url
            ? ` <a href="${API()}${j.official_report_url}" target="_blank">Official Accident Report</a>`
            : "";
          await global.notifyUser(
            uid,
            `Accident submitted — insurer ref <strong>${claim.insurerReference || "—"}</strong>.${pdfLink}`,
            "confirmed"
          );
          if (tpLookup.found && tpLookup.ownerId) {
            const plate = tpLookup.plate || state.plateOcr?.plate_number || "your vehicle";
            await global.notifyUser(
              tpLookup.ownerId,
              `An accident claim was filed involving plate <strong>${plate}</strong> on AutoVault. Check My Claims for details.`,
              "alert"
            );
          }
        }
        if (j.car_life_event && global._fsCollection) {
          try {
            await global._fsAddDoc(global._fsCollection(global._fbDb, "users", uid, "inspections"), {
              ...j.car_life_event,
              status: "accident",
              role: "accident_auto",
            });
          } catch (_) {}
        }
      }

      const suc = $("accAutoSuccess");
      const ref = $("accAutoSuccessRef");
      if (ref) ref.textContent = claim.insurerReference || claimId;
      if (suc) suc.style.display = "";
      $("accAutoConfirmPanel") && ($("accAutoConfirmPanel").style.display = "none");
      toast(`Claim ${claim.insurerReference || claimId} received by insurer`, "success");
      setTimeout(() => {
        if (typeof global.portalGoTo === "function") global.portalGoTo("myClaims");
      }, 2500);
    } catch (e) {
      toast(String(e.message || e), "error");
    } finally {
      if (btn) {
        btn.disabled = !state.faultStance;
        btn.textContent = "Confirm & submit to insurer";
      }
    }
  }

  function onEvidenceFileChange(e) {
    const id = e.target?.id;
    const file = e.target?.files?.[0];
    if (!file) return;
    if (id === "accAutoPlateFile") {
      previewPlateFile(file);
      parsePlateEvidence();
    }
    if (id === "accAutoPoliceFile") {
      previewPoliceFile(file);
      parsePoliceEvidence();
    }
  }

  function onAccAutoClick(e) {
    const root = document.getElementById("sec-reportAccident");
    if (!root || !root.contains(e.target)) return;

    const faultBtn = e.target.closest(".acc-auto-fault-btn");
    if (faultBtn?.dataset?.fault) {
      e.preventDefault();
      selectFaultStance(faultBtn.dataset.fault);
      return;
    }

    const modeBtn = e.target.closest("#accAutoScanModePicker [data-mode]");
    if (modeBtn) {
      e.preventDefault();
      chooseScanMode(modeBtn.getAttribute("data-mode"));
      return;
    }

    const id = e.target.closest("button")?.id || e.target.id;
    switch (id) {
      case "accAutoBackLive":
      case "accAutoBackUpload":
        e.preventDefault();
        backToScanModes();
        break;
      case "accAutoScanDone":
        e.preventDefault();
        finishAccidentScan();
        break;
      case "accAutoVoiceMic":
        e.preventDefault();
        toggleVoiceRecording();
        break;
      case "accAutoTextSend":
        e.preventDefault();
        submitTextIntake();
        break;
      case "accAutoToScan":
        e.preventDefault();
        if (!state.voiceIntake) {
          toast("Describe the incident first", "error");
          return;
        }
        goToNext();
        break;
      case "accAutoPlateContinue":
        e.preventDefault();
        if (!state.plateOcr?.plate_number) {
          toast("Confirm plate photo first", "error");
          return;
        }
        goToNext();
        break;
      case "accAutoPoliceContinue":
        e.preventDefault();
        if (!state.policeOcr?.reporting_track && !state.policeOcr?.claim_type) {
          toast("Confirm police screenshot first", "error");
          return;
        }
        goToNext();
        break;
      case "accAutoSubmitBtn":
        e.preventDefault();
        submitAccidentAutoClaim();
        break;
      default:
        break;
    }
  }

  function onAccAutoChange(e) {
    const id = e.target?.id;
    if (id === "accAutoDamageFiles") processDamageUpload(e.target);
    else if (id === "accAutoPlateFile" || id === "accAutoPoliceFile") onEvidenceFileChange(e);
  }

  function wireAccAutoUi() {
    const root = document.getElementById("sec-reportAccident");
    if (!root) return;
    if (!root.dataset.accAutoWired) {
      root.dataset.accAutoWired = "1";
      root.addEventListener("click", onAccAutoClick);
      root.addEventListener("change", onAccAutoChange);
      const ta = $("accAutoIncidentText");
      if (ta && !ta.dataset.accAutoWired) {
        ta.dataset.accAutoWired = "1";
        ta.addEventListener("keydown", onIncidentTextKeydown);
      }
    }
  }

  async function initAccidentAutoFlow() {
    wireAccAutoUi();
    stopAccidentScan();
    state.scanData = null;
    state.voiceIntake = null;
    state.plateOcr = null;
    state.policeOcr = null;
    state.tpInsurance = null;
    state.faultStance = null;
    state.suggestedGarage = null;
    resetVoicePanel();
    resetScanPanel();
    resetPlatePanel();
    resetPolicePanel();
    $("accAutoSuccess") && ($("accAutoSuccess").style.display = "none");
    $("accAutoConfirmPanel") && ($("accAutoConfirmPanel").style.display = "");
    await loadVehicleContext();
    captureSilentMetadata();
    setStep(1);
  }

  global.initAccidentAutoFlow = initAccidentAutoFlow;
  global.wireAccAutoUi = wireAccAutoUi;
  global.accAutoChooseScanMode = chooseScanMode;
  global.accAutoBackToScanModes = backToScanModes;
  global.accAutoProcessDamageUpload = processDamageUpload;
  global.accAutoFinishScan = finishAccidentScan;
  global.accAutoStartVoice = startVoiceNote;
  global.accAutoStopVoice = stopVoiceNote;
  global.accAutoToggleVoice = toggleVoiceRecording;
  global.accAutoSubmitTextIntake = submitTextIntake;
  global.accAutoParsePlate = parsePlateEvidence;
  global.accAutoParsePolice = parsePoliceEvidence;
  global.accAutoGoStep = setStep;
  global.accAutoGoNext = goToNext;
  global.goToNext = goToNext;
  global.submitAccidentAutoClaim = submitAccidentAutoClaim;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireAccAutoUi);
  } else {
    wireAccAutoUi();
  }
})(typeof window !== "undefined" ? window : globalThis);
