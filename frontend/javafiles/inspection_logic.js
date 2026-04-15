        // ═══════════════════════════════════════════════════════════════════════════════
        // INSPECTION LOGIC
        // ═══════════════════════════════════════════════════════════════════════════════

        let _scanTimer = null;
        function showScanOverlay(files) {
            const strip = document.getElementById('scanImgStrip'); strip.innerHTML = '';
            const show = Array.from(files).slice(0, 5);
            show.forEach((f, i) => {
                const url = URL.createObjectURL(f);
                const slot = document.createElement('div');
                slot.className = 'scan-img-slot'; slot.id = `scanSlot${i}`;
                slot.innerHTML = `<img src="${url}"><div class="scan-corner tl"></div><div class="scan-corner tr"></div><div class="scan-corner bl"></div><div class="scan-corner br"></div><div class="scan-line"></div><div class="done-tick">✓</div>`;
                strip.appendChild(slot);
            });
            if (files.length > 5) {
                const m = document.createElement('div');
                m.style.cssText = 'display:flex;align-items:center;justify-content:center;color:var(--tm);font-family:"JetBrains Mono",monospace;font-size:.8rem;padding:0 8px';
                m.textContent = `+${files.length - 5} more`; strip.appendChild(m);
            }
            setScanProgress(0, 'Preparing images...');
            document.getElementById('scanOverlay').classList.add('active');
            let pi = 0, ii = 0; const tsl = show.length;
            const phases = [[8, 'Loading image data...'], [20, 'Running visual preprocessing...'], [35, 'Detecting vehicle components...'], [52, 'Analyzing damage patterns...'], [66, 'Running confidence scoring...'], [78, 'Cross-referencing defect library...'], [88, 'Generating annotations...'], [94, 'Compiling results...'], [98, 'Finalizing...']];
            _scanTimer = setInterval(() => {
                if (pi < phases.length) {
                    const [pct, msg] = phases[pi];
                    setScanProgress(pct, msg);
                    const sp = Math.floor((pi / phases.length) * tsl);
                    if (sp !== ii && sp < tsl) {
                        document.getElementById(`scanSlot${ii}`)?.classList.remove('active-scan');
                        document.getElementById(`scanSlot${ii}`)?.classList.add('done-scan');
                        ii = sp;
                        document.getElementById(`scanSlot${ii}`)?.classList.add('active-scan');
                    }
                    pi++;
                }
            }, 420);
            if (show.length) document.getElementById('scanSlot0')?.classList.add('active-scan');
        }
        function setScanProgress(pct, msg) {
            document.getElementById('scanProgressFill').style.width = pct + '%';
            document.getElementById('scanProgressPct').textContent = pct + '%';
            if (msg) document.getElementById('scanStatusMsg').textContent = msg;
        }
        function hideScanOverlay() {
            clearInterval(_scanTimer);
            document.querySelectorAll('.scan-img-slot').forEach(s => { s.classList.remove('active-scan'); s.classList.add('done-scan'); });
            setScanProgress(100, 'Analysis complete ✓');
            setTimeout(() => document.getElementById('scanOverlay').classList.remove('active'), 700);
        }

        function setStep(n) {
    for (let i = 1; i <= 4; i++) {
        const c = document.getElementById('step' + i);
        const p = document.getElementById('ps' + i);
        if (c) c.style.display = i === n ? 'block' : 'none';
        if (p) {
            p.classList.remove('active', 'done');
            if (i < n) p.classList.add('done');
            else if (i === n) p.classList.add('active');
        }
    }
    state.step = n;

    if (n === 1) {
        loadMulkiyaData();     // ← Add this line
    }
    if (n === 4) buildSummaryCards();
}
        function nextStep(n) {
            setStep(n);
            const sec = document.getElementById('sec-inspection');
            if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        function selectMode(m) {
            state.mode = m;
            document.getElementById('mscUpload').classList.toggle('active', m === 'upload');
        }
        function setPdfOption(o) {
            pdfOption = o;
            document.getElementById('pdfOptDownload').classList.toggle('active', o === 'download');
            document.getElementById('pdfOptPreview').classList.toggle('active', o === 'preview');
        }

        function handleFiles(files) {
            for (const f of files) {
                if (f.type.startsWith('image/') && !state.files.find(x => x.name === f.name && x.size === f.size))
                    state.files.push(f);
            }
            renderPreviews();
        }
        function handleDrop(e) {
            e.preventDefault();
            document.getElementById('uploadZone').classList.remove('drag');
            handleFiles(e.dataTransfer.files);
        }
        function renderPreviews() {
            const grid = document.getElementById('imgPreviewGrid'); grid.innerHTML = '';
            state.files.forEach((f, i) => {
                const url = URL.createObjectURL(f);
                const div = document.createElement('div'); div.className = 'img-thumb';
                div.innerHTML = `<img src="${url}"><button class="img-thumb-rm" onclick="removeFile(${i})">✕</button>`;
                grid.appendChild(div);
            });
            document.getElementById('btnAnalyze').style.display = state.files.length ? 'inline-flex' : 'none';
        }
        function removeFile(i) { state.files.splice(i, 1); renderPreviews(); }

        let _batchRunning = false;
        async function runBatchInspection() {
            if (_batchRunning) return;
            if (!state.files.length) return toast('Please add at least one image', 'error');
            _batchRunning = true;
            const btn = document.getElementById('btnAnalyze');
            btn.disabled = true; btn.style.display = 'none';
            state._historySaved = false;
            state.liveCameraResult = null;
            showScanOverlay(state.files);
            document.getElementById('inlineResults').classList.remove('visible');
            document.getElementById('resGalleryGrid').innerHTML = '';
document.getElementById('resDefectGrid').innerHTML = '';
state.batchAnnotated = [];
state.perImageDefects = [];
            const fd = new FormData();
            state.files.forEach(f => fd.append('files', f));
            appendVehicleInfo(fd);
            try {
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for cold starts
const res = await fetch(`${API}/inspect`, { method: 'POST', body: fd, signal: controller.signal })
    .catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error('Analysis timed out after 2 minutes — please try again');
        throw err;
    });
clearTimeout(timeoutId);
      if (!res.ok) throw new Error((await res.json()).detail || 'Inspection failed');
                const data = await res.json();
state.batchDefects  = data.defects_detected  || [];
state.batchEnriched = data.defects_enriched   || [];  // ← ADD THIS              
state.batchAnnotated = data.annotated_images || [];
                state.batchDone = true;
                state.crossedIndices = new Set();
                const annotated = data.annotated_images || [];
                const allDef = data.defects_detected || [];
                const totalFiles = state.files.length;
                state.perImageDefects = [];
                let di = 0;
                const pic = annotated.length > 0 ? Math.ceil(allDef.length / annotated.length) : 0;
                for (let i = 0; i < totalFiles; i++) {
                    const mp = annotated.find(p => p.includes(`_${i}.`)) || null;
                    if (mp) { state.perImageDefects.push({ defects: allDef.slice(di, di + pic), annotated: mp }); di += pic; }
                    else state.perImageDefects.push({ defects: [], annotated: null });
                }
                await saveInspectionToHistory(data);
                hideScanOverlay();
                populateInlineResults(data);
                toast(`✓ Analysis complete — ${data.total_defects_detected || state.batchDefects.length} defects found`, 'success');
  } catch (e) {
    hideScanOverlay();
    console.error("Inspection API Error:", e);
    const msg = e.name === 'AbortError'
        ? 'Analysis timed out — Roboflow may be cold-starting, try again in 30s'
        : (e.message || 'Failed to process images. Please try again.');
    toast(msg, 'error');
    document.getElementById('btnAnalyze').style.display = 'inline-flex';
    document.getElementById('btnAnalyze').disabled = false;
}
            _batchRunning = false;
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Re-Analyze';
            btn.disabled = false; btn.style.display = 'inline-flex';
        }

        function populateInlineResults(data) {
            const annotated = data.annotated_images || [];
            const imgCount = data.image_count || state.files.length;
            const ts = Date.now();
const enrichedByImage = data.defects_enriched
    ? _groupEnrichedByImage(data.defects_enriched, data.annotated_images || [])
    : null;            const gallery = document.getElementById('resGalleryGrid'); gallery.innerHTML = '';
            const crossSVG = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="4" x2="96" y2="96" stroke="rgba(255,68,68,0.85)" stroke-width="3" stroke-linecap="round"/><line x1="96" y1="4" x2="4" y2="96" stroke="rgba(255,68,68,0.85)" stroke-width="3" stroke-linecap="round"/></svg>`;
        // Only render slots that actually have annotated images
// For un-annotated uploads (no detections), show the original preview instead
const totalUploaded = state.files.length || imgCount;

for (let i = 0; i < totalUploaded; i++) {
    const item = document.createElement('div');
    item.className = 'res-gallery-item'; item.dataset.imgIndex = i;

    if (annotated[i]) {
        // Annotated image exists — show it normally
       item.innerHTML = `
    <img src="${API}/${annotated[i]}?t=${Date.now()}&r=${Math.random()}"
                 alt="Annotated ${i + 1}" 
                 onerror="this.src=''; this.closest('.res-gallery-item').classList.add('img-load-error')">
            <div class="res-cross-overlay">${crossSVG}</div>
            <div class="res-gallery-badge">IMG ${i + 1}</div>
            <div class="res-gallery-sub-badge" style="position:absolute;bottom:8px;left:8px;background:rgba(74,222,128,0.9);color:#000;font-size:0.6rem;font-weight:800;padding:2px 7px;border-radius:6px;font-family:'JetBrains Mono',monospace;">ANNOTATED</div>
            <button class="res-gallery-dismiss" title="Exclude from report" onclick="toggleGalleryItem(this)">✕</button>`;

    } else if (state.files[i]) {
        // No annotation for this image — show original upload with "No defects" badge
        const originalUrl = URL.createObjectURL(state.files[i]);
        item.innerHTML = `
            <img src="${originalUrl}" alt="Image ${i + 1}" style="opacity:0.6">
            <div class="res-cross-overlay" style="opacity:0.3">${crossSVG}</div>
            <div class="res-gallery-badge">IMG ${i + 1}</div>
            <div class="res-gallery-sub-badge" style="position:absolute;bottom:8px;left:8px;background:rgba(200,216,228,0.85);color:#0a1628;font-size:0.6rem;font-weight:800;padding:2px 7px;border-radius:6px;font-family:'JetBrains Mono',monospace;">NO DEFECTS</div>
            <button class="res-gallery-dismiss" title="Exclude from report" onclick="toggleGalleryItem(this)" style="opacity:0.6">✕</button>`;
        // Mark as already crossed since no defects — don't include in report count
        item.classList.add('no-defects-img');

    } else {
        // Fallback — no file reference either (live camera case)
        item.innerHTML = `
            <div class="res-gallery-placeholder" style="opacity:0.4">
                <span style="font-size:1.5rem">✓</span>
                <p style="font-size:0.75rem;color:var(--tm)">Image ${i + 1}<br>No defects found</p>
            </div>
            <div class="res-gallery-badge">IMG ${i + 1}</div>`;
        item.classList.add('no-defects-img');
    }

    gallery.appendChild(item);
}
            refreshInlineStats();
            document.getElementById('inlineResults').classList.add('visible');
            setTimeout(() => document.getElementById('inlineResults').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
        function _groupEnrichedByImage(enriched, annotatedPaths) {
    // Groups enriched defect dicts by image index (best effort)
    // Returns array of arrays matching annotatedPaths order
    const result = annotatedPaths.map(() => []);
    enriched.forEach((d, i) => {
        const imgIdx = i % Math.max(1, annotatedPaths.length);
        result[imgIdx].push(d);
    });
    return result;
}

function _getSeverityTierColor(tier) {
    return tier === 'severe'   ? '#ff4444'
         : tier === 'moderate' ? '#f59e0b'
         : '#4ade80';
}

        function refreshInlineStats() {
    let active = [];
    if (state.perImageDefects.length > 0) {
        state.perImageDefects.forEach((img, i) => {
            if (!state.crossedIndices.has(i)) active.push(...img.defects);
        });
    } else {
        active = [...state.batchDefects];
    }

    const totalImgs = state.perImageDefects.length || state.batchAnnotated.length || state.files.length;
    document.getElementById('resImgCount').textContent = totalImgs - state.crossedIndices.size;

    // Group by BASE PART (strip " — SeverityClass" suffix from dual-model labels)
    const grouped = {};
    active.forEach(d => {
        const rawName = Array.isArray(d) ? (d[0] || 'Unknown') : (d.label || d.class || 'Unknown');
        const conf    = Array.isArray(d) ? (d[1] || 0) : (d.confidence || 0);
        // Extract part name — everything before " — "
        const partName = rawName.includes(' — ') ? rawName.split(' — ')[0].trim() : rawName;
        const sevName  = rawName.includes(' — ') ? rawName.split(' — ')[1].trim() : null;
        const key = partName.toLowerCase();
        if (!grouped[key] || grouped[key].conf < conf) {
            grouped[key] = { name: partName, sev: sevName, conf, full: rawName };
        }
    });

    const sorted = Object.values(grouped).sort((a, b) => b.conf - a.conf);

    const defEl = document.getElementById('resDefectCount');
    defEl.textContent = sorted.length;
    defEl.className = 'res-stat-val ' + (sorted.length === 0 ? 'green' : sorted.length <= 2 ? 'yellow' : 'red');

    const avg = active.length
        ? Math.round(active.reduce((s, d) => s + (Array.isArray(d) ? d[1] : d.confidence || 0), 0) / active.length)
        : 0;
    const cEl = document.getElementById('resConfidence');
    cEl.textContent = avg + '%';
    cEl.className = 'res-stat-val ' + (avg >= 80 ? 'green' : avg >= 60 ? 'yellow' : 'red');

    const dg = document.getElementById('resDefectGrid');
    dg.innerHTML = '';

    if (!sorted.length) {
        dg.innerHTML = `<div class="res-no-defects">✅ No damage detected — vehicle looks clean!</div>`;
    } else {
        sorted.forEach(({ name, sev, conf }) => {
            const tier      = conf >= 80 ? 'severe' : conf >= 55 ? 'moderate' : 'minor';
            const tierColor = tier === 'severe' ? '#ff4444' : tier === 'moderate' ? '#f59e0b' : '#4ade80';
            const sevLabel  = sev || (tier.charAt(0).toUpperCase() + tier.slice(1));

            const row = document.createElement('div');
            row.className = 'res-defect-row';
            row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)';
            row.innerHTML = `
                <div class="res-defect-name" style="font-weight:700">${name}</div>
                <span style="font-size:0.65rem;font-weight:800;padding:2px 8px;border-radius:10px;
                    background:${tierColor}18;color:${tierColor};border:1px solid ${tierColor}30;
                    font-family:'JetBrains Mono',monospace;white-space:nowrap">${sevLabel}</span>
                <div class="res-defect-conf" style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:var(--tm)">${conf}%</div>
            `;
            // Bar
            const barWrap = document.createElement('div');
            barWrap.style.cssText = 'grid-column:1/-1;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:-4px;';
            const barFill = document.createElement('div');
            barFill.style.cssText = `width:0%;height:100%;border-radius:2px;background:${tierColor};transition:width 0.6s ease`;
            barWrap.appendChild(barFill);
            row.appendChild(barWrap);
            dg.appendChild(row);
            requestAnimationFrame(() => requestAnimationFrame(() => { barFill.style.width = conf + '%'; }));
        });
    }
}

        function toggleGalleryItem(btn) {
            const item = btn.closest('.res-gallery-item');
            const idx = parseInt(item.dataset.imgIndex, 10);
            const crossed = item.classList.toggle('crossed');
            if (crossed) state.crossedIndices.add(idx); else state.crossedIndices.delete(idx);
            btn.title = crossed ? 'Restore' : 'Exclude from report';
            btn.textContent = crossed ? '↩' : '✕';
            refreshInlineStats();
            toast(crossed ? `Image ${idx + 1} excluded from report` : `Image ${idx + 1} restored`, 'info');
        }

