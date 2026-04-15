// ═══════════════════════════════════════════════════════════
// MARKETPLACE OPERATOR PORTAL FUNCTIONS
// ═══════════════════════════════════════════════════════════
async function saveMktProfile() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');
    const data = {
        name:    document.getElementById('mktPlatformName').value.trim(),
        contact: document.getElementById('mktContactPerson').value.trim(),
        license: document.getElementById('mktBizLicense').value.trim(),
    };
    try {
        await window._fsSetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mkt'), data);
        await window._fsUpdateDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta'), { mkt: data });
        toast('Marketplace profile saved ✓', 'success');
    } catch(e) { toast('Failed to save profile', 'error'); }
}

let _mktAllListings = [];

async function renderMktDashboard() {
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'marketplace'));
        const listings = snap.docs.map(d => ({id: d.id, ...d.data()}));
        _mktAllListings = listings;
        const active = listings.filter(l => l.status !== 'sold');
        const sold = listings.filter(l => l.status === 'sold');
        const totalActiveValue = active.reduce((s,l) => s + (Number(l.price)||0), 0);
        const avgPrice = active.length ? Math.round(totalActiveValue / active.length) : 0;

        const el = id => document.getElementById(id);
        if (el('mktStatListings')) el('mktStatListings').textContent = active.length;
        if (el('mktStatVerified')) el('mktStatVerified').textContent = active.length;
        if (el('mktStatSold')) el('mktStatSold').textContent = sold.length;
        if (el('mktStatValue')) el('mktStatValue').textContent = totalActiveValue > 0 ? totalActiveValue.toLocaleString() : '—';

        const topList = el('mktTopListings');
        if (!topList) return;
        const top = [...listings].sort((a,b) => (Number(b.price)||0)-(Number(a.price)||0)).slice(0, 5);
        if (!top.length) {
            topList.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">🛒</div>No listings yet.</div>';
            return;
        }
        topList.innerHTML = top.map(l => {
            const sc = l.status === 'sold' ? '#ff4444' : '#4ade80';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.05);flex-wrap:wrap;gap:8px;">
                <div>
                    <div style="font-weight:700;color:var(--t)">${l.vehicle||'Vehicle'}</div>
                    <div style="font-size:.75rem;color:var(--tm);font-family:'JetBrains Mono',monospace">Health: ${l.healthScore||'—'}/100 · Listed: ${l.createdAt||'—'}</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-weight:800;color:var(--t)">AED ${Number(l.price||0).toLocaleString()}</span>
                    <span style="background:${sc}20;color:${sc};padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:800;border:1px solid ${sc}40">${(l.status||'active').toUpperCase()}</span>
                </div>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[Mkt Dashboard]', e); }
}

function filterMktListings(query) {
    const statusFilter = document.getElementById('mktListingsFilter')?.value || 'all';
    let filtered = _mktAllListings;
    if (statusFilter !== 'all') filtered = filtered.filter(l => statusFilter === 'sold' ? l.status === 'sold' : l.status !== 'sold');
    if (query && query.trim()) {
        const q = query.toLowerCase();
        filtered = filtered.filter(l => (l.vehicle||'').toLowerCase().includes(q) || (l.notes||'').toLowerCase().includes(q) || (l.contact||'').toLowerCase().includes(q));
    }
    renderMktListingsGrid(filtered);
}

function renderMktListingsGrid(listings) {
    const el = document.getElementById('mktAllListingsGrid');
    if (!el) return;
    if (!listings.length) {
        el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--tm);grid-column:1/-1"><div style="font-size:2rem;margin-bottom:12px">🛒</div>No listings found.</div>';
        return;
    }
    el.innerHTML = listings.map(l => {
        const sc = l.status === 'sold' ? '#ff4444' : '#4ade80';
        return `<div class="garage-card" style="position:relative">
            <div style="position:absolute;top:12px;right:12px;background:${sc}18;color:${sc};font-size:.65rem;font-weight:800;padding:3px 10px;border-radius:20px;border:1px solid ${sc}30">${l.status === 'sold' ? 'SOLD' : '✓ ACTIVE'}</div>
            <div class="gc-name">${l.vehicle||'Vehicle'}</div>
            <div class="gc-address" style="margin-bottom:6px">Health Score: <strong style="color:${typeof l.healthScore==='number'?(l.healthScore>=75?'#4ade80':l.healthScore>=50?'#f59e0b':'#ff4444'):'var(--c)'}">${l.healthScore||'—'}${typeof l.healthScore==='number'?'/100':''}</strong></div>
            <div class="gc-meta" style="margin-bottom:12px"><span style="font-size:.78rem;color:var(--t);font-weight:700">AED ${l.price ? Number(l.price).toLocaleString() : '—'}</span>${l.contact ? `<span style="font-size:.72rem;color:var(--tm);font-family:'JetBrains Mono',monospace"> · ${l.contact}</span>` : ''}</div>
            ${l.notes ? `<div style="font-size:.78rem;color:var(--td);margin-bottom:10px;font-style:italic">${l.notes}</div>` : ''}
            <div style="font-size:.7rem;color:var(--tm);font-family:'JetBrains Mono',monospace">Listed ${l.createdAt||'—'} · Inspections: ${l.inspectionCount||0}</div>
            <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                <button onclick="mktOperatorRemoveListing('${l.id}')" style="flex:1;padding:8px;background:rgba(255,68,68,0.08);color:#ff6666;border:1px solid rgba(255,68,68,0.25);border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">🗑 Remove</button>
                ${l.status !== 'sold' ? `<button onclick="mktOperatorMarkSold('${l.id}')" style="flex:1;padding:8px;background:rgba(74,222,128,0.08);color:#4ade80;border:1px solid rgba(74,222,128,0.25);border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">✓ Mark Sold</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function renderMktListings() {
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'marketplace'));
        _mktAllListings = snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
        renderMktListingsGrid(_mktAllListings);
    } catch(e) { console.warn('[Mkt Listings]', e); }
}

async function mktOperatorRemoveListing(listingId) {
    if (!confirm('Remove this listing from the marketplace?')) return;
    try {
        await window._fsDeleteDoc(window._fsDoc(window._fbDb, 'marketplace', listingId));
        toast('Listing removed ✓', 'info');
        renderMktListings();
        renderMktDashboard();
    } catch(e) { toast('Failed to remove listing', 'error'); }
}

async function mktOperatorMarkSold(listingId) {
    try {
        await window._fsUpdateDoc(window._fsDoc(window._fbDb, 'marketplace', listingId), { status: 'sold', soldAt: new Date().toLocaleDateString() });
        toast('Listing marked as sold ✓', 'success');
        renderMktListings();
        renderMktDashboard();
    } catch(e) { toast('Failed to update listing', 'error'); }
}

