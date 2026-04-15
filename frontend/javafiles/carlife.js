    async  function renderCarLifeTimeline(records) {
    const timeline = document.getElementById('carLifeTimeline');
    if (!timeline) return;
    const uid = window._currentUser?.uid || 'guest';
    const allAppts = await getAllAppointments();
const myAppts = allAppts.filter(a => a.ownerId === uid);
    const events = [];
    records.forEach(r => {
        const isService = r.role === 'garage';
        events.push({
            type: isService ? (r.serviceType==='accident'?'accident':'service') : 'inspection',
            title: isService ? (r.serviceType==='accident'?'Accident Repair':'Routine Service') : 'AI Inspection',
            desc: r.vehicle,
            date: r.date,
            timestamp: r.timestamp||0,
            icon: isService ? (r.serviceType==='accident'?'🚨':'🔧') : '🔍',
            status: r.status,
            extra: `${r.defects} defect type${r.defects!==1?'s':''}${r.engineKnock===true?' · ⚠ Knock':r.engineKnock===false?' · ✓ Engine OK':''}`,
            color: r.status==='pass'?'#4ade80':r.status==='attention'?'#f59e0b':'#ff4444',
        });
    });
    myAppts.forEach(a => {
        events.push({
            type: 'appointment',
            title: 'Garage Booking',
            desc: `${a.service} at ${a.garage}`,
            date: a.date,
            timestamp: 0,
            icon: '📅',
            status: a.status,
            extra: a.time,
            color: { confirmed:'#4ade80', completed:'#4ade80', rejected:'#ff4444', pending:'#f59e0b' }[a.status]||'#f59e0b',
        });
    });
    events.sort((a,b) => new Date(b.date)-new Date(a.date) || b.timestamp-a.timestamp);

    if (!events.length) {
        timeline.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--tm);font-family:\'JetBrains Mono\',monospace;font-size:.82rem">No events yet — start inspections or book a garage.</div>';
        return;
    }

    timeline.innerHTML = events.map(ev => `
    <div class="clt-item" style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
            <div style="width:36px;height:36px;border-radius:50%;background:${ev.color}18;border:2px solid ${ev.color}40;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">${ev.icon}</div>
            <div style="width:2px;flex:1;background:rgba(255,255,255,0.05);margin-top:6px;min-height:16px;"></div>
        </div>
        <div style="flex:1;padding-bottom:4px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:3px;">
                <div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:${ev.color};font-family:'JetBrains Mono',monospace;">${ev.title}</div>
                <span style="background:${ev.color}15;color:${ev.color};padding:2px 8px;border-radius:10px;font-size:0.62rem;font-weight:700;font-family:'JetBrains Mono',monospace;border:1px solid ${ev.color}30;">${(ev.status||'').toUpperCase()}</span>
            </div>
            <div style="font-size:0.88rem;font-weight:700;color:var(--t);margin-bottom:3px;">${ev.desc}</div>
            <div style="font-size:0.72rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">${ev.date}${ev.extra?' · '+ev.extra:''}</div>
        </div>
    </div>`).join('');
}

   async function generateCarLifeReport() {
    const btn = document.querySelector('[onclick="generateCarLifeReport()"]');
    if (btn) { 
        btn.disabled = true; 
        btn.innerHTML = '<div class="spinner spinner-light" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:8px"></div> Generating...'; 
    }

    try {
        const uid = window._currentUser?.uid || 'guest';
        const records = await loadHistory();
        const ownerRecords = records.filter(r => !r.role || r.role === 'owner');
        const garageRecords = records.filter(r => r.role === 'garage');
        const allAppts = await getAllAppointments();
        const myAppts = allAppts.filter(a => a.ownerId === uid);

        let mulkiya = {};
        try {
            // Try active vehicle first
            if (window._activeVehicle) {
                mulkiya = window._activeVehicle;
            } else {
                const vSnap = await window._fsGetDocs(
                    window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
                );
                if (!vSnap.empty) {
                    mulkiya = vSnap.docs[0].data();
                } else {
                    const mulkiyaSnap = await window._fsGetDoc(
                        window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya')
                    );
                    mulkiya = mulkiyaSnap.exists() ? mulkiyaSnap.data() : {};
                }
            }
        } catch(e) { console.warn('[CarLife] mulkiya fetch failed:', e); }

    // Build the Car Life PDF content (inline preview + download)
    const clContent = buildCarLifePDF(vehicleName, plate, vin, mulkiya, ownerRecords, garageRecords, myAppts, healthScore, aiSummary);
   const clBlob = new Blob([clContent], {type:'text/html'});
const clUrl = URL.createObjectURL(clBlob); // local fallback

// Try to store the report HTML in Firestore for cross-device QR sharing
let shareableUrl = clUrl;
try {
    const reportId = 'carlife_' + uid + '_' + Date.now();
    await window._fsSetDoc(
        window._fsDoc(window._fbDb, 'carLifeReports', reportId),
        {
            uid,
            html: clContent,
            createdAt: new Date().toISOString(),
            vehicle: vehicleName,
        }
    );
    // Point QR to a viewer URL (you'll add this route, or use a hash-based viewer)
    shareableUrl = `https://mehra-b3a7c.web.app/car-life?id=${reportId}`;
} catch(e) {
    console.warn('[CarLife] Firestore upload failed, using blob URL:', e);
}

window._carLifeUrl = clUrl; // keep blob for local download

    // QR
    qrBox.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareableUrl)}" style="width:100%;height:100%;object-fit:contain;border-radius:6px">`;
    document.getElementById('btnDownloadCarLife').style.display = 'inline-flex';
    window._carLifeUrl = clUrl;
        const vehicleName = [mulkiya.make, mulkiya.bodyType, mulkiya.year]
            .filter(v => v && v !== '—').join(' ') || 'Your Vehicle';
        const plate = mulkiya.plateNumber || '—';
        const vin   = mulkiya.vin || '—';

        const total      = ownerRecords.length;
        const passed     = ownerRecords.filter(r => r.status === 'pass').length;
        const defects    = ownerRecords.reduce((s, r) => s + (r.defects || 0), 0);
        const knockCount = ownerRecords.filter(r => r.engineKnock === true).length;
        const healthScore = total === 0 ? 100 :
            Math.max(0, Math.round(100 - (defects * 5) - (knockCount * 15) - ((total - passed) * 8)));

        // Get owner name
        let ownerName = window._currentUser?.email || 'Vehicle Owner';
        try {
            const ownerMeta = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta')
            );
            if (ownerMeta.exists() && ownerMeta.data().owner) {
                const o = ownerMeta.data().owner;
                ownerName = [o.firstName, o.lastName].filter(Boolean).join(' ') || ownerName;
            }
        } catch(e) {}

        // ── Step 1: Build AI summary FIRST (declare before use) ──
        let aiSummary = `${vehicleName} has undergone ${total} AI inspection${total !== 1 ? 's' : ''}. ` +
            `${passed} passed clean. ${defects} defect instances detected. ` +
            `${myAppts.length} garage service visits recorded. ` +
            `Health Score: ${healthScore}/100.`;

        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer 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'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ 
                        role: 'user', 
                        content: `Write a 3-sentence professional car condition summary for a UAE vehicle history report. 
                        Vehicle: ${vehicleName}. Owner: ${ownerName}. 
                        Total AI inspections: ${total}, passed clean: ${passed}, 
                        total defects found: ${defects}, engine knock events: ${knockCount}, 
                        garage visits: ${myAppts.length}, health score: ${healthScore}/100.
                        Be concise and professional. Do not use markdown.`
                    }],
                    max_tokens: 200,
                    temperature: 0.3
                })
            });
            const groqData = await groqRes.json();
            const groqText = groqData?.choices?.[0]?.message?.content;
            if (groqText) aiSummary = groqText.trim();
        } catch(e) {
            console.warn('[CarLife] Groq summary failed, using fallback:', e);
        }

        // Update UI summary box
        const summaryEl = document.getElementById('carLifeSummaryText');
        if (summaryEl) summaryEl.textContent = aiSummary;

        // ── Step 2: Try Python backend for PDF ──
        let backendSuccess = false;
        try {
            const clRes = await fetch(`${API}/generate-car-life-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vehicle_info: mulkiya,
                    inspections:  ownerRecords,
                    services:     garageRecords,
                    appointments: myAppts,
                    owner_name:   ownerName,
                })
            });
            if (clRes.ok) {
                backendSuccess = true;
                window._carLifeUrl = `${API}/carlife-report`;
            }
        } catch(e) {
            console.warn('[CarLife] Backend unavailable, using client-side fallback:', e);
        }

        // ── Step 3: Fallback — build HTML report client-side ──
        if (!backendSuccess) {
            const htmlReport = buildCarLifePDF(
                vehicleName, plate, vin, mulkiya,
                ownerRecords, garageRecords, myAppts,
                healthScore, aiSummary
            );
            const blob = new Blob([htmlReport], { type: 'text/html' });
            window._carLifeUrl = URL.createObjectURL(blob);
            toast('Report generated (offline mode)', 'info');
        }

        // ── Step 4: QR Code ──
        const shareableUrl = window._carLifeUrl || `${window.location.origin}/carlife-report`;
        const qrBox = document.getElementById('carLifeQrBox');
        if (qrBox) {
            qrBox.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareableUrl)}" 
                style="width:100%;height:100%;object-fit:contain;border-radius:6px;">`;
        }

        const dlBtn = document.getElementById('btnDownloadCarLife');
        if (dlBtn) dlBtn.style.display = 'inline-flex';

        toast('✓ Car Life Report generated successfully', 'success');

    } catch(err) {
        console.error('[generateCarLifeReport]', err);
        toast('Failed to generate report: ' + err.message, 'error');
    } finally {
        if (btn) { 
            btn.disabled = false; 
            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg> Generate with Groq AI`; 
        }
    }

    // Refresh timeline
    const records = await loadHistory();
    renderCarLifeTimeline(records);
}
function buildCarLifePDF(vehicleName, plate, vin, mulkiya, inspections, serviceRecords, appts, score, summary) {
    const statusColor = score>=75?'#4ade80':score>=50?'#f59e0b':'#ff4444';
    const scoreLabel = score>=85?'Excellent':score>=70?'Good':score>=50?'Fair':score>=30?'Poor':'Critical';

    const R=54, C=2*Math.PI*R;
    const dash = C - (score/100)*C;

    const insRows = inspections.map((r,i)=>`
    <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;">${inspections.length-i}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;">${r.vehicle}</td>
        <td style="padding:10px 12px;font-size:13px;">${r.date}</td>
        <td style="padding:10px 12px;"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${r.status==='pass'?'#dcfce7':r.status==='attention'?'#fef3c7':'#fee2e2'};color:${r.status==='pass'?'#166534':r.status==='attention'?'#92400e':'#991b1b'}">${r.status.toUpperCase()}</span></td>
        <td style="padding:10px 12px;font-size:13px;">${r.defects} type${r.defects!==1?'s':''}</td>
        <td style="padding:10px 12px;font-size:13px;">${r.engineKnock===true?'⚠ Knock':r.engineKnock===false?'✓ OK':'—'}</td>
    </tr>`).join('');

    const svcRows = serviceRecords.map((r,i)=>`
    <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;font-weight:600;">${r.vehicle}</td>
        <td style="padding:10px 12px;font-size:13px;">${r.date}</td>
        <td style="padding:10px 12px;font-size:13px;">${r.serviceType==='accident'?'🚨 Accident Repair':'🔧 Routine Service'}</td>
        <td style="padding:10px 12px;"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${r.status==='pass'?'#dcfce7':'#fef3c7'};color:${r.status==='pass'?'#166534':'#92400e'}">${r.status.toUpperCase()}</span></td>
    </tr>`).join('');

    const apptRows = appts.map(a=>`
    <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;font-weight:600;">${a.garage}</td>
        <td style="padding:10px 12px;font-size:13px;">${a.service}</td>
        <td style="padding:10px 12px;font-size:13px;">${a.date}</td>
        <td style="padding:10px 12px;"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${a.status==='confirmed'||a.status==='completed'?'#dcfce7':'#fef3c7'};color:${a.status==='confirmed'||a.status==='completed'?'#166534':'#92400e'}">${(a.status||'pending').toUpperCase()}</span></td>
    </tr>`).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Car Life Report — ${vehicleName}</title>
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;padding:0; }
  .page { max-width:900px;margin:0 auto;background:#fff; }
  .header { background:linear-gradient(135deg,#0a1628,#1e3a5f);padding:40px 48px;color:#fff; }
  .header h1 { font-size:28px;font-weight:900;margin-bottom:4px;letter-spacing:-0.5px; }
  .header p { font-size:14px;opacity:0.65;font-family:monospace; }
  .score-section { display:flex;align-items:center;gap:40px;padding:32px 48px;background:#fff;border-bottom:1px solid #e2e8f0; }
  .score-ring-wrap { position:relative;width:130px;height:130px;flex-shrink:0; }
  .score-ring-wrap svg { transform:rotate(-90deg); }
  .score-center { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center; }
  .score-num { font-size:32px;font-weight:900;color:${statusColor}; }
  .score-lbl { font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.1em; }
  table { width:100%;border-collapse:collapse; }
  th { background:#f1f5f9;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;text-align:left; }
  .section { padding:28px 48px;border-bottom:1px solid #e2e8f0; }
  .section h2 { font-size:16px;font-weight:800;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:8px; }
  .footer { padding:24px 48px;text-align:center;font-size:11px;color:#94a3b8;background:#f8fafc;border-top:1px solid #e2e8f0; }
  .info-grid { display:grid;grid-template-columns:1fr 1fr;gap:12px; }
  .info-item { background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px; }
  .info-label { font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px; }
  .info-value { font-size:14px;font-weight:700;color:#1e293b; }
  .alert-box { background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;font-size:13px;color:#92400e;margin-top:16px; }
  @media print { body{background:#fff} .page{max-width:100%} }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
      <div>
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.5;margin-bottom:8px;font-family:monospace;">MEHRA PLATFORM · OFFICIAL CAR LIFE REPORT</div>
        <h1>🚗 ${vehicleName}</h1>
        <p style="margin-top:6px">Plate: ${plate} &nbsp;·&nbsp; VIN: ${vin} &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;opacity:0.5;margin-bottom:4px;font-family:monospace;">HEALTH SCORE</div>
        <div style="font-size:40px;font-weight:900;color:${statusColor}">${score}<span style="font-size:18px;opacity:0.6">/100</span></div>
        <div style="font-size:13px;font-weight:700;color:${statusColor};opacity:0.9">${scoreLabel} Condition</div>
      </div>
    </div>
  </div>

  <!-- AI Summary -->
  <div class="section">
    <h2>✦ AI Health Assessment</h2>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:18px 20px;font-size:14px;line-height:1.7;color:#0c4a6e;">${summary}</div>
    ${(mulkiya.registrationExpiry&&mulkiya.registrationExpiry!=='—'||mulkiya.insuranceExpiry&&mulkiya.insuranceExpiry!=='—')?`
    <div class="alert-box" style="margin-top:12px">
      ⚠️ <strong>Upcoming Expirations:</strong>
      ${mulkiya.registrationExpiry&&mulkiya.registrationExpiry!=='—'?`Registration expires: ${mulkiya.registrationExpiry}.`:''}
      ${mulkiya.insuranceExpiry&&mulkiya.insuranceExpiry!=='—'?`Insurance expires: ${mulkiya.insuranceExpiry}.`:''}
    </div>`:''}
  </div>

  <!-- Vehicle Details -->
  <div class="section">
    <h2>📋 Vehicle Information</h2>
    <div class="info-grid">
      ${[['Make',mulkiya.make],['Body Type',mulkiya.bodyType],['Year',mulkiya.year],['Color',mulkiya.color],['Fuel Type',mulkiya.fuelType],['Cylinders',mulkiya.cylinders],['Plate',mulkiya.plateNumber],['Plate Kind',mulkiya.plateKind],['VIN',mulkiya.vin],['Engine No.',mulkiya.engineNumber],['Gross Weight',mulkiya.grossWeight],['Unladen Weight',mulkiya.unladenWeight]].map(([l,v])=>`
      <div class="info-item"><div class="info-label">${l}</div><div class="info-value">${v&&v!=='—'?v:'Not recorded'}</div></div>`).join('')}
    </div>
  </div>

  <!-- Inspection History -->
  <div class="section">
    <h2>🔍 AI Inspection History (${inspections.length} total)</h2>
    ${inspections.length?`
    <table>
      <tr><th>#</th><th>Vehicle</th><th>Date</th><th>Result</th><th>Defects</th><th>Engine</th></tr>
      ${insRows}
    </table>`:
    '<p style="color:#94a3b8;font-size:13px;padding:16px 0">No AI inspections recorded yet.</p>'}
  </div>

  <!-- Service History -->
  <div class="section">
    <h2>🔧 Service & Repair History (${serviceRecords.length} records)</h2>
    ${serviceRecords.length?`
    <table>
      <tr><th>Vehicle</th><th>Date</th><th>Type</th><th>Result</th></tr>
      ${svcRows}
    </table>`:
    '<p style="color:#94a3b8;font-size:13px;padding:16px 0">No garage service records found.</p>'}
  </div>

  <!-- Appointments -->
  <div class="section">
    <h2>📅 Garage Appointments (${appts.length} total)</h2>
    ${appts.length?`
    <table>
      <tr><th>Garage</th><th>Service</th><th>Date</th><th>Status</th></tr>
      ${apptRows}
    </table>`:
    '<p style="color:#94a3b8;font-size:13px;padding:16px 0">No appointments booked.</p>'}
  </div>

  <!-- Footer -->
  <div class="footer">
    <strong>MEHRA Platform</strong> — AI-Powered Vehicle Ecosystem &nbsp;·&nbsp; This report was generated automatically based on platform activity &nbsp;·&nbsp; ${new Date().toISOString()}
  </div>

</div>
</body>
</html>`;
}

    function downloadCarLifeReport() {
    if (!window._carLifeUrl) {
        toast('Please generate the report first', 'error');
        return;
    }
    const a = document.createElement('a');
    a.href = window._carLifeUrl;
    a.target = '_blank';
    // Blob URLs need download attr, API URLs open in tab
    if (window._carLifeUrl.startsWith('blob:')) {
        a.download = 'MEHRA_Car_Life_Report.html';
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Downloading report...', 'info');
}

        // ─── Garage service type ───────────────────────────────────────────────────────
        function selectServiceType(type) {
            _garageServiceType = type;
            document.getElementById('stcService').classList.toggle('active', type === 'service');
            document.getElementById('stcAccident').classList.toggle('active', type === 'accident');
            const sel = document.getElementById('inspectionTypeSelect');
            if (sel) sel.value = type;
        }

        function syncInspectionField(field, value) {
            const el = document.getElementById(field);
            if (el) el.value = value;
        }

        function startGarageInspectionFlow() {
            ['vin', 'make', 'model', 'year'].forEach(f => {
                const src = document.getElementById('g' + f.charAt(0).toUpperCase() + f.slice(1));
                const dst = document.getElementById(f);
                if (src && dst && src.value) dst.value = src.value;
            });
            // Navigate to inspection section without resetting state
            document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
            document.getElementById('sec-inspection').classList.add('active');
            document.querySelectorAll('.snav-item').forEach(i => i.classList.remove('active'));
            const navEl = document.getElementById('snav-serviceInspection');
            if (navEl) navEl.classList.add('active');
            setStep(1);
            window.scrollTo(0, 0);
        }

