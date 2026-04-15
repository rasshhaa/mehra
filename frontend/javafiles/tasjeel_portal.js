// TASJEEL PORTAL FUNCTIONS
// ═══════════════════════════════════════════════════════════
async function saveTasjeelProfile() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');
    const data = {
        name:     document.getElementById('tasjeelCentreName').value.trim(),
        location: document.getElementById('tasjeelLocation').value.trim(),
        license:  document.getElementById('tasjeelLicense').value.trim(),
    };
    try {
        await window._fsSetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'tasjeel'), data);
        await window._fsUpdateDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta'), { tasjeel: data });
        toast('Tasjeel profile saved ✓', 'success');
    } catch(e) { toast('Failed to save profile', 'error'); }
}

async function renderTasjeelDashboard() {
    try {
        const uid = window._currentUser?.uid;
        const apptSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'appointments'));
        const allAppts = apptSnap.docs.map(d => ({id: d.id, ...d.data()}));
        const today = new Date().toISOString().split('T')[0];
        const todayBookings = allAppts.filter(r => r.date === today);
        const passed = allAppts.filter(r => r.status === 'completed');
        const failed = allAppts.filter(r => r.status === 'rejected');
        const pending = allAppts.filter(r => r.status === 'pending');

        const el = id => document.getElementById(id);
        if (el('tasjeelStatToday')) el('tasjeelStatToday').textContent = todayBookings.length;
        if (el('tasjeelStatPassed')) el('tasjeelStatPassed').textContent = passed.length;
        if (el('tasjeelStatFailed')) el('tasjeelStatFailed').textContent = failed.length;
        if (el('tasjeelStatPending')) el('tasjeelStatPending').textContent = pending.length;

        const queue = el('tasjeelTodayQueue');
        if (!queue) return;
        if (!todayBookings.length) {
            queue.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">📅</div>No bookings for today.</div>';
            return;
        }
        queue.innerHTML = todayBookings.map(b => {
            const sc = { pending:'#f59e0b', confirmed:'#4ade80', completed:'#4ade80', rejected:'#ff4444' }[b.status] || '#f59e0b';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:12px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div>
                    <div style="font-weight:700;color:var(--t)">${b.ownerName||'Owner'}</div>
                    <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace">${b.vehicle||'Vehicle'} · ${b.service||'—'} · ${b.time||'—'}</div>
                </div>
                <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid ${sc}40">${(b.status||'pending').toUpperCase()}</span>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[Tasjeel Dashboard]', e); }
}

async function addTasjeelSlot() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');
    const date = document.getElementById('slotDate').value;
    const capacity = document.getElementById('slotCapacity').value;
    if (!date || !capacity) return toast('Please fill date and capacity', 'error');
    try {
        const slotId = 'slot_' + Date.now();
        await window._fsSetDoc(window._fsDoc(window._fbDb, 'tasjeelSlots', slotId), {
            id: slotId, date, capacity: Number(capacity), booked: 0,
            centreUid: uid, createdAt: new Date().toLocaleDateString(), timestamp: Date.now()
        });
        toast('✓ Slot added', 'success');
        document.getElementById('slotDate').value = '';
        document.getElementById('slotCapacity').value = '';
        renderTasjeelSlots();
    } catch(e) { toast('Failed to add slot', 'error'); }
}

async function renderTasjeelSlots() {
    const el = document.getElementById('tasjeelSlotList');
    if (!el) return;
    const uid = window._currentUser?.uid;
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'tasjeelSlots'));
        const slots = snap.docs.map(d => d.data()).filter(s => s.centreUid === uid).sort((a,b) => new Date(a.date) - new Date(b.date));
        if (!slots.length) {
            el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm)"><div style="font-size:1.5rem;margin-bottom:12px">📅</div>No slots configured yet.</div>';
            return;
        }
        el.innerHTML = slots.map(s => {
            const pct = Math.round(((s.booked||0) / s.capacity) * 100);
            const sc = pct >= 90 ? '#ff4444' : pct >= 70 ? '#f59e0b' : '#4ade80';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
                <div>
                    <div style="font-weight:700;color:var(--t)">${s.date}</div>
                    <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace">${s.booked||0} / ${s.capacity} booked</div>
                </div>
                <div style="flex:1;min-width:120px;background:rgba(255,255,255,.05);border-radius:8px;height:8px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${sc};border-radius:8px;transition:width 0.4s"></div>
                </div>
                <span style="color:${sc};font-weight:800;font-family:'JetBrains Mono',monospace;font-size:.85rem">${pct}%</span>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[Tasjeel Slots]', e); }
}

async function recordTasjeelResult() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');
    const plate = document.getElementById('resultPlate').value.trim();
    const vin = document.getElementById('resultVin').value.trim();
    const status = document.getElementById('resultStatus').value;
    const notes = document.getElementById('resultNotes').value.trim();
    if (!plate) return toast('Enter plate number', 'error');
    try {
        const resultId = 'result_' + Date.now();
        await window._fsSetDoc(window._fsDoc(window._fbDb, 'tasjeelResults', resultId), {
            id: resultId, plate, vin, status, notes,
            inspectedBy: uid, inspectedAt: new Date().toLocaleDateString(), timestamp: Date.now()
        });
        toast(`✓ Result saved — ${status}`, status === 'passed' ? 'success' : 'error');
        ['resultPlate','resultVin','resultNotes'].forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
        renderTasjeelResults();
    } catch(e) { toast('Failed to save result', 'error'); }
}

async function renderTasjeelResults() {
    const el = document.getElementById('tasjeelResultsList');
    if (!el) return;
    const uid = window._currentUser?.uid;
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'tasjeelResults'));
        const results = snap.docs.map(d => d.data()).filter(r => r.inspectedBy === uid).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
        if (!results.length) {
            el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">📋</div>No results recorded yet.</div>';
            return;
        }
        el.innerHTML = results.map(r => {
            const sc = r.status === 'passed' ? '#4ade80' : r.status === 'conditional' ? '#f59e0b' : '#ff4444';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:12px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div>
                    <div style="font-weight:700;color:var(--t)">Plate: ${r.plate}${r.vin ? ' · VIN: ' + r.vin : ''}</div>
                    <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace">${r.notes||'—'} · ${r.inspectedAt||'—'}</div>
                </div>
                <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid ${sc}40">${r.status.toUpperCase()}</span>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[Tasjeel Results]', e); }
}

async function renderTasjeelQueue() {
    const el = document.getElementById('tasjeelBookingQueue');
    if (!el) return;
    try {
        const snap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'tasjeelBookings')
        );
        const bookings = snap.docs.map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => new Date(a.date) - new Date(b.date));
        if (!bookings.length) {
            el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--tm)"><div style="font-size:2rem;margin-bottom:12px">📅</div>No bookings yet.</div>';
            return;
        }
        el.innerHTML = bookings.map(b => {
            const sc = { pending:'#f59e0b', confirmed:'#4ade80', completed:'#4ade80', rejected:'#ff4444' }[b.status] || '#f59e0b';
            return `<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:12px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div>
                    <div style="font-weight:700;color:var(--t)">${b.ownerName||'Owner'} — ${b.vehicle||'Vehicle'}</div>
                    <div style="font-size:.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace">${b.service||'—'} · ${b.garage||'—'} · ${b.date||'—'} at ${b.time||'—'}</div>
                </div>
                <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid ${sc}40">${(b.status||'pending').toUpperCase()}</span>
            </div>`;
        }).join('');
    } catch(e) { console.warn('[Tasjeel Queue]', e); }
}