async function renderMktVerification() {
    const el = document.getElementById('mktVerificationQueue');
    if (!el) return;
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'marketplace'));
        const listings = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(l => l.status !== 'sold');
        if (!listings.length) {
            el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">🔐</div>No listings pending verification.</div>';
            return;
        }
        el.innerHTML = listings.map(l => {
            const hasInspection = l.inspectionCount > 0;
            const hasHealth = typeof l.healthScore === 'number';
            const verified = hasInspection && hasHealth;
            const sc = verified ? '#4ade80' : '#f59e0b';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:14px;padding:18px 22px;margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
                    <div>
                        <div style="font-weight:800;color:var(--t)">${l.vehicle||'Vehicle'} — AED ${Number(l.price||0).toLocaleString()}</div>
                        <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace">Contact: ${l.contact||'—'} · Listed: ${l.createdAt||'—'}</div>
                    </div>
                    <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid ${sc}40">${verified ? '✓ VERIFIED' : '⚠ REVIEW NEEDED'}</span>
                </div>
                <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:.8rem">
                    <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px 10px"><span style="color:var(--tm);display:block;font-size:.66rem">AI INSPECTIONS</span><strong style="color:${hasInspection ? '#4ade80' : '#f59e0b'}">${l.inspectionCount||0}</strong></div>
                    <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px 10px"><span style="color:var(--tm);display:block;font-size:.66rem">HEALTH SCORE</span><strong style="color:${hasHealth ? (l.healthScore>=70?'#4ade80':'#f59e0b') : '#ff4444'}">${l.healthScore||'—'}${hasHealth ? '/100' : ''}</strong></div>
                    <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px 10px"><span style="color:var(--tm);display:block;font-size:.66rem">CAR LIFE REPORT</span><strong style="color:${l.carLifeUrl ? '#4ade80' : '#f59e0b'}">${l.carLifeUrl ? 'Available' : 'Not Generated'}</strong></div>
                </div>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[Mkt Verification]', e); }
}

async function renderMktAnalytics() {
    const el = document.getElementById('mktAnalyticsPanel');
    if (!el) return;
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'marketplace'));
        const listings = snap.docs.map(d => d.data());
        const active = listings.filter(l => l.status !== 'sold');
        const sold = listings.filter(l => l.status === 'sold');
        const totalActiveValue = active.reduce((s,l) => s + (Number(l.price)||0), 0);
        const avgPrice = active.length ? Math.round(totalActiveValue / active.length) : 0;
        const withHealth = active.filter(l => typeof l.healthScore === 'number');
        const avgHealth = withHealth.length ? Math.round(withHealth.reduce((s,l) => s + l.healthScore, 0) / withHealth.length) : null;
        const withReports = listings.filter(l => l.carLifeUrl).length;
        const s = (val, label, color) => `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center"><div style="font-size:1.6rem;font-weight:800;color:${color};font-family:'JetBrains Mono',monospace">${val}</div><div style="font-size:.7rem;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">${label}</div></div>`;
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px">
            ${s(listings.length,'Total Listings','var(--c)')}
            ${s(active.length,'Active Listings','#4ade80')}
            ${s(sold.length,'Sold Vehicles','#f59e0b')}
            ${s('AED ' + avgPrice.toLocaleString(),'Avg. Asking Price','var(--c)')}
            ${s(avgHealth !== null ? avgHealth + '/100' : '—','Avg. Health Score','#4ade80')}
            ${s(withReports,'With Car Life Reports','#f59e0b')}
        </div>`;
    } catch(e) { console.warn('[Mkt Analytics]', e); }
}


document.addEventListener('DOMContentLoaded', () => {
    // Ensure clean initial state
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
    document.getElementById('rolePortal').classList.remove('active');
    document.getElementById('live-camera').classList.remove('active');
    document.getElementById('landing').classList.add('active');
    document.getElementById('publicNav').style.display = '';
    document.getElementById('scanOverlay').classList.remove('active');
    document.getElementById('appointmentModal').classList.remove('active');

    // Load garage cards on landing
    populateGarageCards();

    // Periodic bell refresh every 30 seconds when logged in
    setInterval(() => {
        if (window._currentUser) updateBellBadge();
    }, 30000);

    // Handle browser back button
    window.addEventListener('popstate', () => {
        if (window._currentUser) {
            showPortal(window._currentUser, _currentRole);
        } else {
            goTo('landing');
        }
    });

    // Close modal on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAppointmentModal();
            const scm = document.getElementById('serviceCompletionModal');
            if (scm) scm.remove();
            closeSidebar();
        }
    });

    // Prevent double-tap zoom on mobile buttons
    document.addEventListener('touchend', (e) => {
        if (e.target.tagName === 'BUTTON') e.preventDefault();
    }, { passive: false });
});
async function saveInsuranceProfile() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');
    const data = {
        name:    document.getElementById('insCompanyName').value.trim(),
        license: document.getElementById('insLicense').value.trim(),
        phone:   document.getElementById('insPhone').value.trim(),
        city:    document.getElementById('insCity').value.trim(),
    };
    try {
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'insurance'), data
        );
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta'),
            { insurance: data }
        );
        toast('Insurance profile saved ✓', 'success');
    } catch(e) {
        toast('Failed to save profile', 'error');
    }
}

async function createInsuranceClaim(appt) {
    try {
        const mulkiyaSnap = await window._fsGetDoc(
            window._fsDoc(window._fbDb, 'users', appt.ownerId, 'profile', 'mulkiya')
        );
        const mulkiya = mulkiyaSnap.exists() ? mulkiyaSnap.data() : {};
        const insuranceCompany = mulkiya.insuranceCompany || '—';
        const policyNo         = mulkiya.insurancePolicy  || '—';

        // Get vehicle data — try vehicles subcollection first, then legacy mulkiya
        let mulkiya = {};
        try {
            const vSnap = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'users', appt.ownerId, 'vehicles')
            );
            if (!vSnap.empty) {
                mulkiya = vSnap.docs[0].data();
            } else {
                const mSnap = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', appt.ownerId, 'profile', 'mulkiya')
                );
                if (mSnap.exists()) mulkiya = mSnap.data();
            }
        } catch(e) {
            console.warn('[Claim] mulkiya fetch failed:', e);
        }

        const insuranceCompany = mulkiya.insuranceCompany || '—';
        const policyNo         = mulkiya.insurancePolicy  || '—';

        // Get owner's latest AI inspection for defect data
        let defectSummary = '';
        let healthScore = null;
        try {
            const iSnap = await window._fsGetDocs(
                window._fsQuery(
                    window._fsCollection(window._fbDb, 'users', appt.ownerId, 'inspections'),
                    window._fsOrderBy('timestamp', 'desc')
                )
            );
            if (!iSnap.empty) {
                const latest = iSnap.docs[0].data();
                healthScore = latest.score || null;
                const defects = latest.defectDetails || [];
                defectSummary = defects.length
                    ? defects.map(d => `${d.label || 'Unknown'} (${d.confidence || 0}%)`).join(', ')
                    : 'No AI defects on record';
            }
        } catch(e) {}

        const claimId = 'claim_' + Date.now();
        const claim = {
            id:              claimId,
            appointmentId:   appt.id,
            status:          'pending',
            createdAt:       new Date().toLocaleDateString(),
            timestamp:       Date.now(),
            ownerId:         appt.ownerId,
            ownerName:       appt.ownerName,
            ownerEmail:      appt.ownerEmail,
            vehicle:         appt.vehicle,
            mulkiya,
            insuranceCompany,
            policyNo,
            garageName:      appt.garage,
            garageAddress:   appt.garageAddress || '',
            serviceType:     appt.service,
            appointmentDate: appt.date,
            notes:           appt.notes || '',
            defectSummary,
            healthScore,
        };

        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'insuranceClaims', claimId), claim
        );

        notifyUser(appt.ownerId,
            `🛡️ Insurance claim auto-submitted to <strong>${insuranceCompany}</strong> for your accident repair at ${appt.garage}.`,
            'confirmed'
        );

        toast(`✓ Insurance claim auto-sent to ${insuranceCompany}`, 'success');
    } catch(e) {
        console.warn('[Insurance Claim] failed:', e);
    }
}

        // Notify owner
        await notifyUser(
            appt.ownerId,
            `🛡️ Insurance claim auto-submitted to <strong>${insuranceCompany}</strong> ` +
            `for your accident repair at <strong>${appt.garage}</strong>. ` +
            `Policy: ${policyNo}. Awaiting insurer review.`,
            'confirmed'
        );

        // Notify garage that claim was submitted
        await notifyGarage(
            appt.garage,
            `🛡️ Insurance claim submitted for ${appt.ownerName} (${appt.vehicle}). ` +
            `Policy: ${policyNo} · Company: ${insuranceCompany}. Awaiting approval.`,
            'pending',
            appt.id
        );

        toast(`✓ Insurance claim auto-sent to ${insuranceCompany}`, 'success');
        return claimId;

    } catch(e) {
        console.error('[Insurance Claim] failed:', e);
        toast('Insurance claim submission failed', 'error');
        return null;
    }
}
async function renderInsClaims() {
    const list = document.getElementById('insClaimsList');
    if (!list) return;
    const uid = window._currentUser?.uid;
    if (!uid) return;

    const snap = await window._fsGetDoc(
        window._fsDoc(window._fbDb, 'users', uid, 'profile', 'insurance')
    );
    const myName = (snap.exists() ? snap.data().name : '').toLowerCase().trim();

    if (!myName) {
        list.innerHTML = `<div style="padding:20px;color:var(--tm)">⚠️ Complete your company profile first.</div>`;
        return;
    }

    const claimsSnap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, 'insuranceClaims')
    );
    const claims = claimsSnap.docs
        .map(d => d.data())
        .filter(c => fuzzyMatch(c.insuranceCompany || '', myName))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (!claims.length) {
        list.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tm)">
            <div style="font-size:2.5rem;margin-bottom:12px">🛡️</div>
            No claims yet for <strong>${myName}</strong>.
        </div>`;
        return;
    }

    function claimCard(c) {
        const m = c.mulkiya || {};
        const sc = c.status === 'approved' ? '#4ade80' : c.status === 'rejected' ? '#ff4444' : '#f59e0b';
        return `
        <div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};
                    border-radius:14px;padding:20px 22px;margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
                <div>
                    <div style="font-weight:800;font-size:1.05rem;color:var(--t);">${c.ownerName || 'Vehicle Owner'}</div>
                    <div style="font-size:0.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">
                        📧 ${c.ownerEmail || ''} · Policy: ${c.policyNo || '—'}
                    </div>
                </div>
                <span style="background:${sc}20;color:${sc};padding:5px 14px;border-radius:20px;
                             font-size:0.7rem;font-weight:800;border:1px solid ${sc}40;">
                    ${(c.status || 'pending').toUpperCase()}
                </span>
            </div>
            <div style="margin:14px 0;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px;
                        display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:0.8rem;">
                <div><span style="color:var(--tm);display:block;font-size:0.68rem;">VEHICLE</span>
                     <strong>${[m.make,m.bodyType,m.year].filter(v=>v&&v!=='—').join(' ')||c.vehicle||'—'}</strong></div>
                <div><span style="color:var(--tm);display:block;font-size:0.68rem;">PLATE</span>
                     <strong>${m.plateNumber||'—'}</strong></div>
                <div><span style="color:var(--tm);display:block;font-size:0.68rem;">VIN</span>
                     <strong style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${m.vin||'—'}</strong></div>
                <div><span style="color:var(--tm);display:block;font-size:0.68rem;">GARAGE</span>
                     <strong>${c.garageName||'—'}</strong></div>
                <div><span style="color:var(--tm);display:block;font-size:0.68rem;">SERVICE</span>
                     <strong>${c.serviceType||'—'}</strong></div>
                <div><span style="color:var(--tm);display:block;font-size:0.68rem;">DATE</span>
                     <strong>${c.appointmentDate||c.createdAt||'—'}</strong></div>
            </div>
            ${c.notes?`<div style="font-size:0.78rem;color:var(--td);font-style:italic;margin-bottom:12px;">📝 ${c.notes}</div>`:''}
            ${c.status==='pending'?`
            <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;">
                <input type="text" id="claimAmt_${c.id}" placeholder="Approved amount (AED)"
                    style="flex:1;min-width:160px;background:rgba(255,255,255,.06);border:1px solid var(--border);
                           border-radius:8px;padding:9px 14px;color:var(--t);font-family:'Syne',sans-serif;">
                <button onclick="processInsuranceClaim('${c.id}','approved')"
                    style="padding:9px 18px;background:rgba(74,222,128,0.1);color:#4ade80;
                           border:1px solid rgba(74,222,128,0.3);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">
                    ✅ Approve
                </button>
                <button onclick="processInsuranceClaim('${c.id}','rejected')"
                    style="padding:9px 18px;background:rgba(255,68,68,0.08);color:#ff6666;
                           border:1px solid rgba(255,68,68,0.25);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">
                    ❌ Reject
                </button>
            </div>`:
            c.status==='approved'?`<div style="margin-top:8px;font-size:0.82rem;color:#4ade80;">
                ✅ Approved${c.approvedAmount?' — AED '+c.approvedAmount:''} ${c.processedAt?'· '+c.processedAt:''}
            </div>`:`<div style="margin-top:8px;font-size:0.82rem;color:#ff6666;">
                ❌ Rejected ${c.processedAt?'· '+c.processedAt:''}
            </div>`}
        </div>`;
    }

    const pending   = claims.filter(c => c.status === 'pending');
    const processed = claims.filter(c => c.status !== 'pending');
    let html = '';
    if (pending.length)
        html += `<div style="color:#f59e0b;font-weight:700;margin-bottom:12px;">⏳ Pending (${pending.length})</div>`
              + pending.map(claimCard).join('');
    if (processed.length)
        html += `<div style="color:var(--tm);font-weight:700;margin:20px 0 12px;">📁 Processed (${processed.length})</div>`
              + processed.map(claimCard).join('');
    list.innerHTML = html;
}

