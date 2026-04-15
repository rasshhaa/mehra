// ═══════════════════════════════════════════════════════════
// REGISTRATION RENEWAL
// ═══════════════════════════════════════════════════════════
async function renderRenewalStatus() {
    const uid = window._currentUser?.uid;
    if (!uid) return;

    try {
        const snap = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya'));
        const data = snap.exists() ? snap.data() : {};
let data = window._activeVehicle || {};
if (!Object.keys(data).length) {
    try {
        const vSnap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
        );
        if (!vSnap.empty) {
            data = vSnap.docs[0].data();
        } else {
            const snap = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya')
            );
            data = snap.exists() ? snap.data() : {};
        }
    } catch(e) {}
}

        const regExpiry = data.registrationExpiry || '—';
        const insExpiry = data.insuranceExpiry || '—';

        document.getElementById('renewalRegExpiry').textContent = regExpiry;
        document.getElementById('renewalInsExpiry').textContent = insExpiry;

        // Check dates
        const now = new Date();
        const parseDate = (str) => {
            if (!str || str === '—') return null;
            const d = new Date(str);
            return isNaN(d.getTime()) ? null : d;
        };

        const regDate = parseDate(regExpiry);
        const insDate = parseDate(insExpiry);

        const regOk = regDate ? regDate > now : null;
        const insOk = insDate ? insDate > now : null;

        // Registration check
        const regIcon = document.getElementById('rcheck-reg-icon');
        const regSub  = document.getElementById('rcheck-reg-sub');
        if (regDate === null) {
            regIcon.textContent = '?'; regIcon.style.background = 'rgba(245,158,11,.1)'; regIcon.style.color = '#f59e0b';
            regSub.textContent = 'No registration date found — upload Mulkiya in My Profile';
        } else if (regOk) {
            regIcon.textContent = '✓'; regIcon.style.background = 'rgba(74,222,128,.1)'; regIcon.style.color = '#4ade80';
            regSub.textContent = 'Valid until ' + regExpiry;
        } else {
            regIcon.textContent = '✗'; regIcon.style.background = 'rgba(255,68,68,.1)'; regIcon.style.color = '#ff4444';
            regSub.textContent = 'EXPIRED on ' + regExpiry + ' — renewal required';
        }

        // Insurance check
        const insIcon = document.getElementById('rcheck-ins-icon');
        const insSub  = document.getElementById('rcheck-ins-sub');
        if (insDate === null) {
            insIcon.textContent = '?'; insIcon.style.background = 'rgba(245,158,11,.1)'; insIcon.style.color = '#f59e0b';
            insSub.textContent = 'No insurance date found — upload Mulkiya in My Profile';
        } else if (insOk) {
            insIcon.textContent = '✓'; insIcon.style.background = 'rgba(74,222,128,.1)'; insIcon.style.color = '#4ade80';
            insSub.textContent = 'Valid until ' + insExpiry + (data.insuranceCompany && data.insuranceCompany !== '—' ? ' · ' + data.insuranceCompany : '');
        } else {
            insIcon.textContent = '✗'; insIcon.style.background = 'rgba(255,68,68,.1)'; insIcon.style.color = '#ff4444';
            insSub.textContent = 'EXPIRED on ' + insExpiry + ' — renew insurance before booking';
        }

        // Fines check (mocked — placeholder for RTA API)
        const finesIcon = document.getElementById('rcheck-fines-icon');
        const finesSub  = document.getElementById('rcheck-fines-sub');
        const mockFines = 0; // Placeholder — real fines would come from RTA API
        document.getElementById('renewalFinesCount').textContent = mockFines === 0 ? 'None' : 'AED ' + mockFines;
        if (mockFines === 0) {
            finesIcon.textContent = '✓'; finesIcon.style.background = 'rgba(74,222,128,.1)'; finesIcon.style.color = '#4ade80';
            finesSub.textContent = 'No outstanding traffic fines';
        } else {
            finesIcon.textContent = '✗'; finesIcon.style.background = 'rgba(255,68,68,.1)'; finesIcon.style.color = '#ff4444';
            finesSub.textContent = 'AED ' + mockFines + ' in fines — clear before renewal';
            if (mockFines > 0) {
    finesSub.innerHTML = `AED ${mockFines} in fines — 
        <a href="https://www.rta.ae/wps/portal/rta/ae/home/rta-services/individual/fine-payment" 
           target="_blank" 
           style="color:var(--c);text-decoration:underline;font-weight:700;">Pay via RTA Portal →</a>`;
}
        }

        // Eligibility
        const eligible = (regOk !== false) && (insOk !== false) && mockFines === 0;
        document.getElementById('renewalReadyStatus').textContent = eligible ? 'Eligible' : 'Not Ready';
        document.getElementById('renewalReadyStatus').style.color = eligible ? '#4ade80' : '#ff4444';

        const blockedBanner = document.getElementById('renewalBlockedBanner');
        if (blockedBanner) blockedBanner.style.display = eligible ? 'none' : 'block';

        // Set min date for booking
        const today = new Date().toISOString().split('T')[0];
        const renewalDateEl = document.getElementById('renewalDate');
        if (renewalDateEl) renewalDateEl.min = today;

        // Load renewal history
        renderRenewalHistory(uid);

    } catch(e) {
        console.warn('[Renewal] load error:', e);
    }
}

