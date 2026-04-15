// ═══════════════════════════════════════════════════════════
// RTA PORTAL FUNCTIONS
// ═══════════════════════════════════════════════════════════
async function saveRtaProfile() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');
    const data = {
        name:  document.getElementById('rtaOfficerName').value.trim(),
        dept:  document.getElementById('rtaDept').value.trim(),
        badge: document.getElementById('rtaBadge').value.trim(),
    };
    try {
        await window._fsSetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'rta'), data);
        await window._fsUpdateDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta'), { rta: data });
        toast('RTA profile saved ✓', 'success');
    } catch(e) { toast('Failed to save profile', 'error'); }
}

async function renderRtaDashboard() {
    try {
        const usersSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'users'));
        let regCount = 0;
        for (const userDoc of usersSnap.docs) {
            try {
                const metaSnap = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', userDoc.id, 'profile', 'meta'));
                if (metaSnap.exists()) regCount++;
            } catch(e) {}
        }
        const finesSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'rtaFines'));
        const activeFines = finesSnap.docs.map(d => d.data()).filter(f => f.status === 'active');
        const apptSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'appointments'));
        const pendingRenewals = apptSnap.docs.map(d => d.data()).filter(a => a.status === 'pending');

        const el = id => document.getElementById(id);
        if (el('rtaStatFines')) el('rtaStatFines').textContent = activeFines.length;
        if (el('rtaStatRegistrations')) el('rtaStatRegistrations').textContent = regCount;
        if (el('rtaStatRenewals')) el('rtaStatRenewals').textContent = pendingRenewals.length;
        if (el('rtaStatInspections')) el('rtaStatInspections').textContent = apptSnap.size;

        const activity = el('rtaRecentActivity');
        if (!activity) return;
        const allAppts = apptSnap.docs.map(d => d.data()).sort((a,b) => (b.timestamp||0)-(a.timestamp||0)).slice(0,10);
        if (!allAppts.length) {
            activity.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">🏛️</div>No activity recorded yet.</div>';
            return;
        }
        activity.innerHTML = allAppts.map(a => {
            const sc = { pending:'#f59e0b', confirmed:'#4ade80', completed:'#4ade80', rejected:'#ff4444' }[a.status] || '#f59e0b';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);flex-wrap:wrap;gap:8px;">
                <div>
                    <div style="font-weight:700;color:var(--t);font-size:.9rem">${a.ownerName||'Owner'} — ${a.vehicle||'Vehicle'}</div>
                    <div style="font-size:.75rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">${a.service||'—'} · ${a.garage||'—'} · ${a.date||'—'}</div>
                </div>
                <span style="background:${sc}20;color:${sc};padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:800;border:1px solid ${sc}40">${(a.status||'pending').toUpperCase()}</span>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[RTA Dashboard]', e); }
}