async function renderInsHistory() {
    const list = document.getElementById('insHistoryList');
    if (!list) return;
    const uid = window._currentUser?.uid;
    if (!uid) return;

    const snap = await window._fsGetDoc(
        window._fsDoc(window._fbDb, 'users', uid, 'profile', 'insurance')
    );
    const myName = (snap.exists() ? snap.data().name : '').toLowerCase().trim();
    if (!myName) { list.innerHTML = `<div style="padding:20px;color:var(--tm)">Complete your profile first.</div>`; return; }

    const claimsSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'insuranceClaims'));
    const processed = claimsSnap.docs.map(d => d.data())
        .filter(c => fuzzyMatch(c.insuranceCompany || '', myName) && c.status !== 'pending')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (!processed.length) {
        list.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tm)"><div style="font-size:2.5rem;margin-bottom:12px">📁</div>No processed claims yet.</div>`;
        return;
    }
    list.innerHTML = processed.map(c => {
        const sc = c.status === 'approved' ? '#4ade80' : '#ff4444';
        return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:14px;padding:18px 20px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div><div style="font-weight:800;color:var(--t);">${c.ownerName || '—'}</div>
                <div style="font-size:0.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">${c.vehicle || '—'} · ${c.garageName || '—'}</div></div>
                <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:0.7rem;font-weight:800;border:1px solid ${sc}40;">${c.status.toUpperCase()}${c.approvedAmount ? ' — AED ' + c.approvedAmount : ''}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--td);margin-top:8px;font-family:'JetBrains Mono',monospace;">Processed: ${c.processedAt || '—'} · Policy: ${c.policyNo || '—'}</div>
        </div>`;
    }).join('');
}
async function processInsuranceClaim(claimId, decision) {
    try {
        const amount = document.getElementById(`claimAmt_${claimId}`)?.value.trim() || '';
    const btn = document.querySelector(`[onclick="processInsuranceClaim('${claimId}','${decision}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

    try {
        const amount = document.getElementById(`claimAmt_${claimId}`)?.value.trim() || '';

        // Validate amount if approving
        if (decision === 'approved' && !amount) {
            toast('Please enter an approved amount (AED)', 'error');
            if (btn) { btn.disabled = false; btn.textContent = decision === 'approved' ? '✅ Approve' : '❌ Reject'; }
            return;
        }

        const claimSnap = await window._fsGetDoc(
            window._fsDoc(window._fbDb, 'insuranceClaims', claimId)
        );
        if (!claimSnap.exists()) return toast('Claim not found', 'error');
        const claim = claimSnap.data();

        // Update the claim
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'insuranceClaims', claimId),
            {
                status:         decision,
                approvedAmount: amount || null,
                processedAt:    new Date().toLocaleDateString(),
            }
        );

        const ownerMsg = decision === 'approved'
            ? `✅ Your insurance claim for accident repair at <strong>${claim.garageName}</strong> has been <strong>approved</strong>${amount?' — AED '+amount+' authorized':''}.`
            : `❌ Your insurance claim for accident repair at <strong>${claim.garageName}</strong> was <strong>rejected</strong>. Please contact your insurer.`;
        await notifyUser(claim.ownerId, ownerMsg, decision);

        const garageMsg = decision === 'approved'
            ? `🛡️ Insurance APPROVED for ${claim.ownerName}'s vehicle (${claim.vehicle})${amount?' — AED '+amount+' authorized':''}. Proceed with repair.`
            : `🛡️ Insurance REJECTED for ${claim.ownerName}'s vehicle. Do not proceed without owner confirmation.`;
        await notifyGarage(claim.garageName, garageMsg, decision === 'approved' ? 'confirmed' : 'rejected', claim.appointmentId);

        toast(`Claim ${decision} ✓`, decision === 'approved' ? 'success' : 'error');
        renderInsClaims();
    } catch(e) {
        console.error(e);
        toast('Failed to process claim', 'error');
                processedTs:    Date.now(),
            }
        );

        // Update the linked appointment
        if (claim.appointmentId) {
            const newApptStatus = decision === 'approved' ? 'in_progress' : 'claim_rejected';
            await window._fsUpdateDoc(
                window._fsDoc(window._fbDb, 'appointments', claim.appointmentId),
                {
                    status:            newApptStatus,
                    insuranceDecision: decision,
                    approvedAmount:    amount || null,
                    insuranceUpdated:  new Date().toLocaleDateString(),
                }
            );
        }

        // Notify owner
        const ownerMsg = decision === 'approved'
            ? `✅ Your insurance claim has been <strong>approved</strong>` +
              `${amount ? ' — <strong>AED ' + amount + '</strong> authorized' : ''}. ` +
              `Repairs will begin at <strong>${claim.garageName}</strong>.`
            : `❌ Your insurance claim for repair at <strong>${claim.garageName}</strong> ` +
              `was <strong>rejected</strong>. Please contact ${claim.insuranceCompany || 'your insurer'} for details.`;
        await notifyUser(claim.ownerId, ownerMsg, decision === 'approved' ? 'confirmed' : 'rejected');

        // Notify garage
        const garageMsg = decision === 'approved'
            ? `✅ Insurance <strong>APPROVED</strong> for ${claim.ownerName} ` +
              `(${claim.vehicle})${amount ? ' — AED ' + amount + ' authorized' : ''}. ` +
              `Status updated to IN PROGRESS — proceed with repairs.`
            : `❌ Insurance <strong>REJECTED</strong> for ${claim.ownerName} ` +
              `(${claim.vehicle}). Do not proceed without owner confirmation.`;
        await notifyGarage(
            claim.garageName,
            garageMsg,
            decision === 'approved' ? 'approved' : 'rejected',
            claim.appointmentId
        );

        toast(
            decision === 'approved'
                ? `✅ Claim approved — AED ${amount} sent to garage`
                : '❌ Claim rejected — owner notified',
            decision === 'approved' ? 'success' : 'error'
        );

        // Refresh claims views
        renderInsClaims();
        renderInsHistory();
        updateBellBadge();

    } catch(e) {
        console.error('[Process Claim]', e);
        toast('Failed to process claim: ' + e.message, 'error');
        if (btn) { btn.disabled = false; }
    }
}
let mulkiyaFiles = [];
function triggerMulkiyaInput() {
    const input = document.getElementById('mulkiyaInput');
    input.value = '';
    input.click();
}

function handleMulkiyaDrop(e) {
    e.preventDefault();
    document.getElementById('mulkiyaUploadZone').style.borderColor = '';
    const files = e.dataTransfer.files;
    if (files && files.length > 0) handleMulkiyaUpload(files);
}

