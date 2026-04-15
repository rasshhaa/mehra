        // ─── Live camera ───────────────────────────────────────────────────────────────
        let lcStream = null, lcInterval = null, lcIsProcessing = false;
        let lcCaptures = 0, lcDetected = 0, lcDefectSet = new Set();
        let lcAllDefectsCollected = [];
        let _lcStopInProgress = false;

        async function lcRefreshCameras() {
            const sel = document.getElementById('lcCameraSelect');
            try {
                const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                tmp.getTracks().forEach(t => t.stop());
                const devices = await navigator.mediaDevices.enumerateDevices();
                const cams = devices.filter(d => d.kind === 'videoinput');
                sel.innerHTML = '<option value="">Auto (Default Camera)</option>';
                cams.forEach((d, i) => {
                    const o = document.createElement('option');
                    o.value = d.deviceId;
                    o.textContent = d.label || `Camera ${i + 1}`;
                    if ((d.label || '').toLowerCase().includes('ivcam')) o.textContent = '📱 ' + o.textContent;
                    sel.appendChild(o);
                });
                toast(`Found ${cams.length} camera(s)`, 'info');
            } catch (e) { toast('Camera permission needed', 'error'); }
        }

        async function lcStartCamera() {
            try {
                const deviceId = document.getElementById('lcCameraSelect').value;
                const constraints = { video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } } };
                lcStream = await navigator.mediaDevices.getUserMedia(constraints);
                document.getElementById('lcVideo').srcObject = lcStream;
                document.getElementById('lcVideoContainer').style.display = 'block';
                document.getElementById('liveStatsRow').style.display = 'grid';
                document.getElementById('lcBtnStart').style.display = 'none';
                document.getElementById('lcBtnStop').style.display = 'inline-flex';
                document.getElementById('lcResultsSection').style.display = 'none';
                document.getElementById('lcStatus').innerHTML = '';
                lcCaptures = 0; lcDetected = 0; lcDefectSet.clear(); lcAllDefectsCollected = [];
                ['lcHudDetected', 'lcHudCaptures', 'lcStatDetected', 'lcStatCaptures'].forEach(id => document.getElementById(id).textContent = '0');
                document.getElementById('lcStatStatus').textContent = 'LIVE';
                document.getElementById('lcDefectTags').innerHTML = '';
                _lcStopInProgress = false;
                lcInterval = setInterval(lcSendFrame, 1500);
                const sel = document.getElementById('lcCameraSelect');
                toast(`Camera started: ${sel.options[sel.selectedIndex]?.text || 'Default'}`, 'success');
            } catch (err) { lcShowStatus('Camera access denied: ' + err.message, 'error'); }
        }

        async function lcSendFrame() {
            if (lcIsProcessing) return;
            lcIsProcessing = true;
            const video = document.getElementById('lcVideo');
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            canvas.getContext('2d').drawImage(video, 0, 0);
            canvas.toBlob(async (blob) => {
                try {
                    const fd = new FormData(); fd.append('file', blob, 'frame.jpg');
                    const res = await fetch(`${API}/detect-live`, { method: 'POST', body: fd });
                    if (!res.ok) return;
                    const data = await res.json();
                    lcDetected = data.unique_defects || 0;
                    lcCaptures = data.total_captures || 0;
                    document.getElementById('lcHudDetected').textContent = lcDetected;
                    document.getElementById('lcHudCaptures').textContent = lcCaptures;
                    document.getElementById('lcStatDetected').textContent = lcDetected;
                    document.getElementById('lcStatCaptures').textContent = lcCaptures;
                    if (data.defects && data.defects.length) {
                        data.defects.forEach(d => {
                            lcAllDefectsCollected.push([d.class, d.confidence]);
                            const k = (d.class || '').toLowerCase();
                            if (!lcDefectSet.has(k)) {
                                lcDefectSet.add(k);
                                const tags = document.getElementById('lcDefectTags');
                                const tag = document.createElement('div'); tag.className = 'dtag new';
                                tag.textContent = `${d.class} ${d.confidence}%`;
                                tags.appendChild(tag);
                                setTimeout(() => tag.classList.remove('new'), 500);
                            }
                        });
                    }
                    if (data.new_capture) {
                        const con = document.getElementById('lcVideoContainer');
                        const ex = con.querySelector('.capture-badge'); if (ex) ex.remove();
                        const b = document.createElement('div'); b.className = 'capture-badge'; b.textContent = '📸 Captured!';
                        con.appendChild(b); setTimeout(() => b.remove(), 900);
                    }
                } catch (e) { }
                finally { lcIsProcessing = false; }
            }, 'image/jpeg', 0.9);
        }

        async function lcStopCamera() {
            if (_lcStopInProgress) return;
            _lcStopInProgress = true;
            const stopBtn = document.getElementById('lcBtnStop');
            const startBtn = document.getElementById('lcBtnStart');
            stopBtn.disabled = true;
            lcStopStreamOnly();
            document.getElementById('lcStatStatus').textContent = 'STOPPED';
            stopBtn.style.display = 'none';
            startBtn.style.display = 'inline-flex';
            startBtn.textContent = '▶ Resume';
            stopBtn.disabled = false;
            if (lcCaptures > 0) {
                lcShowStatus('<div style="display:flex;align-items:center;gap:10px;justify-content:center"><div class="spinner spinner-light"></div> Finalizing captures...</div>', 'info');
                try {
                    const res = await fetch(`${API}/get-captured-images`);
                    const data = await res.json();
                    const paths = (data.images || []).map(i => i.path);
                    const defectMap = {};
                    lcAllDefectsCollected.forEach(([name, conf]) => {
                        const k = (name || '').toLowerCase();
                        if (!defectMap[k] || defectMap[k][1] < conf) defectMap[k] = [name, conf];
                    });
                    const deduped = Object.values(defectMap);
                    state.batchAnnotated = paths;
                    state.batchDefects = deduped;
                    state.batchDone = true;
                    state.perImageDefects = [];
                    state.liveCameraResult = { annotated_images: paths, defects_detected: deduped, unique_defect_types: lcDetected };
                    state._historySaved = false;
                    await saveInspectionToHistory({
                        defects_detected: deduped,
                        annotated_images: paths,
                        unique_defect_types: lcDetected,
                        engine_result: null
                    });
                    lcDisplayResults(paths);
                } catch (e) {
                    lcShowStatus('Error fetching captures: ' + e.message, 'error');
                    _lcStopInProgress = false;
                }
            } else {
                lcShowStatus('No defects detected. Try capturing the vehicle from different angles.', 'error');
                try { await fetch(`${API}/reset-live-detection`, { method: 'POST' }); } catch (e) { }
                _lcStopInProgress = false;
            }
        }

        function lcStopStreamOnly() {
            if (lcInterval) { clearInterval(lcInterval); lcInterval = null; }
            if (lcStream) { lcStream.getTracks().forEach(t => t.stop()); lcStream = null; }
        }

        function lcDisplayResults(paths) {
            lcShowStatus('', '');
            const grid = document.getElementById('lcAnnotatedGrid'); const ts = Date.now();
            grid.innerHTML = paths.map((p, i) =>
                `<div class="ann-img"><img src="${API}/${p}?t=${ts}" alt="Capture ${i + 1}" onerror="this.alt='Image unavailable'"><div class="ann-img-label">Capture ${i + 1}</div></div>`
            ).join('');
            document.getElementById('lcSumCaptures').textContent = paths.length;
            document.getElementById('lcSumDefects').textContent = lcDetected;
            document.getElementById('lcResultsSection').style.display = 'block';
            document.getElementById('lcResultsSection').scrollIntoView({ behavior: 'smooth' });
            toast(`✅ ${paths.length} annotated image(s) captured`, 'success');
        }

        function lcGoToAudio() { returnFromLiveCamera(); setStep(3); }
        function lcGoToReport() { returnFromLiveCamera(); setStep(4); }

        function lcReset() {
            lcStopStreamOnly();
            lcCaptures = 0; lcDetected = 0; lcDefectSet.clear(); lcAllDefectsCollected = [];
            _lcStopInProgress = false;
            document.getElementById('lcVideoContainer').style.display = 'none';
            document.getElementById('liveStatsRow').style.display = 'none';
            document.getElementById('lcResultsSection').style.display = 'none';
            document.getElementById('lcBtnStart').style.display = 'inline-flex';
            document.getElementById('lcBtnStart').textContent = '▶ Start Camera';
            document.getElementById('lcBtnStop').style.display = 'none';
            document.getElementById('lcBtnStop').disabled = false;
            document.getElementById('lcDefectTags').innerHTML = '';
            document.getElementById('lcStatus').innerHTML = '';
            try { fetch(`${API}/reset-live-detection`, { method: 'POST' }); } catch (e) { }
            toast('Live detection reset', 'info');
        }

        function lcShowStatus(msg, type) {
            const el = document.getElementById('lcStatus');
            if (!msg) { el.innerHTML = ''; return; }
            const cm = { info: 'rgba(200,216,228,.1)', error: 'rgba(255,68,68,.08)', success: 'rgba(74,222,128,.08)' };
            const bm = { info: 'rgba(200,216,228,.3)', error: 'rgba(255,68,68,.3)', success: 'rgba(74,222,128,.3)' };
            el.innerHTML = `<div style="margin-top:16px;padding:16px 20px;border-radius:12px;background:${cm[type] || cm.info};border:1px solid ${bm[type] || bm.info};font-size:.875rem;text-align:center">${msg}</div>`;
        }

