        // ─── AI Panel ─────────────────────────────────────────────────────────────────
        function renderAIPanel(ai) {
            const panel = document.getElementById('aiAnalysisPanel');
            if (!panel) return;
            const score = ai.health_score || 0;
            const risk = (ai.risk_level || 'Low').toLowerCase();
            const riskLbl = ai.risk_level || 'Low';
            const summary = ai.summary || '';
            const recs = ai.recommendations || [];
            const factors = ai.risk_factors || [];
            const scoreColor = score >= 75 ? '#4ade80' : score >= 50 ? '#f59e0b' : '#ff4444';
            const R = 34;
            const CIRC = 2 * Math.PI * R;
            const dash = CIRC - (score / 100) * CIRC;
            const scoreDesc = score >= 85 ? 'Excellent condition' : score >= 70 ? 'Good — minor issues' : score >= 50 ? 'Fair — attention needed' : score >= 30 ? 'Poor — repairs required' : 'Critical — unsafe';
            const barStyle = score >= 75 ? 'background:#4ade80' : score >= 50 ? 'background:#f59e0b' : 'background:#ff4444';
            const riskEmoji = risk === 'low' ? '🟢' : risk === 'medium' ? '🟡' : risk === 'high' ? '🟠' : '🔴';
            panel.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel-header"><span class="ai-panel-badge">✦ Groq AI</span><span class="ai-panel-title">AI Vehicle Health Assessment</span></div>
      <div class="ai-panel-body">
        <div class="health-score-wrap">
          <div class="health-score-ring">
            <svg viewBox="0 0 90 90">
              <circle class="hsr-track" cx="45" cy="45" r="${R}"/>
              <circle class="hsr-fill" cx="45" cy="45" r="${R}" stroke="${scoreColor}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" id="healthRingFill"/>
            </svg>
            <div class="health-score-val"><span class="hsv-num" style="color:${scoreColor}">${score}</span><span class="hsv-lbl">/ 100</span></div>
          </div>
          <div class="health-score-info">
            <div class="hsi-label">Vehicle Health Score</div>
            <div class="hsi-bar"><div class="hsi-bar-fill" id="healthBarFill" style="width:0%;${barStyle}"></div></div>
            <div class="hsi-desc">${scoreDesc}</div>
          </div>
        </div>
        <div class="risk-card">
          <div class="risk-card-label">Risk Assessment</div>
          <div class="risk-badge-lg ${risk}">${riskEmoji} ${riskLbl} Risk</div>
          ${factors.length ? `<div class="risk-factors-list">${factors.map(f => `<div class="rf-item">${f}</div>`).join('')}</div>` : ''}
        </div>
        <div class="ai-recs-box">
          <div class="ai-recs-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>AI Recommendations</div>
          ${recs.map((r, i) => `<div class="ai-rec-item"><div class="ai-rec-num">${i + 1}</div><div>${r}</div></div>`).join('')}
        </div>
        <div class="ai-summary-box">
          <div class="ai-summary-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>AI Summary — Powered by Groq LLaMA 3.3</div>
          <div class="ai-summary-text">${summary}</div>
        </div>
      </div>
    </div>`;
            panel.style.display = 'block';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const ring = document.getElementById('healthRingFill');
                if (ring) ring.style.strokeDashoffset = String(dash);
                const bar = document.getElementById('healthBarFill');
                if (bar) bar.style.width = score + '%';
            }));
        }

        function showAILoading() {
            const panel = document.getElementById('aiAnalysisPanel');
            if (!panel) return;
            panel.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel-header"><span class="ai-panel-badge">✦ Groq AI</span><span class="ai-panel-title">AI Vehicle Health Assessment</span></div>
      <div class="ai-loading-state"><div class="spinner spinner-light"></div><p>Groq LLaMA 3.3 is analysing your vehicle...</p></div>
    </div>`;
            panel.style.display = 'block';
        }

        // ─── Generate report ───────────────────────────────────────────────────────────
        let _generateRunning = false;
        async function generateReport() {
            if (_generateRunning) return;
            if (!state.batchDone) return toast('Please complete body inspection first', 'error');
            _generateRunning = true;
            showAILoading();
            const btnGen = document.getElementById('btnGenerate');
            const loading = document.getElementById('generateLoading');
            btnGen.style.display = 'none';
            loading.style.display = 'flex';

            function restoreGenerateUI() {
                loading.style.display = 'none';
                btnGen.style.display = 'inline-flex';
                _generateRunning = false;
                document.getElementById('aiAnalysisPanel').style.display = 'none';
            }

            try {
                if (state.liveCameraResult) {
                    const fd = new FormData(); appendVehicleInfo(fd);
                    const res = await fetch(`${API}/finalize-live-detection`, { method: 'POST', body: fd });
                    if (!res.ok) throw new Error((await res.json()).detail || 'Report failed');
                    const data = await res.json();
                    state.reportReady = true;
                    if (data.defects_detected && data.defects_detected.length) {
                        state.batchDefects = data.defects_detected;
                        state.liveCameraResult.defects_detected = data.defects_detected;
                        state.liveCameraResult.unique_defect_types = data.unique_defect_types || 0;
                    }
                    loading.style.display = 'none';
                    _generateRunning = false;
                    toast('✓ Report generated!', 'success');
                    if (data.ai_analysis) renderAIPanel(data.ai_analysis);
                    renderResults({ ...data, defects_detected: data.defects_detected || state.batchDefects, annotated_images: data.annotated_images || state.batchAnnotated });
                } else {
                    let filteredDefects = [];
                    let filteredAnnotated = [];
                    if (state.perImageDefects.length > 0) {
                        state.perImageDefects.forEach((img, i) => {
                            if (!state.crossedIndices.has(i)) {
                                filteredDefects.push(...img.defects);
                                if (img.annotated) filteredAnnotated.push(img.annotated);
                            }
                        });
                    } else {
                        filteredDefects = [...state.batchDefects];
                        filteredAnnotated = state.batchAnnotated.filter((_, i) => !state.crossedIndices.has(i));
                    }
                    const ar = state.audioResult;
                    const payload = {
                        defects_detected: filteredDefects,
                        annotated_images: filteredAnnotated,
                        image_count: state.files.length - state.crossedIndices.size,
                        unique_defect_types: new Set(filteredDefects.map(d => (Array.isArray(d) ? d[0] : d.label || '').toLowerCase()).filter(Boolean)).size,
                        vehicle_info: {
                            vin: document.getElementById('vin').value || '',
                            make: document.getElementById('make').value || '',
                            model: document.getElementById('model').value || '',
                            year: document.getElementById('year').value || '',
                            mileage: document.getElementById('mileage').value || '',
                        },
                        engine_result: ar ? { verdict: ar.verdict || '', is_knock: ar.is_knock, confidence: ar.confidence || 0, duration_s: ar.duration_s || 0 } : null,
                        inspection_type: _currentRole === 'garage' ? _garageServiceType : 'owner',
                    };
                    const res = await fetch(`${API}/generate-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    if (!res.ok) throw new Error((await res.json()).detail || 'Report failed');
                    const data = await res.json();
                    state.reportReady = true;
                    loading.style.display = 'none';
                    _generateRunning = false;
                    toast('✓ Report generated!', 'success');
                    if (data.ai_analysis) renderAIPanel(data.ai_analysis);
                    renderResults({ ...data, defects_detected: filteredDefects, annotated_images: filteredAnnotated });
                }
            } catch (e) {
                toast(e.message, 'error');
                restoreGenerateUI();
            }
        }

        function renderResults(data) {
            const defects = data.defects_detected || [];
            const defectsNorm = defects.map(d => Array.isArray(d) ? d : [d.label || d.class || 'Unknown', d.confidence || 0]);
            const ut = data.unique_defect_types != null
                ? data.unique_defect_types
                : new Set(defectsNorm.map(d => (d[0] || '').toLowerCase()).filter(Boolean)).size;
            const verdict = ut === 0 ? 'PASS' : ut <= 2 ? 'ATTENTION' : 'FAIL';
            const vc = verdict === 'PASS' ? 'pass' : verdict === 'ATTENTION' ? 'attention' : 'fail';
      // Group by BASE PART for the verdict display
const grouped = {};
defectsNorm.forEach(([n, c]) => {
    const partName = n.includes(' — ') ? n.split(' — ')[0].trim() : n;
    const sevName  = n.includes(' — ') ? n.split(' — ')[1].trim() : null;
    const k = partName.toLowerCase();
    if (!grouped[k] || grouped[k].max < c) {
        grouped[k] = { name: partName, sev: sevName, full: n, max: c };
    }
});
const gl = Object.values(grouped).sort((a, b) => b.max - a.max);
            const annotated = data.annotated_images || [];
            const ar = data.engine_result || state.audioResult;
            const ts = Date.now();
            const svcBadge = _currentRole === 'garage'
                ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;font-size:.72rem;font-weight:700;font-family:'JetBrains Mono',monospace;background:${_garageServiceType === 'accident' ? 'rgba(255,68,68,.1)' : 'rgba(200,216,228,.08)'};color:${_garageServiceType === 'accident' ? 'var(--red)' : 'var(--c)'};border:1px solid ${_garageServiceType === 'accident' ? 'rgba(255,68,68,.25)' : 'var(--border)'};margin-bottom:12px">${_garageServiceType === 'accident' ? '🚨 ACCIDENT REPAIR' : '🔧 ROUTINE SERVICE'}</div>`
                : '';
            let html = `<div class="results-panel">
    ${svcBadge}
    <div class="result-hero">
      <div class="verdict-box ${vc}"><div class="verdict-label">Overall Verdict</div><div class="verdict-status">${verdict}</div><div class="verdict-sub">${ut} unique defect type${ut !== 1 ? 's' : ''} detected</div></div>
      <div class="panel" style="padding:20px">
        <div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tm);margin-bottom:14px;font-family:'JetBrains Mono',monospace">Detected Components</div>
        ${gl.length
? `<div class="defect-list">${gl.map(d => {
    const tier      = d.max >= 80 ? 'severe' : d.max >= 55 ? 'moderate' : 'minor';
    const tierColor = tier === 'severe' ? '#ff4444' : tier === 'moderate' ? '#f59e0b' : '#4ade80';
    const sevLabel  = d.sev || (tier.charAt(0).toUpperCase() + tier.slice(1));
    return `<div class="ditem">
        <div class="ditem-name">${d.name}
            <span style="font-size:0.62rem;font-weight:800;padding:1px 7px;border-radius:8px;
                background:${tierColor}18;color:${tierColor};border:1px solid ${tierColor}30;
                margin-left:8px;font-family:'JetBrains Mono',monospace;">${sevLabel}</span>
        </div>
        <div class="ditem-bar"><div class="ditem-fill" style="width:${d.max}%"></div></div>
        <div class="ditem-conf">${d.max}%</div>
    </div>`;
}).join('')}</div>`                    : `<div style="color:var(--green);font-weight:600;padding:8px 0">✓ No damage detected</div>`}
      </div>
    </div>`;
            if (ar) {
                const ec = ar.is_knock ? 'knock' : 'clean';
                html += `<div class="panel" style="border:1px solid ${ec === 'knock' ? 'rgba(255,68,68,.3)' : 'rgba(74,222,128,.3)'};background:${ec === 'knock' ? 'rgba(255,68,68,.04)' : 'rgba(74,222,128,.04)'};padding:20px">
      <div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tm);margin-bottom:12px;font-family:'JetBrains Mono',monospace">Engine Audio Result</div>
      <div style="display:flex;align-items:center;gap:12px"><div style="font-size:2rem">${ar.is_knock ? '⚠️' : '✅'}</div>
      <div><div style="font-weight:700;font-size:1rem;margin-bottom:4px">${ar.is_knock ? 'KNOCK DETECTED' : 'ENGINE HEALTHY'}</div>
      <div style="font-size:.82rem;color:var(--tm);font-family:'JetBrains Mono',monospace">Verdict: ${ar.verdict || 'N/A'} — Confidence: ${ar.confidence || 0}%</div></div></div></div>`;
            }
            if (annotated.length) {
                html += `<div class="panel"><div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tm);margin-bottom:14px;font-family:'JetBrains Mono',monospace">Annotated Images (${annotated.length})</div>
      <div class="ann-grid">${annotated.map((p, i) => `<div class="ann-img"><img src="${API}/${p}?t=${ts}" alt="Annotated ${i + 1}" onerror="this.alt='N/A'"><div class="ann-img-label">Image ${i + 1}</div></div>`).join('')}</div></div>`;
            }
            html += `<div class="action-row" style="margin-top:8px">
    <a href="${API}/report?t=${ts}" target="_blank" class="btn btn-primary" style="text-decoration:none"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download PDF Report</a>
    <button class="btn btn-ghost" onclick="startNewInspection()">Start New Inspection</button>
  </div></div>`;
            const area = document.getElementById('resultsArea');
            area.innerHTML = html; area.style.display = 'block';
            if (pdfOption === 'preview') {
                const pdfSection = document.getElementById('pdfViewerSection');
                document.getElementById('pdfViewerFrame').src = `${API}/report?t=${ts}`;
                pdfSection.style.display = 'block';
            }
            area.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function startNewInspection() {
            _recordingCancelled = true;
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
                try { _mediaRecorder.stop(); } catch (e) { }
            }
            cleanupRecordingUI();
            lcStopStreamOnly();
            _lcStopInProgress = false;
            _batchRunning = false;
            _audioRunning = false;
            _generateRunning = false;
            state = freshState();
            lcAllDefectsCollected = [];
            ['vin', 'make', 'model', 'year', 'mileage'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            const pG = document.getElementById('imgPreviewGrid'); if (pG) pG.innerHTML = '';
            const bA = document.getElementById('btnAnalyze'); if (bA) bA.style.display = 'none';
            const ir = document.getElementById('inlineResults'); if (ir) ir.classList.remove('visible');
            document.getElementById('audioResult').style.display = 'none';
            document.getElementById('audioUploadCard').style.display = 'block';
            document.getElementById('audioAnalysisLoader').style.display = 'none';
            document.getElementById('audioDropZone').style.display = 'block';
            document.getElementById('audioFileCard').style.display = 'none';
            document.getElementById('recordedFileCard').style.display = 'none';
            document.getElementById('recIdleState').style.display = 'block';
            document.getElementById('recActiveState').style.display = 'none';
            document.getElementById('audioInput').value = '';
            const ap = document.getElementById('audioPlayerEl'); ap.pause(); ap.src = '';
            const rp = document.getElementById('recordedPlayerEl'); rp.pause(); rp.src = '';
            document.getElementById('resultsArea').style.display = 'none';
            document.getElementById('pdfViewerSection').style.display = 'none';
            // Clear stale gallery
document.getElementById('resGalleryGrid').innerHTML = '';
document.getElementById('resDefectGrid').innerHTML = '';
document.getElementById('inlineResults').classList.remove('visible');
state.batchAnnotated = [];
state.batchDefects = [];
state.perImageDefects = [];
state.crossedIndices = new Set();
            document.getElementById('aiAnalysisPanel').style.display = 'none';
            document.getElementById('btnGenerate').style.display = 'inline-flex';
            document.getElementById('generateLoading').style.display = 'none';
            document.getElementById('mscUpload').classList.add('active');
            document.getElementById('mscLive').classList.remove('active');
            switchAudioMode('upload');
            setPdfOption('preview');
            setStep(1);
            toast('Ready for new inspection', 'info');
        }

        // ─── Chatbot ────────────────────────────────────────────────────────────────
        window.toggleChatbot = function () {
            document.getElementById('chatbotWindow').classList.toggle('active');
        }
        window.sendChatMessage = function () {
            const inp = document.getElementById('cbInput');
            const txt = inp.value.trim();
            if (!txt) return;
            inp.value = '';
            const body = document.getElementById('cbBody');
            body.innerHTML += `<div class="cb-msg user">${txt}</div>`;
            body.scrollTop = body.scrollHeight;

            setTimeout(() => {
                let reply = "I'm a local assistant. For deep technical questions, please consult a real mechanic.";
                const l = txt.toLowerCase();
                if (l.includes('status') || l.includes('booking')) reply = "Check the Inbox section for your booking updates.";
                else if (l.includes('hello') || l.includes('hi')) reply = "Hello! How can I assist you today?";
                else if (l.includes('inspect') || l.includes('report')) reply = "Start an inspection from the sidebar and follow the instructions.";

                body.innerHTML += `<div class="cb-msg bot">${reply}</div>`;
                body.scrollTop = body.scrollHeight;
            }, 600);
        }

        // ─── Init ──────────────────────────────────────────────────────────────────────
