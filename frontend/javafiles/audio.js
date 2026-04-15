        // ─── Audio ─────────────────────────────────────────────────────────────────────
        function switchAudioMode(mode) {
            document.getElementById('tabUploadAudio').classList.toggle('active', mode === 'upload');
            document.getElementById('tabRecordAudio').classList.toggle('active', mode === 'record');
            document.getElementById('audioModeUpload').style.display = mode === 'upload' ? 'block' : 'none';
            document.getElementById('audioModeRecord').style.display = mode === 'record' ? 'block' : 'none';
        }

        function handleAudioDrop(e) {
            e.preventDefault();
            document.getElementById('audioDropZone').classList.remove('drag');
            const f = e.dataTransfer.files[0];
            if (f && f.type.startsWith('audio/')) { state.audioFile = f; showAudioFileCard(f); }
            else toast('Please drop an audio file', 'error');
        }
        function handleAudioFile(input) {
            const f = input.files[0]; if (!f) return;
            state.audioFile = f; showAudioFileCard(f);
        }
        function showAudioFileCard(f) {
            document.getElementById('audioFileNameText').textContent = f.name;
            document.getElementById('audioFileMeta').textContent = `${(f.size / 1024).toFixed(1)} KB · ${f.type || 'audio'}`;
            document.getElementById('audioDropZone').style.display = 'none';
            document.getElementById('audioFileCard').style.display = 'block';
            const player = document.getElementById('audioPlayerEl');
            player.src = URL.createObjectURL(f); player.load();
        }
        function removeAudioFile() {
            state.audioFile = null;
            document.getElementById('audioInput').value = '';
            document.getElementById('audioDropZone').style.display = 'block';
            document.getElementById('audioFileCard').style.display = 'none';
            document.getElementById('audioResult').style.display = 'none';
            const p = document.getElementById('audioPlayerEl'); p.pause(); p.src = '';
        }
        function resetAudioInput() {
            state.audioFile = null;
            document.getElementById('audioResult').style.display = 'none';
            const mode = document.getElementById('audioModeRecord').style.display === 'block' ? 'record' : 'upload';
            if (mode === 'record') {
                clearRecording();
            } else {
                document.getElementById('audioInput').value = '';
                document.getElementById('audioDropZone').style.display = 'block';
                document.getElementById('audioFileCard').style.display = 'none';
                const p = document.getElementById('audioPlayerEl'); p.pause(); p.src = '';
            }
        }

        let _mediaRecorder = null, _recordedChunks = [], _recTimerInterval = null, _recSeconds = 0;
        let _audioContext = null, _analyserNode = null, _micStream = null, _waveAnimId = null;
        let _recordingCancelled = false;

        async function startRecording() {
            try {
                _micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            } catch (e) { toast('Microphone access denied', 'error'); return; }
            _recordedChunks = []; _recordingCancelled = false;
            const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
                .find(m => MediaRecorder.isTypeSupported(m)) || '';
            _mediaRecorder = new MediaRecorder(_micStream, mimeType ? { mimeType } : {});
            _mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) _recordedChunks.push(e.data); };
            _mediaRecorder.onstop = () => { if (!_recordingCancelled) finalizeRecording(); };
            _mediaRecorder.start(100);
            document.getElementById('recIdleState').style.display = 'none';
            document.getElementById('recActiveState').style.display = 'block';
            document.getElementById('liveRecZone').classList.add('recording');
            _recSeconds = 0; document.getElementById('recTimer').textContent = '00:00';
            _recTimerInterval = setInterval(() => {
                _recSeconds++;
                const m = Math.floor(_recSeconds / 60).toString().padStart(2, '0');
                const s = (_recSeconds % 60).toString().padStart(2, '0');
                document.getElementById('recTimer').textContent = `${m}:${s}`;
            }, 1000);
            const wavesEl = document.getElementById('recWaves'); wavesEl.innerHTML = '';
            const bars = []; const barCount = 20;
            for (let i = 0; i < barCount; i++) {
                const b = document.createElement('div'); b.className = 'rec-wave-bar'; b.style.height = '4px';
                wavesEl.appendChild(b); bars.push(b);
            }
            _audioContext = new (window.AudioContext || window.webkitAudioContext)();
            _analyserNode = _audioContext.createAnalyser(); _analyserNode.fftSize = 64;
            const src = _audioContext.createMediaStreamSource(_micStream); src.connect(_analyserNode);
            const buf = new Uint8Array(_analyserNode.frequencyBinCount);
            function animWave() {
                _waveAnimId = requestAnimationFrame(animWave);
                _analyserNode.getByteFrequencyData(buf);
                const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
                document.getElementById('recMeterFill').style.width = Math.min(100, (avg / 128) * 100) + '%';
                bars.forEach((b, i) => { const v = buf[i % buf.length] || 0; b.style.height = Math.max(4, (v / 255) * 36) + 'px'; });
            }
            animWave();
        }

        function stopRecording() {
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
            cleanupRecordingUI();
        }
        function cancelRecording() {
            _recordingCancelled = true;
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
            _recordedChunks = [];
            cleanupRecordingUI();
            document.getElementById('recIdleState').style.display = 'block';
            document.getElementById('recActiveState').style.display = 'none';
        }
        function cleanupRecordingUI() {
            clearInterval(_recTimerInterval);
            cancelAnimationFrame(_waveAnimId);
            document.getElementById('liveRecZone').classList.remove('recording');
            if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
            if (_audioContext) { try { _audioContext.close(); } catch (e) { } _audioContext = null; }
        }
        function finalizeRecording() {
            if (!_recordedChunks.length) { toast('No audio recorded', 'error'); return; }
            const mimeType = _mediaRecorder.mimeType || 'audio/webm';
            const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
            const blob = new Blob(_recordedChunks, { type: mimeType });
            const filename = `engine_recording_${Date.now()}.${ext}`;
            state.audioFile = new File([blob], filename, { type: mimeType });
            document.getElementById('recActiveState').style.display = 'none';
            document.getElementById('recIdleState').style.display = 'block';
            document.getElementById('recordedFileName').textContent = filename;
            document.getElementById('recordedFileMeta').textContent = `${_recSeconds}s · ${(blob.size / 1024).toFixed(1)} KB · ${mimeType}`;
            document.getElementById('recordedFileCard').style.display = 'block';
            const player = document.getElementById('recordedPlayerEl');
            player.src = URL.createObjectURL(blob); player.load();
            toast('Recording complete — ready to analyze', 'success');
        }
        function clearRecording() {
            state.audioFile = null; _recordedChunks = [];
            document.getElementById('recordedFileCard').style.display = 'none';
            document.getElementById('recActiveState').style.display = 'none';
            document.getElementById('recIdleState').style.display = 'block';
            const p = document.getElementById('recordedPlayerEl'); p.pause(); p.src = '';
            document.getElementById('audioResult').style.display = 'none';
        }
        async function analyzeRecordedAudio() {
            if (!state.audioFile) return toast('No recording available', 'error');
            await runEngineAnalysis();
        }

        let _alcTimer = null, _alcWave = null;
        let _audioModeBeforeAnalysis = 'upload';
        function showAudioLoader(filename) {
            _audioModeBeforeAnalysis = document.getElementById('audioModeRecord').style.display === 'block' ? 'record' : 'upload';
            document.getElementById('audioUploadCard').style.display = 'none';
            document.getElementById('audioAnalysisLoader').style.display = 'block';
            document.getElementById('audioResult').style.display = 'none';
            document.getElementById('alc-file-name').textContent = filename || 'Processing...';
            document.getElementById('alcProgressFill').style.width = '0%';
            document.getElementById('alcProgressPct').textContent = '0%';
            for (let i = 0; i < 5; i++) { const s = document.getElementById(`alcStep${i}`); if (s) s.classList.remove('active', 'done'); }
            const canvas = document.getElementById('alcWaveCanvas'); const ctx = canvas.getContext('2d'); let t = 0;
            function draw() {
                canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
                const W = canvas.width, H = canvas.height; ctx.clearRect(0, 0, W, H);
                ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(200,216,228,0.6)'; ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(200,216,228,0.3)';
                ctx.beginPath();
                for (let x = 0; x < W; x++) {
                    const amp = (H / 2) * 0.6 * (0.5 + 0.5 * Math.sin(x * 0.015 + t * 0.5));
                    const y = H / 2 + amp * Math.sin(x * 0.04 + t) + (amp * 0.3) * Math.sin(x * 0.084 + t * 1.3);
                    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                }
                ctx.stroke(); t += 0.06; _alcWave = requestAnimationFrame(draw);
            }
            draw();
            const steps = [[15, 0], [35, 1], [58, 2], [78, 3], [92, 4]]; let si = 0;
            _alcTimer = setInterval(() => {
                if (si < steps.length) {
                    const [pct, idx] = steps[si];
                    if (si > 0) { const prev = document.getElementById(`alcStep${steps[si - 1][1]}`); if (prev) { prev.classList.remove('active'); prev.classList.add('done'); } }
                    const cur = document.getElementById(`alcStep${idx}`); if (cur) cur.classList.add('active');
                    document.getElementById('alcProgressFill').style.width = pct + '%';
                    document.getElementById('alcProgressPct').textContent = pct + '%';
                    si++;
                }
            }, 500);
        }
        function hideAudioLoader() {
            clearInterval(_alcTimer); cancelAnimationFrame(_alcWave);
            for (let i = 0; i < 5; i++) { const s = document.getElementById(`alcStep${i}`); if (s) { s.classList.remove('active'); s.classList.add('done'); } }
            document.getElementById('alcProgressFill').style.width = '100%';
            document.getElementById('alcProgressPct').textContent = '100%';
            setTimeout(() => {
                document.getElementById('audioAnalysisLoader').style.display = 'none';
                document.getElementById('audioUploadCard').style.display = 'block';
                switchAudioMode(_audioModeBeforeAnalysis);
            }, 400);
        }

        let _audioRunning = false;
        async function runEngineAnalysis() {
            if (_audioRunning || !state.audioFile) return;
            _audioRunning = true;
            const analyzeBtn = document.getElementById('btnAnalyzeAudio');
            const recordBtn = document.getElementById('btnAnalyzeRecording');
            if (analyzeBtn) analyzeBtn.disabled = true;
            if (recordBtn) recordBtn.disabled = true;
            showAudioLoader(state.audioFile.name);
            const fd = new FormData(); fd.append('audio', state.audioFile);
            try {
                const res = await fetch(`${API}/analyze-engine`, { method: 'POST', body: fd });
                if (!res.ok) throw new Error((await res.json()).detail || 'Audio analysis failed');
                const data = await res.json();
                state.audioResult = data;
                hideAudioLoader();
                renderAudioResult(data);
                document.getElementById('audioResult').style.display = 'block';
                document.getElementById('audioResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                toast(data.is_knock ? '⚠ Engine knock detected!' : '✓ Engine sounds healthy', data.is_knock ? 'error' : 'success');
            } catch (e) {
                hideAudioLoader();
                toast(e.message, 'error');
            }
            _audioRunning = false;
            if (analyzeBtn) analyzeBtn.disabled = false;
            if (recordBtn) recordBtn.disabled = false;
        }

        function renderAudioResult(data) {
            const el = document.getElementById('audioResult');
            const cls = data.is_knock ? 'knock' : 'clean';
            const icon = data.is_knock ? '⚠️' : '✅';
            const headline = data.is_knock ? 'KNOCK DETECTED' : 'ENGINE HEALTHY';
            const subtitle = data.is_knock
                ? 'Pre-detonation signatures found — mechanic inspection recommended'
                : 'No knock signatures detected — engine sounds healthy';
            const topScores = [...(data.scores || [])].sort((a, b) => b.score - a.score).slice(0, 5);
            el.innerHTML = `<div class="audio-result-rich ${cls}">
    <div class="arr-header"><div class="arr-verdict-badge">${icon}</div><div class="arr-verdict-text"><h3>${headline}</h3><p>${subtitle}</p></div></div>
    <div class="arr-body">
      <div class="arr-metrics">
        <div class="arr-metric"><div class="arr-metric-val">${data.confidence || 0}%</div><div class="arr-metric-lbl">Confidence</div></div>
        <div class="arr-metric"><div class="arr-metric-val">${data.duration_s || 0}s</div><div class="arr-metric-lbl">Duration</div></div>
        <div class="arr-metric"><div class="arr-metric-val" style="font-size:.9rem">${(data.verdict || 'N/A').slice(0, 12)}</div><div class="arr-metric-lbl">Verdict Label</div></div>
      </div>
      ${topScores.length ? `<div class="arr-scores-title">Model Confidence Breakdown</div>${topScores.map(s => `<div class="arr-score-row"><div class="arr-score-label">${s.label}</div><div class="arr-score-bar"><div class="arr-score-fill" style="width:0%" data-w="${(s.score * 100).toFixed(1)}"></div></div><div class="arr-score-pct">${(s.score * 100).toFixed(1)}%</div></div>`).join('')}` : ''}
      <div class="action-row" style="margin-top:16px">
        <button style="background:rgba(200,216,228,.08);color:var(--c);border:1px solid rgba(200,216,228,.25);padding:10px 20px;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;font-family:'Syne',sans-serif;display:inline-flex;align-items:center;gap:8px" onclick="resetAudioInput()">↺ Try Another</button>
        <button class="btn btn-primary" onclick="nextStep(4)" style="padding:10px 20px;font-size:.875rem">Continue to Report →</button>
      </div>
    </div>
  </div>`;
            setTimeout(() => { el.querySelectorAll('.arr-score-fill').forEach(b => { b.style.width = b.dataset.w + '%'; }); }, 80);
        }

        function buildSummaryCards() {
            const vin = document.getElementById('vin').value || 'N/A';
            const make = document.getElementById('make').value || 'N/A';
            const model = document.getElementById('model').value || 'N/A';
            const defects = state.batchDefects || [];
            const defCount = new Set(defects.map(d => (Array.isArray(d) ? d[0] : d.label || '').trim().toLowerCase()).filter(Boolean)).size;
            const ar = state.audioResult;
            const audioSt = ar ? (ar.is_knock ? '⚠ Knock' : '✓ Healthy') : '—';
            const svcLabel = _currentRole === 'garage' ? `<div style="font-size:.72rem;color:${_garageServiceType === 'accident' ? 'var(--red)' : 'var(--c)'};margin-top:4px;font-family:'JetBrains Mono',monospace">${_garageServiceType === 'accident' ? '🚨 Accident Repair' : '🔧 Routine Service'}</div>` : '';
            document.getElementById('summaryCards').innerHTML = `
    <div class="panel" style="text-align:center;padding:20px">
      <div style="font-size:.75rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;font-family:'JetBrains Mono',monospace;margin-bottom:8px">Vehicle</div>
      <div style="font-weight:700;font-size:1.05rem">${make} ${model}</div>
      <div style="font-size:.8rem;color:var(--td);margin-top:4px">${vin}</div>${svcLabel}
    </div>
    <div class="panel" style="text-align:center;padding:20px">
      <div style="font-size:.75rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;font-family:'JetBrains Mono',monospace;margin-bottom:8px">Defect Types</div>
      <div style="font-weight:700;font-size:2rem;color:${defCount > 2 ? 'var(--red)' : defCount > 0 ? 'var(--yellow)' : 'var(--green)'}">${defCount}</div>
    </div>
    <div class="panel" style="text-align:center;padding:20px">
      <div style="font-size:.75rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;font-family:'JetBrains Mono',monospace;margin-bottom:8px">Engine Audio</div>
      <div style="font-weight:700;font-size:1.2rem;color:${ar ? (ar.is_knock ? 'var(--red)' : 'var(--green)') : 'var(--td)'}"> ${audioSt}</div>
    </div>`;
        }

        function appendVehicleInfo(fd) {
            fd.append('vin', document.getElementById('vin').value || '');
            fd.append('make', document.getElementById('make').value || '');
            fd.append('model', document.getElementById('model').value || '');
            fd.append('year', document.getElementById('year').value || '');
            fd.append('mileage', document.getElementById('mileage').value || '');
if (_currentRole === 'garage' && _garageServiceType) {
    fd.append('inspection_type', _garageServiceType);
}            const ar = state.audioResult;
            if (ar) {
                fd.append('engine_verdict', ar.verdict || '');
                fd.append('engine_is_knock', String(ar.is_knock));
                fd.append('engine_confidence', String(ar.confidence));
                fd.append('engine_duration', String(ar.duration_s));
            }
        }