function handleMulkiyaUpload(files) {
    if (!files || files.length === 0) return;
    mulkiyaFiles = Array.from(files).slice(0, 2);

    // Reset previous state
    const previewDiv = document.getElementById('mulkiyaPreview');
    const autoFillBtn = document.getElementById('btnAutoFill');
    previewDiv.innerHTML = '';
    previewDiv.style.display = 'none';
    autoFillBtn.style.display = 'none';

    // Validate files
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const invalid = mulkiyaFiles.filter(f => !validTypes.includes(f.type));
    if (invalid.length) {
        toast('Please upload JPG, PNG or WEBP images only', 'error');
        mulkiyaFiles = mulkiyaFiles.filter(f => validTypes.includes(f.type));
        if (!mulkiyaFiles.length) return;
    }

    let html = '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:8px;">';
    mulkiyaFiles.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        html += `
            <div style="text-align:center;">
                <img src="${url}" style="max-width:200px;max-height:150px;border-radius:10px;
                     border:1px solid var(--border);object-fit:cover;">
                <p style="font-size:0.75rem;color:var(--tm);margin-top:6px;">
                    ${i === 0 ? '📄 Front' : '📄 Back'} · ${f.name}
                </p>
            </div>`;
    });
    html += '</div>';

    previewDiv.innerHTML = html;
    previewDiv.style.display = 'block';
    autoFillBtn.style.display = 'block';
    autoFillBtn.disabled = false;
    autoFillBtn.innerHTML = '✅ Extract & Save Information';

    toast(`${mulkiyaFiles.length} image${mulkiyaFiles.length > 1 ? 's' : ''} ready — click Extract to process`, 'info');
}
async function applyMulkiyaData() {
    if (mulkiyaFiles.length === 0) {
        toast('Please upload Mulkiya images first', 'error');
        return;
    }

    const uid = window._currentUser?.uid;
    if (!uid) return toast('Please log in first', 'error');

    const btn = document.getElementById('btnAutoFill');
    const uploadZone = document.getElementById('mulkiyaUploadZone');
    const previewDiv = document.getElementById('mulkiyaPreview');

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" 
             stroke-width="2.5" style="animation:spin 1s linear infinite">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        Analyzing with Groq Vision...
    </span>`;

    if (uploadZone) uploadZone.style.opacity = '0.5';

    // Add spinner keyframe if not present
    if (!document.getElementById('spinStyle')) {
        const s = document.createElement('style');
        s.id = 'spinStyle';
        s.innerHTML = '@keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }';
        document.head.appendChild(s);
    }

    // Progress feedback
    const steps = [
        'Reading image data...',
        'Sending to Groq Vision AI...',
        'Extracting Mulkiya fields...',
        'Saving to your profile...'
    ];
    let stepIdx = 0;
    const stepTimer = setInterval(() => {
        if (stepIdx < steps.length - 1) {
            stepIdx++;
            toast(steps[stepIdx], 'info');
        }
    }, 2500);

    try {
        toast(steps[0], 'info');

        // Convert to base64
        const base64Images = await Promise.all(mulkiyaFiles.map(fileToBase64));

        // Call Groq Vision
        const groqResponse = await callGroqVision(base64Images);

        // Parse response
        const extracted = parseGroqResponse(groqResponse);

        // Check if we got useful data
        const hasUsefulData = ['ownerName','make','plateNumber','vin','year']
            .some(k => extracted[k] && extracted[k] !== '—');

        if (!hasUsefulData) {
            throw new Error('Could not extract data from images. Please upload clearer photos of your Mulkiya.');
        }

        // Add metadata
        const vehicleId = 'vehicle_' + Date.now();
        extracted._vehicleId = vehicleId;
        extracted._addedAt = new Date().toLocaleDateString();

        // Save to Firestore
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'vehicles', vehicleId),
            extracted
        );
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'activeVehicle'),
            { vehicleId }
        );
        // Keep legacy path working
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya'),
            extracted
        );

        // Update in-memory state
        if (!window._ownerVehicles) window._ownerVehicles = [];
        const existingIdx = window._ownerVehicles.findIndex(v => v._vehicleId === vehicleId);
        if (existingIdx === -1) {
            window._ownerVehicles.push(extracted);
        } else {
window._ownerVehicles[existingIdx] = extracted;
        }
        window._activeVehicle = extracted;

        clearInterval(stepTimer);
        toast('✅ Mulkiya extracted & saved!', 'success');

        // Show what was extracted
        const found = ['ownerName','make','bodyType','year','plateNumber','vin']
            .filter(k => extracted[k] && extracted[k] !== '—')
            .map(k => extracted[k])
            .join(' · ');
        if (found) toast(`Found: ${found}`, 'success');

        // Show profile
        showProfileDisplay(extracted, uid, window._ownerVehicles);

    } catch(err) {
        clearInterval(stepTimer);
        console.error('[Mulkiya Extract]', err);
        toast(err.message || 'Extraction failed — please try again', 'error');

        // Reset button so user can retry
        btn.disabled = false;
        btn.innerHTML = '🔄 Try Again';
        if (uploadZone) uploadZone.style.opacity = '1';
        return;

    } finally {
        clearInterval(stepTimer);
        btn.disabled = false;
        btn.innerHTML = '✅ Extract & Save Information';
        if (uploadZone) uploadZone.style.opacity = '1';
        mulkiyaFiles = [];
    }
}
function showProfileDisplay(data, uid, allVehicles) {
if (!allVehicles || !allVehicles.length) {
    allVehicles = window._ownerVehicles && window._ownerVehicles.length 
        ? window._ownerVehicles 
        : [data];
}
window._ownerVehicles = allVehicles;
window._activeVehicle = data;

    // Show the display state, hide upload state
document.getElementById('profileUploadState').style.display = 'none';
document.getElementById('profileUploadHeader').style.display = 'none';
const displayEl = document.getElementById('profileDisplayState');
displayEl.style.display = 'block';

    const name = data.ownerName && data.ownerName !== '—' ? data.ownerName : 'Vehicle Owner';

    // Update the static hero elements (these exist in the original HTML hero banner)


    // Build and inject the dashboard HTML into profileDisplayState
const display = displayEl;
display.innerHTML = _buildProfileDashboard(data, name);

    // NOW add the vehicle switcher bar AFTER innerHTML is set
    // Vehicle switcher bar
requestAnimationFrame(() => {
    const existing = document.getElementById('vehicleSwitcherBar');
    if (existing) existing.remove();

    if (allVehicles.length > 0) {
        const switcher = document.createElement('div');
        switcher.id = 'vehicleSwitcherBar';
        switcher.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px 20px;margin:16px 24px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;';
        switcher.innerHTML = `
            <span style="font-size:0.72rem;color:var(--tm);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;flex-shrink:0;">My Vehicles:</span>
            ${allVehicles.map(v => {
                const label = [v.make, v.bodyType, v.year].filter(x => x && x !== '—').join(' ') || 'Vehicle';
                const isActive = v._vehicleId === data._vehicleId;
                return `<button onclick="switchActiveVehicle('${v._vehicleId}')"
                    style="padding:6px 14px;border-radius:8px;font-size:0.78rem;font-weight:700;
                    cursor:pointer;font-family:'Syne',sans-serif;
                    border:1px solid ${isActive ? 'var(--c)' : 'var(--border)'};
                    background:${isActive ? 'rgba(200,216,228,0.12)' : 'transparent'};
                    color:${isActive ? 'var(--c)' : 'var(--tm)'};">${label}</button>`;
            }).join('')}
            <button onclick="addNewVehicle()"
                style="padding:6px 14px;border-radius:8px;font-size:0.78rem;font-weight:700;
                cursor:pointer;font-family:'Syne',sans-serif;
                border:1px solid rgba(74,222,128,0.4);background:rgba(74,222,128,0.08);
                color:#4ade80;margin-left:auto;">+ Add Vehicle</button>
        `;
        display.insertBefore(switcher, display.firstChild);
    }
});
    // Animate stat rings and cards
 // Animate stat rings and cards
requestAnimationFrame(() => {
    requestAnimationFrame(() => {
        setTimeout(() => {
            display.querySelectorAll('.ring-fill').forEach(el => {
                el.style.strokeDashoffset = el.dataset.offset;
            });
            display.querySelectorAll('.card-fade').forEach((el, i) => {
                setTimeout(() => el.classList.add('card-visible'), i * 100);
            });
        }, 120);
    });
});

    // Load inspection stats
loadHistory().then(records => {
    const owned = records.filter(r => !r.role || r.role === 'owner');
    const total = owned.length;
    const passed = owned.filter(r => r.status === 'pass').length;
    const issues = owned.filter(r => r.status !== 'pass').length;
    ['pds-inspections','profileStatInspections'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = total;
    });
    ['pds-passed','profileStatPassed'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = passed;
    });
    ['pds-issues','profileStatIssues'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = issues;
    });
});

    // Pre-fill inspection step 1 fields
    ['vin','make','model','year'].forEach(id => {
        const el = document.getElementById(id);
        const val = id === 'model' ? (data.bodyType || data.model) : data[id];
        if (el && val && val !== '—') el.value = val;
    });
}
function _buildProfileDashboard(data, name) {
    const plate = data.plateNumber && data.plateNumber !== '—' ? data.plateNumber : '—';
    const plateParts = plate.includes('/') ? plate.split('/').map(s => s.trim()) : [plate, ''];

    // Expiry ring helper
    function expiryRing(label, dateStr, color) {
        const R = 22, C = 2 * Math.PI * R;
        let pct = 0.65; // default visual
        let expired = false;
        if (dateStr && dateStr !== '—') {
            const parts = dateStr.split(/[-\/]/);
            const parsed = new Date(dateStr.replace(/(\d{2})-([A-Z]{3})-(\d{2,4})/i, (_, d, m, y) => `${m} ${d} ${y.length === 2 ? '20' + y : y}`));
            if (!isNaN(parsed)) {
                const now = new Date();
                const diff = parsed - now;
                const days = diff / 86400000;
                expired = days < 0;
                pct = expired ? 0 : Math.min(1, days / 365);
            }
        }
        const offset = C - pct * C;
        const statusColor = expired ? '#ff4444' : pct < 0.2 ? '#f59e0b' : color;
        return `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="position:relative;width:52px;height:52px;flex-shrink:0;">
                <svg width="52" height="52" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="${R}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3"/>
                    <circle cx="26" cy="26" r="${R}" fill="none" stroke="${statusColor}" stroke-width="3"
                        stroke-dasharray="${C}" stroke-dashoffset="${C}"
                        class="ring-fill" data-offset="${offset}"
                        style="transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)"/>
                </svg>
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:${statusColor};font-family:'JetBrains Mono',monospace;">${expired ? '!' : Math.round(pct * 100) + '%'}</div>
            </div>
            <div>
                <div style="font-size:0.7rem;color:var(--tm);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;">${label}</div>
                <div style="font-size:0.88rem;font-weight:700;color:${expired ? '#ff4444' : 'var(--t)'};margin-top:2px;">${dateStr && dateStr !== '—' ? dateStr : 'Not provided'}</div>
                <div style="font-size:0.68rem;color:${expired ? '#ff4444' : '#4ade80'};margin-top:1px;font-family:'JetBrains Mono',monospace;">${expired ? '● EXPIRED' : '● ACTIVE'}</div>
            </div>
        </div>`;
    }

    function fieldRow(label, value) {
        const valid = value && value !== '—';
        return `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:0.72rem;color:var(--tm);font-family:'JetBrains Mono',monospace;flex-shrink:0;padding-right:12px;">${label}</span>
            <span style="font-size:0.84rem;font-weight:600;color:${valid ? 'var(--t)' : 'var(--td)'};text-align:right;">${valid ? value : '—'}</span>
        </div>`;
    }

    function card(icon, title, content, accent) {
        return `
        <div class="card-fade" style="background:var(--bg3);border:1px solid var(--border);border-radius:16px;overflow:hidden;opacity:0;transform:translateY(16px);transition:opacity 0.4s ease,transform 0.4s ease;">
            <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,${accent}12,transparent);">
                <span style="font-size:1rem;">${icon}</span>
                <span style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:${accent};font-family:'JetBrains Mono',monospace;">${title}</span>
            </div>
            <div style="padding:4px 18px 14px;">${content}</div>
        </div>`;
    }

    // Timeline status bar
    const timeline = `
    <div style="padding:16px 20px;">
        <div style="font-size:0.68rem;color:var(--tm);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;">Vehicle Status History</div>
        <div style="display:flex;align-items:center;gap:0;position:relative;">
            <div style="position:absolute;top:50%;left:0;right:0;height:2px;background:rgba(255,255,255,0.08);transform:translateY(-50%);z-index:0;"></div>
            ${[
                { label: 'Initial Reg', color: 'var(--c)', done: true },
                { label: 'Ins. Confirmed', color: '#4ade80', done: true },
                { label: 'Pending Renewal', color: '#f59e0b', done: false },
            ].map((s, i) => `
            <div style="flex:1;text-align:center;position:relative;z-index:1;">
                <div style="width:10px;height:10px;border-radius:50%;background:${s.color};margin:0 auto 8px;box-shadow:0 0 8px ${s.color}80;"></div>
                <div style="font-size:0.62rem;color:${s.done ? s.color : 'var(--tm)'};font-family:'JetBrains Mono',monospace;font-weight:${s.done ? '700' : '400'};">${s.label}</div>
            </div>`).join('')}
        </div>
    </div>`;

    return `
    <style>