async function bookRenewalSlot() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Please log in first', 'error');

    const centre = document.getElementById('renewalCentre').value;
    const date   = document.getElementById('renewalDate').value;
    const time   = document.getElementById('renewalTime').value;

    if (!centre) return toast('Please select an inspection centre', 'error');
    if (!date)   return toast('Please select a date', 'error');

    const booking = {
        id: 'renewal_' + Date.now(),
        uid,
        centre,
        date,
        time,
        status: 'booked',
        createdAt: new Date().toLocaleDateString(),
        timestamp: Date.now(),
    };

    try {
        const btn = document.getElementById('btnBookRenewal');
        btn.disabled = true; btn.textContent = 'Booking...';

        await window._fsAddDoc(window._fsCollection(window._fbDb, 'users', uid, 'renewals'), booking);

        const confirmed = document.getElementById('renewalConfirmed');
        const details   = document.getElementById('renewalConfirmedDetails');
        confirmed.style.display = 'block';
        details.textContent = centre + ' · ' + date + ' at ' + time;

        notifyUser(uid, '📋 Renewal inspection booked at <strong>' + centre + '</strong> on ' + date + ' at ' + time, 'confirmed');
        toast('✓ Renewal slot booked!', 'success');
        renderRenewalHistory(uid);

        btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Confirm Booking';
    } catch(e) {
        toast('Failed to book slot', 'error');
        document.getElementById('btnBookRenewal').disabled = false;
    if (!date)   return toast('Please select a preferred date', 'error');

    // Validate date is not in the past
    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0,0,0,0);
    if (selectedDate < today) {
        return toast('Please select a future date', 'error');
    }

    const btn = document.getElementById('btnBookRenewal');
    btn.disabled = true;
    btn.textContent = '⏳ Booking...';

    try {
        // Check for existing active booking at same centre
        const q = window._fsQuery(
            window._fsCollection(window._fbDb, 'users', uid, 'renewals'),
            window._fsOrderBy('timestamp', 'desc')
        );
        const existing = await window._fsGetDocs(q);
        const activeBooking = existing.docs.map(d => d.data())
            .find(r => r.status === 'booked' && r.centre === centre);

        if (activeBooking) {
            toast(`You already have a booking at ${centre} on ${activeBooking.date}`, 'error');
            btn.disabled = false;
            btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Confirm Booking`;
            return;
        }

        // Get vehicle info for booking
        let vehicleInfo = 'Vehicle not specified';
        let plateNumber = '—';
        try {
            const activeV = window._activeVehicle;
            if (activeV) {
                vehicleInfo = [activeV.make, activeV.bodyType, activeV.year]
                    .filter(v => v && v !== '—').join(' ') || vehicleInfo;
                plateNumber = activeV.plateNumber || '—';
            }
        } catch(e) {}

        const bookingId = 'renewal_' + Date.now();
        const booking = {
            id:          bookingId,
            uid,
            centre,
            date,
            time,
            status:      'booked',
            vehicle:     vehicleInfo,
            plate:       plateNumber,
            createdAt:   new Date().toLocaleDateString(),
            timestamp:   Date.now(),
        };

        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'renewals', bookingId),
            booking
        );

        // Also write to global tasjeelQueue so Tasjeel centre can see it
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'tasjeelBookings', bookingId),
            {
                ...booking,
                ownerEmail: window._currentUser.email,
            }
        );

        // Notify owner
        await notifyUser(
            uid,
            `📋 Renewal inspection booked at <strong>${centre}</strong> on ` +
            `<strong>${date}</strong> at <strong>${time}</strong>. ` +
            `Vehicle: ${vehicleInfo} · Plate: ${plateNumber}.`,
            'confirmed'
        );

        // Show confirmation
        const confirmed = document.getElementById('renewalConfirmed');
        const details   = document.getElementById('renewalConfirmedDetails');
        if (confirmed) confirmed.style.display = 'block';
        if (details) details.textContent =
            `${centre} · ${date} at ${time} · ${vehicleInfo}`;

        // Hide blocked banner
        const blocked = document.getElementById('renewalBlockedBanner');
        if (blocked) blocked.style.display = 'none';

        toast('✓ Renewal slot booked successfully!', 'success');
        renderRenewalHistory(uid);
        updateBellBadge();

    } catch(e) {
        console.error('[Renewal Book]', e);
        toast('Failed to book slot: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 11 12 14 22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg> Confirm Booking`;
    }
}

