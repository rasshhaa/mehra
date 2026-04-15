// ═══════════════════════════════════════════════════════════
// FIX 1: Render insurance-authorized jobs in garage appointments view
// ═══════════════════════════════════════════════════════════
async function renderInsuranceAuthorizedJobs(garageName) {
    const banner = document.getElementById('insuranceAuthorizedBanner');
    const list   = document.getElementById('insuranceAuthorizedList');
    if (!banner || !list || !garageName) return;
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'insuranceClaims'));
        const approved = snap.docs.map(d => d.data()).filter(c =>
            c.status === 'approved' && fuzzyMatch(c.garageName || '', garageName)
        );
        if (!approved.length) { banner.style.display = 'none'; return; }
        banner.style.display = 'block';
        list.innerHTML = approved.map(c => {
            const amt = c.approvedAmount ? '<strong style="color:#4ade80;">AED ' + c.approvedAmount + ' authorized</strong> · ' : '';
            return '<div style="background:rgba(74,222,128,0.06);border:1px solid rgba(74,222,128,0.2);border-radius:10px;padding:12px 16px;font-size:0.82rem;">' +
                '<div style="font-weight:700;color:var(--t);">' + (c.ownerName || 'Vehicle Owner') + ' — ' + (c.vehicle || '—') + '</div>' +
                '<div style="color:var(--tm);margin-top:4px;font-family:var(--mono,monospace);">' + amt + 'Policy: ' + (c.policyNo || '—') + ' · Approved: ' + (c.processedAt || '—') + '</div>' +
            '</div>';
        }).join('');
    } catch(e) {
        banner.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════
// FIX 5: Tasjeel self-report mechanism
// ═══════════════════════════════════════════════════════════
async function markRenewalResult(result) {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Please log in first', 'error');

    try {
        const snap = await window._fsGetDocs(window._fsQuery(
            window._fsCollection(window._fbDb, 'users', uid, 'renewals'),
            window._fsOrderBy('timestamp', 'desc')
        ));

        if (snap.empty) return toast('No booking found to update', 'error');

        const latestDoc = snap.docs[0];
        const latestRenewal = latestDoc.data();

        // 1. Update the renewal record
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'renewals', latestDoc.id),
            { 
                status: result, 
                reportedAt: new Date().toLocaleDateString() 
            }
        );

        // 2. ← ADD THIS BLOCK: Save to Car Life Timeline (inspections subcollection)
        const tasjeelEvent = {
            id: 'tasjeel_' + Date.now(),
            date: new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }),
            timestamp: Date.now(),
            vehicle: 'Tasjeel Inspection',
            vin: latestRenewal.vin || '—',           // optional: pull from mulkiya if available
            status: result === 'passed' ? 'pass' : 'fail',
            defects: 0,
            engineKnock: null,
            role: 'owner',
            serviceType: 'tasjeel',
            source: 'renewal',
        };

        await window._fsAddDoc(
            window._fsCollection(window._fbDb, 'users', uid, 'inspections'),
            tasjeelEvent
        );

        // 3. Feedback + Refresh UI
        toast(
            result === 'passed' 
                ? '✅ Tasjeel marked as PASSED and added to Car Life Timeline' 
                : '❌ Tasjeel marked as FAILED and added to Car Life Timeline', 
            result === 'passed' ? 'success' : 'error'
        );

        document.getElementById('renewalSelfReport').style.display = 'none';
        
        // Refresh both history views
        renderRenewalHistory(uid);
        renderPortalHistory();        // ← This rebuilds the Car Life Timeline

    } catch(e) {
        console.error(e);
        toast('Failed to update renewal status', 'error');
    }
}
// ═══════════════════════════════════════════════════════════
// FIX 7: Render Policy Holders for insurance role
// ═══════════════════════════════════════════════════════════
async function renderInsPolicyHolders() {
    const list = document.getElementById('insPolicyHoldersList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm);font-size:.82rem">Loading...</div>';
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'users'));
        const holders = [];
        for (const doc of snap.docs) {
            try {
                const mulkiya = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', doc.id, 'profile', 'mulkiya'));
                if (mulkiya.exists()) {
                    const m = mulkiya.data();
                    if (m.insurancePolicy && m.insurancePolicy !== '—') {
                        holders.push({ uid: doc.id, ...m });
                    }
                }
            } catch(e) {}
        }
        if (!holders.length) {
            list.innerHTML = '<div style="text-align:center;padding:60px;color:var(--tm)"><div style="font-size:2.5rem;margin-bottom:12px">🛡️</div>No policy holders found in MEHRA yet.</div>';
            return;
        }
        list.innerHTML = holders.map(h => {
            const vehicle = [h.make, h.bodyType, h.year].filter(v => v && v !== '—').join(' ') || '—';
            return '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:0.82rem;">' +
                '<div><span style="color:var(--tm);font-size:0.68rem;display:block;text-transform:uppercase;margin-bottom:4px;">Vehicle</span><strong>' + vehicle + '</strong></div>' +
                '<div><span style="color:var(--tm);font-size:0.68rem;display:block;text-transform:uppercase;margin-bottom:4px;">Plate</span><strong>' + (h.plateNumber || '—') + '</strong></div>' +
                '<div><span style="color:var(--tm);font-size:0.68rem;display:block;text-transform:uppercase;margin-bottom:4px;">Policy No.</span><strong style="font-family:monospace;">' + (h.insurancePolicy || '—') + '</strong></div>' +
                '<div><span style="color:var(--tm);font-size:0.68rem;display:block;text-transform:uppercase;margin-bottom:4px;">Owner</span><strong>' + (h.ownerName || '—') + '</strong></div>' +
                '<div><span style="color:var(--tm);font-size:0.68rem;display:block;text-transform:uppercase;margin-bottom:4px;">VIN</span><strong style="font-family:monospace;font-size:0.75rem;">' + (h.vin || '—') + '</strong></div>' +
                '<div><span style="color:var(--tm);font-size:0.68rem;display:block;text-transform:uppercase;margin-bottom:4px;">Ins. Expiry</span><strong>' + (h.insuranceExpiry || '—') + '</strong></div>' +
            '</div>';
        }).join('');
    } catch(e) {
        list.innerHTML = '<div style="padding:20px;color:var(--tm)">Failed to load policy holders.</div>';
    }
}