.card-visible { opacity: 1 !important; transform: translateY(0) !important; transition: opacity 0.5s ease, transform 0.5s ease !important; }        .profile-hero-parallax {
            background: linear-gradient(135deg,#0a1628 0%,#0f2347 40%,#0c1e3d 100%);
            background-attachment: scroll;
            position: relative; overflow: hidden;
        }
        .pds-plate {
            background: #f5f0e0;
            border-radius: 8px;
            border: 2px solid #c8a84b;
            padding: 6px 16px 6px 10px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .pds-plate-emirate {
            background: linear-gradient(135deg,#006233,#006233);
            color: #fff;
            font-size: 0.52rem;
            font-weight: 800;
            padding: 3px 5px;
            border-radius: 4px;
            font-family: 'JetBrains Mono',monospace;
            letter-spacing: 0.05em;
            line-height: 1.2;
            text-align: center;
        }
        .pds-plate-num {
            font-size: 1.6rem;
            font-weight: 900;
            color: #1a1a1a;
            font-family: 'JetBrains Mono',monospace;
            letter-spacing: 0.05em;
        }
        .pds-action-btn {
            display: block;
            width: 100%;
            padding: 9px 14px;
            border-radius: 8px;
            font-size: 0.78rem;
            font-weight: 700;
            font-family: 'Syne',sans-serif;
            cursor: pointer;
            text-align: center;
            margin-bottom: 8px;
            transition: all 0.2s;
            border: 1px solid transparent;
        }
    </style>

    <!-- HERO -->
    <div class="profile-hero-parallax" style="padding:40px 32px 0;">
        <div style="position:absolute;top:-60px;right:-60px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(200,216,228,0.06) 0%,transparent 70%);pointer-events:none;"></div>
        <div style="position:absolute;bottom:-80px;left:-40px;width:250px;height:250px;border-radius:50%;background:radial-gradient(circle,rgba(59,130,246,0.05) 0%,transparent 70%);pointer-events:none;"></div>
        
        <div style="max-width:1100px;margin:0 auto;position:relative;z-index:1;">
            <!-- Top row -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:28px;">
                <div style="display:flex;align-items:center;gap:20px;">
                    <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--c),#3b82f6);display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:800;color:#fff;border:2px solid rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,0.4);">
                        ${name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(200,216,228,0.5);font-family:'JetBrains Mono',monospace;margin-bottom:4px;">Vehicle Owner · UAE</div>
                        <div style="font-size:1.6rem;font-weight:800;color:#fff;line-height:1.1;">${name}</div>
                        <div style="font-size:0.78rem;color:rgba(200,216,228,0.6);margin-top:4px;font-family:'JetBrains Mono',monospace;">${[data.ownerNationality, data.placeOfIssue].filter(v => v && v !== '—').join(' · ')}</div>
                    </div>
                </div>

                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                    <!-- Plate -->
                    <div class="pds-plate">
                        <div class="pds-plate-emirate">DUBAI<br>دبي</div>
                        <div>
                            ${plateParts[0] ? `<div style="font-size:0.6rem;color:#666;font-family:'JetBrains Mono',monospace;text-align:center;line-height:1;">${plateParts[0]}</div>` : ''}
                            <div class="pds-plate-num">${plateParts[1] || plate}</div>
                        </div>
                    </div>
                    <button onclick="resetMulkiyaProfile()" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);padding:8px 16px;border-radius:8px;font-size:0.72rem;cursor:pointer;font-family:'Syne',sans-serif;transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.07)'">↺ Re-upload</button>
                </div>
            </div>

            <!-- Stat strip -->
            <div style="display:flex;border-top:1px solid rgba(255,255,255,0.07);padding-top:0;">
                ${[
                    { id: 'pds-inspections', val: '0', label: 'Total Inspections', color: 'var(--c)' },
                    { id: 'pds-passed', val: '0', label: 'Passed Clean', color: '#4ade80' },
                    { id: 'pds-issues', val: '0', label: 'Need Attention', color: '#f59e0b' },
                ].map((s, i, arr) => `
                <div style="flex:1;padding:18px 0;text-align:center;${i < arr.length - 1 ? 'border-right:1px solid rgba(255,255,255,0.07);' : ''}">
                    <div id="${s.id}" style="font-size:1.6rem;font-weight:800;color:${s.color};font-family:'JetBrains Mono',monospace;">${s.val}</div>
                    <div style="font-size:0.62rem;color:rgba(200,216,228,0.45);text-transform:uppercase;letter-spacing:0.1em;margin-top:3px;">${s.label}</div>
                </div>`).join('')}
            </div>
        </div>
    </div>

    <!-- CARDS GRID -->
    <div style="max-width:1100px;margin:28px auto;padding:0 24px;display:grid;grid-template-columns:repeat(3,1fr) 220px;gap:16px;align-items:start;">

        <!-- Personal & Driver Info -->
        ${card('👤', 'Personal & Driver Info',
            fieldRow('Owner', data.ownerName) +
            fieldRow('Nationality', data.ownerNationality) +
            fieldRow('T.C. No.', data.trafficCode) +
            fieldRow('Place of Issue', data.placeOfIssue) +
            fieldRow('Mortgaged By', data.mortgagedBy),
            'var(--c)'
        )}

        <!-- Vehicle Registration -->
        ${card('🚗', 'Vehicle Registration',
            fieldRow('VIN', data.vin) +
            fieldRow('Engine No.', data.engineNumber) +
            fieldRow('Make', data.make) +
            fieldRow('Body Type', data.bodyType) +
            fieldRow('Year', data.year) +
            fieldRow('Plate Kind', data.plateKind),
            '#4ade80'
        )}

        <!-- Technical Specs -->
        ${card('⚙️', 'Technical Specifications',
            fieldRow('Body Type', data.bodyType) +
            fieldRow('Color', data.color) +
            fieldRow('Fuel Type', data.fuelType) +
            fieldRow('Cylinders', data.cylinders) +
            fieldRow('Gross Weight', data.grossWeight) +
            fieldRow('Unladen Weight', data.unladenWeight),
            '#f59e0b'
        )}

                <!-- Expiry & Status Card -->
   <!-- Expiry & Status Card -->
        <div class="card-fade" style="background:var(--bg3);border:1px solid var(--border);border-radius:16px;overflow:hidden;opacity:0;transform:translateY(16px);transition:opacity 0.4s ease,transform 0.4s ease;">
            <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,rgba(200,216,228,0.08),transparent);">
                <span style="font-size:1rem;">📋</span>
                <span style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--c);font-family:'JetBrains Mono',monospace;">Registration & Insurance</span>
            </div>
            <div style="padding:4px 18px 14px;">
                ${expiryRing('Reg. Expiry', data.registrationExpiry, 'var(--c)')}
                ${expiryRing('Ins. Expiry', data.insuranceExpiry, '#f59e0b')}
                <div style="padding:12px 0 4px;">
                    ${fieldRow('Insurance Co.', data.insuranceCompany)}
                    ${fieldRow('Policy No.', data.insurancePolicy)}
                </div>
            </div>
        </div>
    
   
            ${timeline}
            <div style="padding:10px 20px;border-top:1px solid rgba(255,255,255,0.04);font-size:0.62rem;color:var(--td);font-family:'JetBrains Mono',monospace;text-align:center;letter-spacing:0.08em;">
                OFFICIAL VEHICLE RECORD · EXTRACTED VIA AI · MEHRA PLATFORM
            </div>
        </div>

    </div>`;
}
function _renderProfileFields(containerId, fields) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = fields.map(([label, value]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:0.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace;">${label}</span>
            <span style="font-size:0.88rem;font-weight:600;color:${(!value || value === '—') ? 'var(--td)' : 'var(--t)'};text-align:right;max-width:60%;">${value || '—'}</span>
        </div>`).join('');
}