async function renderRenewalHistory(uid) {
    const list = document.getElementById('renewalHistoryList');
    if (!list || !uid) return;
    try {
        const q = window._fsQuery(
            window._fsCollection(window._fbDb, 'users', uid, 'renewals'),
            window._fsOrderBy('timestamp', 'desc')
        );
        const snap = await window._fsGetDocs(q);
        const records = snap.docs.map(d => d.data());
        if (!records.length) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tm);font-family:\'JetBrains Mono\',monospace;font-size:.82rem">No renewal records yet.</div>';
            return;
        }
        list.innerHTML = records.map(r => {
            const sc = r.status === 'passed' ? '#4ade80' : r.status === 'booked' ? 'var(--c)' : '#f59e0b';
            return '<div style="background:var(--bg3);border:1px solid var(--border);border-left:4px solid '+sc+';border-radius:12px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
                '<div><div style="font-weight:700;color:var(--t);font-size:.9rem">'+r.centre+'</div>' +
                '<div style="font-size:.78rem;color:var(--tm);font-family:\'JetBrains Mono\',monospace;margin-top:2px">'+r.date+' at '+r.time+'</div></div>' +
                '<span style="background:'+sc+'20;color:'+sc+';padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:800;border:1px solid '+sc+'40">'+(r.status||'booked').toUpperCase()+'</span></div>';
        }).join('');
    } catch(e) {
        console.warn('[Renewal History]', e);
    }
}

async function checkRenewalSelfReportEligibility(uid) {
    try {
        const q = window._fsQuery(
            window._fsCollection(window._fbDb, 'users', uid, 'renewals'),
            window._fsOrderBy('timestamp', 'desc')
        );
        const snap = await window._fsGetDocs(q);
        if (snap.empty) return;
        const latest = snap.docs[0].data();
        if (latest.status !== 'booked') return;
        const apptDate = new Date(latest.date);
        if (!isNaN(apptDate) && apptDate < new Date()) {
            const el = document.getElementById('renewalSelfReport');
            if (el) el.style.display = 'block';
        }
    } catch(e) {}
}

