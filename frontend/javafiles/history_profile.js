         async function saveInspectionToHistory(data) {
            if (state._historySaved) return;
            state._historySaved = true;
            try {
                const make = (document.getElementById('make').value || 'Unknown').trim();
                const model = (document.getElementById('model').value || 'Vehicle').trim();
                const vin = (document.getElementById('vin').value || '—').trim();
                const year = (document.getElementById('year').value || '').trim();
                const defects = data.defects_detected || [];
            const uniqueTypes = data.unique_defect_types != null
    ? data.unique_defect_types
    : new Set(defects.map(d => {
        const raw = Array.isArray(d) ? d[0] : (d.label || '');
        // Strip severity suffix so "Door — Moderate Dent" and "Door — Severe Dent" count as one
        return raw.includes(' — ') ? raw.split(' — ')[0].trim().toLowerCase() : raw.toLowerCase();
    }).filter(Boolean)).size;
                const status = uniqueTypes === 0 ? 'pass' : uniqueTypes <= 2 ? 'attention' : 'fail';
                let image = '';
                if (state.files && state.files.length > 0) {
                    try {
                        image = await new Promise((res, rej) => {
                            const r = new FileReader();
                            r.onload = () => res(r.result);
                            r.onerror = () => rej(new Error('read failed'));
                            r.readAsDataURL(state.files[0]);
                        });
                    } catch (e) { image = ''; }
                }
                if (!image) {
                    const ann = data.annotated_images || [];
                    image = ann.length ? `${API}/${ann[0]}` : '';
                }
const uid2 = window._currentUser?.uid || 'guest';
const id = 'insp_' + uid2 + '_' + Date.now();
                const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
              // Normalise defect details for garage access
const defectDetails = (data.defects_detected || []).map(d =>
    Array.isArray(d) ? { label: d[0], confidence: d[1] } : d
);

const record = {
    id, date: dateStr, timestamp: Date.now(),
    vehicle: `${make} ${model}${year ? ' ' + year : ''}`.trim(),
    vin, status, defects: uniqueTypes, image,
    engineKnock: data.engine_result ? data.engine_result.is_knock : null,
    role: _currentRole,
    serviceType: _garageServiceType,
    defectDetails,   // ← stored so garage can read it
    score: data.ai_analysis ? (data.ai_analysis.health_score || null) : null,
};
                await window._fsSetDoc(
    window._fsDoc(window._fbDb, 'users', window._currentUser.uid, 'inspections', id),
    record
);
renderPortalHistory();
            } catch (err) {
                state._historySaved = false;
                console.warn('[History] save failed:', err);
            }
        }
async function switchActiveVehicle(vehicleId) {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    const v = (window._ownerVehicles || []).find(x => x._vehicleId === vehicleId);
    if (!v) return;
    window._activeVehicle = v;
    await window._fsSetDoc(
        window._fsDoc(window._fbDb, 'users', uid, 'profile', 'activeVehicle'),
        { vehicleId }
    );
    showProfileDisplay(v, uid, window._ownerVehicles);
}