async function resetMulkiyaProfile() {
    mulkiyaFiles = [];
    document.getElementById('profileDisplayState').style.display = 'none';
    document.getElementById('profileUploadState').style.display = 'block';
    document.getElementById('profileUploadHeader').style.display = 'block';
    document.getElementById('mulkiyaPreview').style.display = 'none';
    document.getElementById('btnAutoFill').style.display = 'none';
    document.getElementById('mulkiyaInput').value = '';
}

async function checkAndLoadSavedProfile() {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    try {
        // First try the new vehicles subcollection
        const vSnap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
        );

        if (!vSnap.empty) {
            // New multi-vehicle path
            const vehicles = vSnap.docs
                .map(d => d.data())
                .sort((a, b) => (b._addedAt || '') > (a._addedAt || '') ? 1 : -1);
            window._ownerVehicles = vehicles;
            window._activeVehicle = vehicles[0];
            showProfileDisplay(vehicles[0], uid, vehicles);
            return;
        }

        // Fallback: try the old single mulkiya doc
        const mSnap = await window._fsGetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya')
        );

        if (mSnap.exists() && mSnap.data().ownerName) {
            const data = mSnap.data();
            // Migrate it to the new vehicles subcollection automatically
            const vehicleId = 'vehicle_' + Date.now();
            data._vehicleId = vehicleId;
            data._addedAt = new Date().toLocaleDateString();
            await window._fsSetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'vehicles', vehicleId),
                data
            );
            await window._fsSetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'activeVehicle'),
                { vehicleId }
            );
            // Also keep the legacy single-doc path so insurance claims,
        // appointments, renewal and marketplace still work
        

        // Update in-memory state
        if (!window._ownerVehicles) window._ownerVehicles = [];
        // Avoid duplicates
       window._ownerVehicles = [data];
        window._activeVehicle = data;
            window._activeVehicle = data;
            showProfileDisplay(data, uid, [data]);
        }
    } catch(e) {
        console.warn('[Profile] load failed:', e);
    }
}
async function checkExpiryWarnings() {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    try {
        const snap = await window._fsGetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya')
        );
        if (!snap.exists()) return;
        const d = snap.data();
        const now = new Date();
        const warnDays = 30;

        const checks = [
            { label: 'Registration', date: d.registrationExpiry },
            { label: 'Insurance', date: d.insuranceExpiry },
        ];
    let data = window._activeVehicle || null;
if (!data) {
    const vSnap = await window._fsGetDocs(
        window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
    );
    if (vSnap.empty) return;
    data = vSnap.docs[0].data();
}
        const now = new Date();
        const warnDays = 30;

    const checks = [
    { label: 'Registration', date: data.registrationExpiry },
    { label: 'Insurance', date: data.insuranceExpiry },
];

        for (const c of checks) {
            if (!c.date || c.date === '—') continue;
            const exp = new Date(c.date);
            if (isNaN(exp)) continue;
            const daysLeft = Math.ceil((exp - now) / 86400000);
            if (daysLeft <= 0) {
                toast(`⚠️ ${c.label} EXPIRED on ${c.date}`, 'error');
                await notifyUser(uid,
                    `⚠️ Your vehicle <strong>${c.label}</strong> has expired (${c.date}). Renew immediately.`,
                    'rejected'
                );
            } else if (daysLeft <= warnDays) {
                toast(`⏰ ${c.label} expires in ${daysLeft} days`, 'info');
                await notifyUser(uid,
                    `⏰ Your <strong>${c.label}</strong> expires in <strong>${daysLeft} days</strong> (${c.date}). Book a renewal soon.`,
                    'confirmed'
                );
            }
        }
    } catch(e) { console.warn('[Expiry Check]', e); }
}
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
function fetchWithTimeout(url, options, ms = 20000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(id));
}
// ==================== UPDATED GROQ VISION CALL ====================
async function callGroqVision(base64Images) {
  const GROQ_API_KEY = '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';
  
  const MODELS = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.2-11b-vision-preview',
    'llama-3.2-90b-vision-preview',
  ];

  const prompt = `You are an expert OCR system for UAE Mulkiya cards.
Extract all text and return ONLY valid JSON with NO markdown. Use "—" for missing fields.
Keys: ownerName, ownerNationality, trafficCode, registrationDate,
registrationExpiry, insuranceExpiry, insuranceCompany, insurancePolicy,
mortgagedBy, plateNumber, placeOfIssue, plateKind, vin, engineNumber,
make, model, year, vehicleType, bodyType, color, unladenWeight,
grossWeight, cylinders, fuelType, seats`;

  for (const model of MODELS) {
    try {
      console.log('[Groq] Trying model:', model);
      const response = await fetchWithTimeout(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...base64Images.map(b64 => ({
                  type: 'image_url',
                  image_url: { url: b64, detail: 'high' }
                }))
                  ]
            }],
            temperature: 0.0,
            max_tokens: 1024
          })
        },
        20000
      );

      if (!response.ok) {
        const err = await response.text();
        console.warn(`[Groq] ${model} failed ${response.status}:`, err);
        continue;
      }

      const data = await response.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      if (!text) { console.warn('[Groq] Empty response from', model); continue; }
      console.log('[Groq] Success with', model);
      return text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    } catch (e) {
      console.warn(`[Groq] ${model} error:`, e.message);
      if (e.name === 'AbortError') toast(`Model ${model} timed out, trying next...`, 'info');
    }
  }

  throw new Error('All Groq Vision models failed — check console for details');
}

function parseGroqResponse(text) {
    const requiredKeys = [
        "ownerName","ownerNationality","trafficCode","registrationDate",
        "registrationExpiry","insuranceExpiry","insuranceCompany",
        "insurancePolicy","mortgagedBy","plateNumber","placeOfIssue",
        "plateKind","vin","engineNumber","make","model","year",
        "vehicleType","bodyType","color","unladenWeight","grossWeight",
        "cylinders","fuelType","seats"
    ];

    try {
        // Find JSON object in response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');

        let parsed = JSON.parse(jsonMatch[0]);

        // Ensure all keys exist and clean values
        requiredKeys.forEach(key => {
            if (!parsed[key] || 
                parsed[key] === '' || 
                parsed[key] === null || 
                parsed[key] === undefined ||
                parsed[key] === 'null' ||
                parsed[key] === 'N/A' ||
                parsed[key] === 'n/a') {
                parsed[key] = '—';
            } else {
                // Clean the value
                parsed[key] = String(parsed[key]).trim();
            }
        });

        // Validate we got something useful
        const hasData = ['ownerName','make','plateNumber','vin']
            .some(k => parsed[k] && parsed[k] !== '—');

        if (!hasData) {
            throw new Error('Extraction returned no useful data');
        }

        return parsed;

    } catch(e) {
        console.warn('[Mulkiya Parser] Failed:', e.message, '\nRaw:', text);
        toast('Could not read Mulkiya clearly — please ensure images are sharp and well-lit', 'error');

        // Return empty template instead of fake data
        const empty = {};
        requiredKeys.forEach(k => empty[k] = '—');
        return empty;
    }
}
function preprocessImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.max(1, 2400 / Math.max(img.width, img.height));
            const W = Math.round(img.width * scale);
            const H = Math.round(img.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, W, H);

            const imageData = ctx.getImageData(0, 0, W, H);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                // Grayscale
                const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                
                // Gentler contrast — don't destroy digits
                const contrasted = ((gray - 128) * 1.4) + 128;
                const val = Math.max(0, Math.min(255, contrasted));
                
                // SOFTER threshold — was 140/100, now 160/80
                // This preserves more of the thin digit strokes
                const final = val > 160 ? 255 : val < 80 ? 0 : val;
                
                data[i] = data[i+1] = data[i+2] = final;
            }

            ctx.putImageData(imageData, 0, 0);
            URL.revokeObjectURL(url);
            canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), 'image/png');
        };
        img.src = url;
    });
}