async function renderRtaFines() {
    const el = document.getElementById('rtaFinesList');
    if (!el) return;
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'rtaFines'));
        const fines = snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
        if (!fines.length) {
            el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">⚠️</div>No fines issued yet.</div>';
            return;
        }
        el.innerHTML = fines.map(f => {
            const sc = f.status === 'paid' ? '#4ade80' : '#f59e0b';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:12px;padding:16px 20px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div>
                    <div style="font-weight:700;color:var(--t);">${f.plate||'—'} — ${f.violation||'—'}</div>
                    <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">${f.location||''} · AED ${f.amount||0} · ${f.issuedAt||'—'}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid ${sc}40">${(f.status||'active').toUpperCase()}</span>
                    ${f.status !== 'paid' ? `<button onclick="markFineAsPaid('${f.id}')" style="padding:6px 14px;background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.3);border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">✓ Mark Paid</button>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[RTA Fines]', e); }
}
async function issueRtaFine() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');

    const plate     = document.getElementById('finesPlate').value.trim();
    const violation = document.getElementById('finesViolationType').value;
    const amount    = document.getElementById('finesAmount').value;
    const location  = document.getElementById('finesLocation').value.trim();

    if (!plate)     return toast('Please enter a plate number', 'error');
    if (!violation) return toast('Please select a violation type', 'error');
    if (!amount || Number(amount) <= 0) return toast('Please enter a valid fine amount', 'error');

    const btn = document.querySelector('[onclick="issueRtaFine()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Issuing...'; }

    try {
        // Try to find matching registered vehicle
        let linkedOwnerId = null;
        let linkedVehicle = null;
        try {
            const usersSnap = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'users')
            );
            for (const userDoc of usersSnap.docs) {
                try {
                    // Check vehicles subcollection
                    const vSnap = await window._fsGetDocs(
                        window._fsCollection(window._fbDb, 'users', userDoc.id, 'vehicles')
                    );
                    for (const vDoc of vSnap.docs) {
                        const v = vDoc.data();
                        const vPlate = (v.plateNumber || '').replace(/\s/g,'').toLowerCase();
                        const fPlate = plate.replace(/\s/g,'').toLowerCase();
                        if (vPlate && fPlate && (vPlate === fPlate || vPlate.includes(fPlate) || fPlate.includes(vPlate))) {
                            linkedOwnerId = userDoc.id;
                            linkedVehicle = v;
                            break;
                        }
                    }
                    if (linkedOwnerId) break;

                    // Fallback: check legacy mulkiya
                    const mSnap = await window._fsGetDoc(
                        window._fsDoc(window._fbDb, 'users', userDoc.id, 'profile', 'mulkiya')
                    );
                    if (mSnap.exists()) {
                        const m = mSnap.data();
                        const vPlate = (m.plateNumber || '').replace(/\s/g,'').toLowerCase();
                        const fPlate = plate.replace(/\s/g,'').toLowerCase();
                        if (vPlate && fPlate && (vPlate === fPlate || vPlate.includes(fPlate) || fPlate.includes(vPlate))) {
                            linkedOwnerId = userDoc.id;
                            linkedVehicle = m;
                            break;
                        }
                    }
                } catch(e) {}
            }
        } catch(e) {
            console.warn('[RTA Fines] vehicle lookup failed:', e);
        }

        const fineId = 'fine_' + Date.now();
        const fine = {
            id:          fineId,
            plate,
            violation,
            amount:      Number(amount),
            location:    location || '—',
            status:      'active',
            issuedBy:    uid,
            issuedAt:    new Date().toLocaleDateString(),
            timestamp:   Date.now(),
            linkedOwnerId:  linkedOwnerId || null,
            linkedVehicle:  linkedVehicle ? {
                make:     linkedVehicle.make || '—',
                bodyType: linkedVehicle.bodyType || '—',
                year:     linkedVehicle.year || '—',
                vin:      linkedVehicle.vin || '—',
            } : null,
        };

        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'rtaFines', fineId), fine
        );

        // Notify owner if found in system
        if (linkedOwnerId) {
            await notifyUser(
                linkedOwnerId,
                `⚠️ A traffic fine of <strong>AED ${amount}</strong> has been issued for plate ` +
                `<strong>${plate}</strong> — Violation: ${violation}` +
                `${location ? ' at ' + location : ''}.`,
                'rejected'
            );
            toast(`✓ Fine issued — owner notified in MEHRA`, 'success');
        } else {
            toast(`✓ Fine issued (plate not linked to MEHRA account)`, 'success');
        }

        // Clear form
        ['finesPlate','finesAmount','finesLocation'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const violEl = document.getElementById('finesViolationType');
        if (violEl) violEl.value = '';

        renderRtaFines();
        renderRtaDashboard();

    } catch(e) {
        console.error('[RTA Fine]', e);
        toast('Failed to issue fine: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Issue Fine'; }
    }
}

async function renderRtaRegistrations() {
    const el = document.getElementById('rtaRegistrationsList');
    if (!el) return;
    try {
        const usersSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'users'));
        const vehicles = [];
        for (const userDoc of usersSnap.docs) {
            try {
                const mulkiyaSnap = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', userDoc.id, 'profile', 'mulkiya'));
                if (mulkiyaSnap.exists()) vehicles.push({ uid: userDoc.id, ...mulkiyaSnap.data() });
            } catch(e) {}
        }
        if (!vehicles.length) {
            el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">🚗</div>No registered vehicles found.</div>';
            return;
        }
        el.innerHTML = vehicles.map(v => {
            const now = new Date();
            const expDate = v.registrationExpiry ? new Date(v.registrationExpiry) : null;
            const expired = expDate && expDate < now;
            const sc = expired ? '#ff4444' : '#4ade80';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:12px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div>
                    <div style="font-weight:700;color:var(--t)">${v.ownerName||'—'} — ${[v.make,v.bodyType,v.year].filter(x=>x&&x!=='—').join(' ')||'Vehicle'}</div>
                    <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">Plate: ${v.plateNumber||'—'} · VIN: ${v.vin||'—'} · Ins: ${v.insuranceCompany||'—'}</div>
                </div>
                <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid ${sc}40">${expired ? 'EXPIRED' : 'VALID'} ${v.registrationExpiry||'—'}</span>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[RTA Registrations]', e); }
}

async function renderRtaFleet() {
    const el = document.getElementById('rtaFleetStats');
    if (!el) return;
    try {
        const usersSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'users'));
        let total = 0, expired = 0, byMake = {};
        for (const userDoc of usersSnap.docs) {
            try {
                const mSnap = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', userDoc.id, 'profile', 'mulkiya'));
                if (mSnap.exists()) {
                    total++;
                    const d = mSnap.data();
                    const expDate = d.registrationExpiry ? new Date(d.registrationExpiry) : null;
                    if (expDate && expDate < new Date()) expired++;
                    const make = d.make && d.make !== '—' ? d.make : 'Unknown';
                    byMake[make] = (byMake[make] || 0) + 1;
                }
            } catch(e) {}
        }
        const apptSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'appointments'));
        const topMakes = Object.entries(byMake).sort((a,b) => b[1]-a[1]).slice(0, 5);
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px">
            <div style="background:rgba(200,216,228,.06);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center"><div style="font-size:1.8rem;font-weight:800;color:var(--c);font-family:'JetBrains Mono',monospace">${total}</div><div style="font-size:.72rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">Total Vehicles</div></div>
            <div style="background:rgba(255,68,68,.06);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center"><div style="font-size:1.8rem;font-weight:800;color:#ff4444;font-family:'JetBrains Mono',monospace">${expired}</div><div style="font-size:.72rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">Expired Reg.</div></div>
            <div style="background:rgba(74,222,128,.06);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center"><div style="font-size:1.8rem;font-weight:800;color:#4ade80;font-family:'JetBrains Mono',monospace">${total - expired}</div><div style="font-size:.72rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">Active Reg.</div></div>
            <div style="background:rgba(245,158,11,.06);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center"><div style="font-size:1.8rem;font-weight:800;color:#f59e0b;font-family:'JetBrains Mono',monospace">${apptSnap.size}</div><div style="font-size:.72rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">Service Bookings</div></div>
        </div>
        <h4 style="font-size:.85rem;font-weight:700;color:var(--t);margin-bottom:12px">Top Vehicle Makes</h4>
        ${topMakes.map(([make, cnt]) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05)"><span style="color:var(--t);font-weight:600">${make}</span><span style="color:var(--c);font-weight:700;font-family:'JetBrains Mono',monospace">${cnt} vehicles</span></div>`).join('')}`;
    } catch(e) { console.warn('[RTA Fleet]', e); }
}

async function renderRtaAnalytics() {
    const el = document.getElementById('rtaAnalyticsPanel');
    if (!el) return;
    try {
        const [apptSnap, claimsSnap, finesSnap, mktSnap] = await Promise.all([
            window._fsGetDocs(window._fsCollection(window._fbDb, 'appointments')),
            window._fsGetDocs(window._fsCollection(window._fbDb, 'insuranceClaims')),
            window._fsGetDocs(window._fsCollection(window._fbDb, 'rtaFines')),
            window._fsGetDocs(window._fsCollection(window._fbDb, 'marketplace')),
        ]);
        const appts = apptSnap.docs.map(d => d.data());
        const claims = claimsSnap.docs.map(d => d.data());
        const fines = finesSnap.docs.map(d => d.data());
        const listings = mktSnap.docs.map(d => d.data());
        const s = (val, label, color) => `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center"><div style="font-size:1.8rem;font-weight:800;color:${color};font-family:'JetBrains Mono',monospace">${val}</div><div style="font-size:.72rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">${label}</div></div>`;
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px">
            ${s(appts.length,'Total Appointments','var(--c)')}
            ${s(appts.filter(a=>a.status==='completed').length,'Completed Services','#4ade80')}
            ${s(claims.length,'Insurance Claims','#f59e0b')}
            ${s(claims.filter(c=>c.status==='approved').length,'Claims Approved','#4ade80')}
            ${s(fines.length,'Total Fines Issued','#ff4444')}
            ${s(fines.filter(f=>f.status==='paid').length,'Fines Paid','#4ade80')}
            ${s(listings.length,'Marketplace Listings','var(--c)')}
            ${s(listings.filter(l=>l.status==='sold').length,'Vehicles Sold','#4ade80')}
        </div>`;
    } catch(e) { console.warn('[RTA Analytics]', e); }
}

// ═══════════════════════════════════════════════════════════