function addNewVehicle() {
    document.getElementById('profileDisplayState').style.display = 'none';
    document.getElementById('profileUploadState').style.display = 'block';
    document.getElementById('profileUploadHeader').style.display = 'block';
    document.getElementById('mulkiyaPreview').style.display = 'none';
    document.getElementById('btnAutoFill').style.display = 'none';
    document.getElementById('mulkiyaInput').value = '';
    mulkiyaFiles = [];
}
       async function loadHistory() {
    try {
        const uid = window._currentUser?.uid;
        if (!uid || !window._fbDb) return [];
        const q = window._fsQuery(
            window._fsCollection(window._fbDb, 'users', uid, 'inspections'),
            window._fsOrderBy('timestamp', 'desc')
        );
        const snapshot = await window._fsGetDocs(q);
        return snapshot.docs.map(d => d.data());
    } catch (e) {
        console.warn('[History] load failed:', e);
        return [];
    }
}

        function renderPortalHistory() {
            loadHistory().then(records => {
                _historyCache = records;
                const ownerRecords = records.filter(r => !r.role || r.role === 'owner');
    const safeSetOwner = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
const ownerTotal = ownerRecords.length;
const ownerPass = ownerRecords.filter(r => r.status === 'pass').length;
const ownerIssues = ownerRecords.filter(r => r.status !== 'pass').length;
safeSetOwner('pds-inspections', ownerTotal);
safeSetOwner('pds-passed', ownerPass);
safeSetOwner('pds-issues', ownerIssues);
safeSetOwner('profileStatInspections', ownerTotal);
safeSetOwner('profileStatPassed', ownerPass);
safeSetOwner('profileStatIssues', ownerIssues);
                const garageRecords = records.filter(r => r.role === 'garage');
                const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                safeSet('garageStatInspections', garageRecords.length);
                safeSet('garageStatCompleted', garageRecords.filter(r => r.status === 'pass').length);
                // Owner history list
                const ownerList = document.getElementById('portalHistoryList');
                if (ownerList) {
                    if (!ownerRecords.length) {
                        ownerList.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--tm);font-family:\'JetBrains Mono\',monospace;font-size:.85rem"><div style="font-size:2.5rem;margin-bottom:12px">🔍</div>No inspections yet.</div>';
                    } else {
                        ownerList.innerHTML = ownerRecords.map((r, i) => `
          <div class="history-card-portal">
            <div class="hcp-number">#${ownerRecords.length - i}</div>
            <div class="hcp-info">
              <div class="hcp-vehicle">${r.vehicle}</div>
              <div class="hcp-date">${r.date}</div>
              <div class="hcp-meta">
                <span class="hcp-badge ${r.status}">${r.status.toUpperCase()}</span>
                <span style="font-size:.72rem;color:var(--td);font-family:'JetBrains Mono',monospace">${r.defects} defect type${r.defects !== 1 ? 's' : ''}</span>
                ${r.engineKnock === true ? '<span style="font-size:.72rem;color:var(--red);font-family:\'JetBrains Mono\',monospace">⚠ Knock</span>' : r.engineKnock === false ? '<span style="font-size:.72rem;color:var(--green);font-family:\'JetBrains Mono\',monospace">✓ Engine OK</span>' : ''}
              </div>
            </div>
            <div class="hcp-actions">
              <a href="${API}/report" target="_blank" class="btn btn-outline" style="font-size:.75rem;padding:7px 14px;text-decoration:none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>Download PDF
              </a>
            </div>
          </div>`).join('');
                    }
                }
                // Garage inspection list
                const garageList = document.getElementById('garageInspectionList');
                if (garageList) {
                    if (!garageRecords.length) {
                        garageList.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--tm);font-family:\'JetBrains Mono\',monospace;font-size:.85rem"><div style="font-size:2.5rem;margin-bottom:12px">🔧</div>No inspections yet.</div>';
                    } else {
                        garageList.innerHTML = garageRecords.map((r, i) => `
          <div class="history-card-portal">
            <div class="hcp-number">#${garageRecords.length - i}</div>
            <div class="hcp-info">
              <div class="hcp-vehicle">${r.vehicle}</div>
              <div class="hcp-date">${r.date} · ${(r.serviceType || 'service') === 'accident' ? '🚨 Accident Repair' : '🔧 Service'}</div>
              <div class="hcp-meta">
                <span class="hcp-badge ${r.status}">${r.status.toUpperCase()}</span>
                <span style="font-size:.72rem;color:var(--td);font-family:'JetBrains Mono',monospace">${r.defects} defect type${r.defects !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <div class="hcp-actions">
              <a href="${API}/report" target="_blank" class="btn btn-outline" style="font-size:.75rem;padding:7px 14px;text-decoration:none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>Download PDF
              </a>
            </div>
          </div>`).join('');
                    }
                }
                renderCarLifeTimeline(records);
            });
        }
        function renderGarageProfileCard(data) {
    const container = document.querySelector('#sec-garageProfile .portal-content');
    if (!container) return;

    const name = data.name || 'Your Garage';
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    // Remove existing hero if present
    const existing = document.getElementById('garageProfileHero');
    if (existing) existing.remove();

    const hero = document.createElement('div');
    hero.id = 'garageProfileHero';
    hero.style.cssText = 'background:linear-gradient(135deg,#0a1628,#0f2a4a);border-radius:16px;padding:28px 32px;margin-bottom:24px;border:1px solid rgba(200,216,228,0.12);';

    hero.innerHTML = `
        <div style="display:flex;align-items:center;gap:18px;margin-bottom:20px;">
            <div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,var(--c),#3b82f6);display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:800;color:#fff;flex-shrink:0;">${initials}</div>
            <div>
                <div style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:rgba(200,216,228,0.45);font-family:'JetBrains Mono',monospace;margin-bottom:4px;">Registered Garage · UAE</div>
                <div style="font-size:1.4rem;font-weight:800;color:#fff;">${name}</div>
                <div style="font-size:0.78rem;color:rgba(200,216,228,0.55);margin-top:3px;font-family:'JetBrains Mono',monospace;">${[data.city, data.license].filter(Boolean).join('  ·  ')}</div>
            </div>
        </div>
        <div style="display:flex;gap:0;border-top:1px solid rgba(255,255,255,0.07);padding-top:0;">
            <div style="flex:1;padding:14px 0;text-align:center;border-right:1px solid rgba(255,255,255,0.07);">
                <div id="garageStatInspections" style="font-size:1.4rem;font-weight:800;color:var(--c);font-family:'JetBrains Mono',monospace;">0</div>
                <div style="font-size:0.62rem;color:rgba(200,216,228,0.45);text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">Inspections</div>
            </div>
            <div style="flex:1;padding:14px 0;text-align:center;border-right:1px solid rgba(255,255,255,0.07);">
                <div id="garageStatAppointments" style="font-size:1.4rem;font-weight:800;color:#f59e0b;font-family:'JetBrains Mono',monospace;">0</div>
                <div style="font-size:0.62rem;color:rgba(200,216,228,0.45);text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">Appointments</div>
            </div>
            <div style="flex:1;padding:14px 0;text-align:center;">
                <div id="garageStatCompleted" style="font-size:1.4rem;font-weight:800;color:#4ade80;font-family:'JetBrains Mono',monospace;">0</div>
                <div style="font-size:0.62rem;color:rgba(200,216,228,0.45);text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">Completed</div>
            </div>
        </div>`;

    container.insertBefore(hero, container.firstChild);

    // Refresh stats
    renderPortalHistory();
}