function parseMulkiyaText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    function findValue(labels) {
        for (const label of labels) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const idx = line.toUpperCase().indexOf(label.toUpperCase());
                if (idx === -1) continue;

                // Get everything after the label on the same line
                const rest = line.slice(idx + label.length).replace(/^[\s:\-\|()]+/, '').trim();
                const clean = cleanValue(rest);
                if (clean.length > 1) return clean;

                // Check next 1-2 lines
                for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
                    const next = cleanValue(lines[j]);
                    if (next.length > 1) return next;
                }
            }
        }
        return '—';
    }

    function cleanValue(raw) {
    return raw
        // Remove Arabic Unicode blocks
        .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, '')
        // Remove pipe chars and lone brackets
        .replace(/\|/g, ' ')
        .replace(/[()]/g, ' ')
        // Remove leading junk only (not hyphens mid-string)
        .replace(/^[\s.\-:\/]+/, '')
        // Remove trailing junk
        .replace(/[\s.\-:\/]+$/, '')
        // Collapse spaces
        .replace(/\s{2,}/g, ' ')
        // Remove leaked label/noise words — but NOT mid-code words like TEST
        .replace(/\b(SPECIMEN|DOC|BKS|AE|PROJECT|EXTRACT|FAKE|DATA|FICTIONAL|FICTION)\b/gi, '')
        // Remove lone single characters left over
        .replace(/\b[a-zA-Z]\b/g, '')
        .trim();
}

    // Extract plate number specially — it's often "2 / 56789" format
    function findPlate() {
        for (const line of lines) {
            if (/traffic\s*plate/i.test(line) || /plate\s*no/i.test(line)) {
                // Look for pattern like "2 / 56789" or "2/56789"
                const plateMatch = line.match(/(\d+\s*\/\s*\d+)/);
                if (plateMatch) return plateMatch[1].replace(/\s/g, '');
            }
        }
        // Fallback: scan all lines for plate pattern
        for (const line of lines) {
            const m = line.match(/^(\d{1,2}\s*\/\s*\d{4,6})$/);
            if (m) return m[1].replace(/\s/g, '');
        }
        return '—';
    }

    // Extract dates — look for DD-MON-YY or DD-MON-YYYY patterns
    function findDate(labels) {
        const dateRegex = /\d{1,2}[-\/]\w{3,}[-\/]\d{2,4}/;
        for (const label of labels) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toUpperCase().indexOf(label.toUpperCase()) === -1) continue;
                // Search this line and next 2 for a date
                for (let j = i; j <= i + 2 && j < lines.length; j++) {
                    const m = lines[j].match(dateRegex);
                    if (m) return m[0];
                }
            }
        }
        return '—';
    }

    // Extract numbers cleanly
    function findNumber(labels) {
        for (const label of labels) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toUpperCase().indexOf(label.toUpperCase()) === -1) continue;
                const rest = lines[i].slice(lines[i].toUpperCase().indexOf(label.toUpperCase()) + label.length);
                // Find first number sequence
                const m = rest.match(/\d[\d\s]*/) || 
                          (lines[i+1] && lines[i+1].match(/^\d[\d\s]*/));
                if (m) return m[0].trim();
            }
        }
        return '—';
    }

    // Extract VIN/chassis — alphanumeric, typically 17 chars
    function findVIN() {
        // First look for 17-char alphanumeric sequence
        for (const line of lines) {
            const m = line.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
            if (m) return m[1].toUpperCase();
        }
        // Fallback: look near "Chassis" label
        for (let i = 0; i < lines.length; i++) {
            if (/chassis/i.test(lines[i])) {
                for (let j = i; j <= i + 2 && j < lines.length; j++) {
                    const m = lines[j].match(/[A-Z0-9]{10,}/i);
                    if (m) return cleanValue(m[0]);
                }
            }
        }
        return '—';
    }

    // Extract weight — look for NNN KG pattern
  function findWeight(labels) {
    for (const label of labels) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toUpperCase().indexOf(label.toUpperCase()) === -1) continue;
            // Search this line and next 3
            for (let j = i; j <= i + 3 && j < lines.length; j++) {
                // Match full number — could be 1800, 2200 etc.
                const m = lines[j].match(/\b(\d{3,5})\s*KG/i);
                if (m) return m[1] + ' KG';
            }
        }
    }
    return '—';
}

    return {
        ownerName:          findValue(['Owner']),
        ownerNationality:   findValue(['Nationality']),
        trafficCode:        findNumber(['T.C. No', 'TC No', 'T.C.No', 'T. C. No']),
        registrationDate:   findDate(['Reg. Date', 'Reg.Date', 'Registration Date']),
        registrationExpiry: findDate(['Exp. Date', 'Exp.Date', 'Expiry']),
        insuranceExpiry:    findDate(['Ins. Exp', 'Ins.Exp', 'Insurance Exp']),
        insuranceCompany:   findValue(['Insurance Co']),
        insurancePolicy:    findValue(['Policy No']),
        mortgagedBy:        findValue(['Mortgage By', 'Mortgaged By']),
        plateNumber:        findPlate(),
        placeOfIssue:       findValue(['Place of Issue']),
        plateKind:          findValue(['Plate Source', 'Source/Kind']),
        vin:                findVIN(),
        engineNumber:       findValue(['Engine No']),
        make:               findValue(['Make']),
        year:               findNumber(['Year of Manufacture', 'Year of Mfr']),
        vehicleType:        findValue(['Vehicle Type']),
        bodyType:           findValue(['Body Type']),
        color:              findValue(['Color', 'Colour']),
        unladenWeight:      findWeight(['Unladen Weight', 'Empty Weight']),
        grossWeight:        findWeight(['Gross Weight']),
        cylinders:          findNumber(['Cylinders']),
        fuelType:           findValue(['Fuel Type']),
        seats:              findNumber(['Number of Seats', 'Seats']),
    };
}
// Better extraction helper - looks for keyword near numbers/words
function extractBetter(text, keywords) {
    for (let kw of keywords) {
        const regex = new RegExp(`${kw}\\s*[:\\-]?\\s*([\\w\\s\\/\\-\\.]+?)(?=\\s*(?:\\b[A-Z]{2,}|\\d{4}|KG|TEST|$))`, 'i');
        const match = text.match(regex);
        if (match && match[1]) {
            let val = match[1].trim();
            // Clean common noise
            val = val.replace(/SPECIMEN|TEST|FICTION|PROJECT/gi, '').trim();
            if (val.length > 3) return val;
        }
    }
    return '';
}

function extractField(text, keywords) {
    for (let kw of keywords) {
        // Try different patterns
        let regex = new RegExp(kw + '\\s*[:\\-]?\\s*([\\w\\s\\/\\-\\.]+?)(?=\\s*(?:\\b[A-Z]{3,}|\\d{4}|KG|TEST|NULL|$))', 'i');
        let match = text.match(regex);
        
        if (match && match[1]) {
            let value = match[1].trim();
            value = value.replace(/SPECIMEN|TEST|FICTION|PROJECT|DOC-BKS/gi, '').trim();
            if (value.length > 2 && value !== 'NO') return value;
        }

        // Fallback: look for the keyword and take next meaningful word/number
        regex = new RegExp(kw + '\\s+([\\w\\d\\s\\/\\-]+)', 'i');
        match = text.match(regex);
        if (match && match[1]) {
            let value = match[1].trim();
            value = value.replace(/SPECIMEN|TEST|FICTION/gi, '').trim();
            if (value.length > 2) return value;
        }
    }
    return "—";
}
function renderMulkiyaExtractedCard(data) {
    const card = document.getElementById('mulkiyaExtractedCard');
    card.style.display = 'block';

    card.innerHTML = `
    <div style="margin-top:24px; border:1px solid rgba(100,200,255,.3); border-radius:16px; background:rgba(30,40,60,.95); padding:28px; box-shadow:0 10px 30px rgba(0,0,0,0.4);">
        
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:16px;">
            <div style="font-size:2.6rem">🪪</div>
            <div>
                <div style="font-weight:800; font-size:1.35rem; color:#fff;">UAE Vehicle License (Mulkiya)</div>
                <div style="color:#88ccff; font-size:0.92rem;">Extracted • Ready for Inspections</div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:28px;">

            <!-- Owner Information -->
            <div>
                <h4 style="margin:0 0 16px 0; color:#88ccff; font-size:1.1rem; font-weight:700; letter-spacing:0.5px;">👤 OWNER INFORMATION</h4>
                <div style="background:rgba(255,255,255,0.06); border-radius:12px; padding:20px; line-height:1.85; font-size:0.96rem;">
                    <strong style="color:#ddd;">Owner Name:</strong> ${data.ownerName}<br>
                    <strong style="color:#ddd;">Nationality:</strong> ${data.ownerNationality}<br>
                    <strong style="color:#ddd;">T.C. No.:</strong> ${data.trafficCode}<br>
                    <strong style="color:#ddd;">Place of Issue:</strong> ${data.placeOfIssue}<br>
                    <strong style="color:#ddd;">Registration Expiry:</strong> ${data.registrationExpiry}<br>
                    <strong style="color:#ddd;">Insurance Expiry:</strong> ${data.insuranceExpiry}<br>
                    <strong style="color:#ddd;">Insurance Company:</strong> ${data.insuranceCompany}<br>
                    <strong style="color:#ddd;">Policy No.:</strong> ${data.insurancePolicy}<br>
                    <strong style="color:#ddd;">Mortgaged By:</strong> ${data.mortgagedBy}
                </div>
            </div>

            <!-- Vehicle Information -->
            <div>
                <h4 style="margin:0 0 16px 0; color:#88ccff; font-size:1.1rem; font-weight:700; letter-spacing:0.5px;">🚗 VEHICLE INFORMATION</h4>
                <div style="background:rgba(255,255,255,0.06); border-radius:12px; padding:20px; line-height:1.85; font-size:0.96rem;">
                    <strong style="color:#ddd;">Plate Number:</strong> ${data.plateNumber}<br>
                    <strong style="color:#ddd;">Plate Kind:</strong> ${data.plateKind}<br>
                    <strong style="color:#ddd;">VIN (Chassis No.):</strong> ${data.vin}<br>
                    <strong style="color:#ddd;">Engine No.:</strong> ${data.engineNumber}<br>
                    <strong style="color:#ddd;">Make:</strong> ${data.make}<br>
                    <strong style="color:#ddd;">Year of Manufacture:</strong> ${data.year}<br>
                    <strong style="color:#ddd;">Body Type:</strong> ${data.bodyType}<br>
                    <strong style="color:#ddd;">Color:</strong> ${data.color}<br>
                    <strong style="color:#ddd;">Fuel Type:</strong> ${data.fuelType}<br>
                    <strong style="color:#ddd;">Gross Weight:</strong> ${data.grossWeight}<br>
                    <strong style="color:#ddd;">Unladen Weight:</strong> ${data.unladenWeight}
                </div>
            </div>

        </div>
    </div>`;
}
// Auto-load saved Mulkiya data into Step 1 when opening inspection
async function loadMulkiyaData() {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    try {
        let vehicles = [];

        // Try vehicles subcollection first
        const vSnap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
        );

        if (!vSnap.empty) {
            vehicles = vSnap.docs.map(d => d.data())
                .sort((a, b) => (b._addedAt || '') > (a._addedAt || '') ? 1 : -1);
        } else {
            // Fallback to legacy mulkiya doc
            const mSnap = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya')
            );
            if (mSnap.exists()) vehicles = [mSnap.data()];
        }

        if (!vehicles.length) return;

        // Always store for picker
        window._step1Vehicles = vehicles;

        const banner = document.getElementById('step1MulkiyaBanner');
        const nameEl = document.getElementById('step1OwnerName');

        if (vehicles.length > 1) {
            // Show vehicle picker inside the banner
            if (banner) {
                banner.style.display = 'block';
                banner.style.background = 'rgba(200,216,228,0.08)';
                banner.style.border = '1px solid rgba(200,216,228,0.25)';
                banner.style.color = 'var(--c)';
                banner.innerHTML = `
                    <div style="margin-bottom:8px;font-weight:700;color:var(--c);">
                        🚗 Select vehicle to pre-fill:
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${vehicles.map((v, i) => {
                            const label = [v.make, v.bodyType, v.year]
                                .filter(x => x && x !== '—').join(' ') || 'Vehicle ' + (i + 1);
                            return `<button onclick="prefillVehicle(${i})"
                                id="vPickerBtn_${i}"
                                style="padding:6px 14px;border-radius:8px;font-size:0.78rem;
                                font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;
                                border:1px solid var(--border);background:rgba(255,255,255,0.05);
                                color:var(--t);">${label}</button>`;
                        }).join('')}
                    </div>`;
            }
            // Pre-fill with active vehicle or first
            const active = window._activeVehicle || vehicles[0];
            _prefillFromVehicle(active);
        } else {
            // Single vehicle — auto-fill silently
            const data = vehicles[0];
            _prefillFromVehicle(data);
            if (banner) {
                banner.style.display = 'block';
                banner.style.background = 'rgba(74,222,128,0.08)';
                banner.style.border = '1px solid rgba(74,222,128,0.25)';
                banner.style.color = '#4ade80';
                banner.innerHTML = `✓ Vehicle details pre-filled from your saved Mulkiya — 
                    <span id="step1OwnerName">${data.ownerName && data.ownerName !== '—' ? data.ownerName : ''}</span>`;
            }
        }

    } catch(e) {
        console.warn('[Mulkiya] loadMulkiyaData failed:', e);
    }
}
function prefillVehicle(index) {
    const vehicles = window._step1Vehicles || [];
    const v = vehicles[index];
    if (!v) return;
    window._activeVehicle = v;
    _prefillFromVehicle(v);

    // Highlight selected button
    vehicles.forEach((_, i) => {
        const btn = document.getElementById(`vPickerBtn_${i}`);
        if (btn) {
            btn.style.background = i === index ? 'rgba(200,216,228,0.15)' : 'rgba(255,255,255,0.05)';
            btn.style.borderColor = i === index ? 'var(--c)' : 'var(--border)';
            btn.style.color = i === index ? 'var(--c)' : 'var(--t)';
        }
    });
    toast(`Pre-filled: ${[v.make, v.bodyType, v.year].filter(Boolean).join(' ')}`, 'success');
}

function _prefillFromVehicle(data) {
    if (!data) return;
    const fieldMap = {
        'vin':     data.vin,
        'make':    data.make,
        'model':   data.bodyType || data.model,
        'year':    data.year,
        'mileage': data.mileage || ''
    };
    Object.entries(fieldMap).forEach(([fieldId, val]) => {
        const el = document.getElementById(fieldId);
        if (el && val && val !== '—') el.value = val;
    });
}
// Helper to render each field pill
function _extractedField(icon, label, value) {
    return `
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(200,216,228,.1);border-radius:10px;padding:10px 12px">
        <div style="font-size:.68rem;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-bottom:4px">${icon} ${label}</div>
        <div style="font-size:.88rem;font-weight:700;color:var(--t)">${value || '—'}</div>
    </div>`;
}
// Optional: Add basic CSS for upload zone (add inside <style> or in styles.css)
const mulkiyaStyle = document.createElement('style');
mulkiyaStyle.innerHTML = `
    .upload-zone {
        border: 2px dashed var(--border);
        border-radius: 12px;
        background: rgba(255,255,255,0.03);
        padding: 24px 16px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
    }
    .upload-zone:hover {
        border-color: var(--c);
        background: rgba(255,255,255,0.06);
    }
    .uz-ico { font-size: 2.8rem; margin-bottom: 8px; opacity: 0.7; }

    /* Prevent portal section overlap */
    .portal-section { display: none; }
    .portal-section.active { display: block; }

    /* Prevent page overlap */
    .page { display: none; }
    .page.active { display: block; }

    /* Sidebar overlay fix for mobile */
    .sidebar-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 89;
    }
    .sidebar-overlay.active { display: block; }

    /* Fix toast z-index */
    #toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        pointer-events: none;
    }

    /* Fix scan overlay z-index */
    #scanOverlay {
        position: fixed;
        inset: 0;
        z-index: 9998;
        display: none;
    }
    #scanOverlay.active { display: flex; }

    /* Fix modal overlay */
    .modal-overlay {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 9990;
    }
    .modal-overlay.active { display: flex; }

    /* Prevent rolePortal overlap with pages */
    #rolePortal {
        display: none;
    }
    #rolePortal.active {
        display: flex;
    }

    /* Fix live camera page */
    #live-camera {
        display: none;
    }
    #live-camera.active {
        display: block;
    }

    /* Smooth section transitions */
    .portal-section.active {
        animation: sectionFadeIn 0.25s ease;
    }
    @keyframes sectionFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* ── NEW: Gallery image states ───────────────────────── */
    .res-gallery-item.img-load-error {
        background: rgba(255,68,68,0.06);
        border: 1px dashed rgba(255,68,68,0.3);
        position: relative;
    }
    .res-gallery-item.img-load-error::after {
        content: 'Failed to load';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--red);
        font-size: 0.72rem;
        font-family: 'JetBrains Mono', monospace;
    }
    .res-gallery-item.no-defects-img {
        opacity: 0.7;
    }
`;
document.head.appendChild(mulkiyaStyle);



