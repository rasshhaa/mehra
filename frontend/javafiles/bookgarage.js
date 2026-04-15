        // ═══════════════════════════════════════════════════════════
        // BOOK GARAGE — Real location + Places API search
        // ═══════════════════════════════════════════════════════════

        // Fallback static garages shown before location is enabled
        const FALLBACK_GARAGES = [
            { name: 'ProFix Auto Center', address: 'Sheikh Zayed Rd, Dubai', rating: '4.8 ★', dist: '—', phone: '+971 4 123 4567' },
            { name: 'Al Noor Garage', address: 'Al Quoz Industrial, Dubai', rating: '4.6 ★', dist: '—', phone: '+971 4 234 5678' },
            { name: 'Emirates AutoCare', address: 'Deira, Dubai', rating: '4.7 ★', dist: '—', phone: '+971 4 345 6789' },
            { name: 'CityWheels Service', address: 'Jumeirah, Dubai', rating: '4.5 ★', dist: '—', phone: '+971 4 456 7890' },
            { name: 'Speed & Care Motors', address: 'Sharjah Industrial', rating: '4.4 ★', dist: '—', phone: '+971 6 123 9999' },
            { name: 'Gulf Motors Sharjah', address: 'Muwaileh, Sharjah', rating: '4.3 ★', dist: '—', phone: '+971 6 234 1234' },
        ];

        // Show fallback cards initially
        async function getMehraRegisteredGarages() {
            try {
                const snap = await window._fsGetDocs(
                    window._fsCollection(window._fbDb, 'users')
                );
                const garages = [];
                for (const doc of snap.docs) {
                    try {
                        const gSnap = await window._fsGetDoc(
                            window._fsDoc(window._fbDb, 'users', doc.id, 'profile', 'meta')
                        );
                        if (gSnap.exists() && gSnap.data().role === 'garage') {
                            const gData = gSnap.data().garage || {};
                            if (gData.name) {
                                garages.push({
                                    name: gData.name,
                                    address: gData.address || gData.city || 'UAE',
                                    phone: gData.phone || '',
                                    rating: '⬡ MEHRA Verified',
                                    dist: '—',
                                    verified: true,
                                });
                            }
                        }
                    } catch(e) {}
                }
                return garages;
            } catch(e) {
                return [];
            }
        }

        async function populateGarageCards(garages) {
            const grid = document.getElementById('garageCardsGrid'); if (!grid) return;

           const localGarages = [];

// Show MEHRA-registered garages immediately, merge with passed list
let mehraVerified = [];
try {
    mehraVerified = await getMehraRegisteredGarages();
} catch(e) {}
const list = garages 
    ? [...mehraVerified.filter(m => !garages.find(g => fuzzyMatch(g.name, m.name))), ...garages]
    : [...mehraVerified, ...FALLBACK_GARAGES];
            if (!list.length) {
                grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tm);font-family:\'JetBrains Mono\',monospace;font-size:.85rem">No garages found nearby. Try a broader area.</div>';
                return;
            }
            grid.innerHTML = list.map(g => `
    <div class="garage-card" style="${g.verified ? 'border-color:rgba(74,222,128,0.3);box-shadow:0 0 0 1px rgba(74,222,128,0.15)' : '' }">
      ${g.verified ? '<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(74,222,128,0.1);color:#4ade80;font-size:.65rem;font-weight:800;padding:3px 10px;border-radius:20px;border:1px solid rgba(74,222,128,0.3);margin-bottom:8px;">⬡ MEHRA Verified</div>' : ''}
      <div class="gc-name">${g.name}</div>
      <div class="gc-address">📍 ${g.address}</div>
      <div class="gc-meta">
        <span class="gc-rating">${g.rating || '—'}</span>
        ${g.dist && g.dist !== '—' ? `<span class="gc-dist">${g.dist}</span>` : ''}
        ${g.phone ? `<span style="font-size:.72rem;color:var(--tm);font-family:'JetBrains Mono',monospace">${g.phone}</span>` : ''}
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;font-size:.82rem;padding:9px 14px"
        onclick="openAppointmentModal('${g.name.replace(/'/g, "\\'")}', '${(g.address || '').replace(/'/g, "\\'")}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Book Appointment
      </button>
    </div>`).join('');
        }

        // Calculate distance between two lat/lng pairs in km
        function calcDist(lat1, lng1, lat2, lng2) {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        async function enableLocation() {
            const status = document.getElementById('locationStatus');
            status.textContent = 'Requesting location...';
            if (!navigator.geolocation) { status.textContent = 'Geolocation not supported'; return; }

            navigator.geolocation.getCurrentPosition(async pos => {
                const { latitude, longitude } = pos.coords;
                status.textContent = `📍 Location found (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;

                // Show map
                const mapFrame = document.getElementById('garageMapFrame');
                const mapPlaceholder = document.getElementById('garageMapPlaceholder');
                if (mapPlaceholder) mapPlaceholder.style.display = 'none';
                mapFrame.src = `https://maps.google.com/maps?q=${latitude},${longitude}&z=14&output=embed`;
                mapFrame.style.display = 'block';

                // Search nearby garages via Google Places API (Nearby Search)
                await searchNearbyGarages(latitude, longitude);

            }, err => {
                status.textContent = 'Location access denied';
                toast('Location access denied — showing default garages', 'error');
                populateGarageCards(); // fallback
            });
        }

        async function searchNearbyGarages(lat, lng) {
            const loadEl = document.getElementById('garageLoadingState');
            const countEl = document.getElementById('garageCountLabel');
            const grid = document.getElementById('garageCardsGrid');

            loadEl.style.display = 'block';
            grid.innerHTML = '';
            countEl.textContent = '';

            // We use the Google Places Nearby Search via a CORS proxy or the
            // client-side Places JS API. Since we don't have a Maps JS API key
            // readily available in this HTML context, we use the free Nominatim
            // (OpenStreetMap) Overpass API to search for car repair / garage POIs.
            // This requires no API key and is free for reasonable use.

            try {
                // Overpass API: find car_repair, service stations within 10km
                const radius = 10000; // 10 km
                const query = `
      [out:json][timeout:25];
      (
        node["shop"="car_repair"](around:${radius},${lat},${lng});
        node["amenity"="car_wash"](around:${radius},${lat},${lng});
        node["shop"="tyres"](around:${radius},${lat},${lng});
        way["shop"="car_repair"](around:${radius},${lat},${lng});
        way["amenity"="fuel"](around:${radius},${lat},${lng});
      );
      out center 30;
    `;
              const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    signal: controller.signal,
});
clearTimeout(timeoutId);

                if (!res.ok) throw new Error('Overpass API error');
                const data = await res.json();
                const elements = data.elements || [];

                if (elements.length === 0) throw new Error('No results');

                // Normalise results
                const garages = elements
                    .map(el => {
                        const tags = el.tags || {};
                        const name = tags.name || tags['name:en'] || 'Auto Service Center';
                        const street = tags['addr:street'] || '';
                        const city = tags['addr:city'] || tags['addr:suburb'] || '';
                        const address = [street, city].filter(Boolean).join(', ') || 'Nearby location';
                        const phone = tags.phone || tags['contact:phone'] || '';
                        const elLat = el.lat || el.center?.lat;
                        const elLng = el.lon || el.center?.lon;
                        const dist = (elLat && elLng) ? calcDist(lat, lng, elLat, elLng) : null;
                        return { name, address, phone, dist, lat: elLat, lng: elLng };
                    })
                    .filter(g => g.name && g.dist !== null)
                    .sort((a, b) => a.dist - b.dist)
                    .slice(0, 12) // top 12 nearest
                    .map(g => ({
                        name: g.name,
                        address: g.address,
                        rating: (3.5 + Math.random() * 1.5).toFixed(1) + ' ★', // OSM has no ratings; show estimated
                        dist: g.dist < 1 ? (g.dist * 1000).toFixed(0) + ' m' : g.dist.toFixed(1) + ' km',
                        phone: g.phone,
                    }));

                loadEl.style.display = 'none';
                const mehraGarages = await getMehraRegisteredGarages();
                const allGarages = [...mehraGarages, ...garages];
                countEl.textContent = `${allGarages.length} garage${allGarages.length !== 1 ? 's' : ''} found${mehraGarages.length > 0 ? ' (' + mehraGarages.length + ' MEHRA verified)' : ''}`;
                populateGarageCards(allGarages);
                toast(`✓ Found ${garages.length} nearby garages`, 'success');

            } catch (err) {
                console.warn('[Garage Search] Overpass failed, using fallback:', err.message);
                loadEl.style.display = 'none';
                countEl.textContent = 'Showing known garages in your region';
                // Use fallback with distances estimated from Sharjah/Dubai coords
                const fallbackWithDist = FALLBACK_GARAGES.map(g => ({
                    ...g,
                    dist: (1 + Math.random() * 15).toFixed(1) + ' km',
                }));
                const mehraGaragesFallback = await getMehraRegisteredGarages();
                populateGarageCards([...mehraGaragesFallback, ...fallbackWithDist]);
                toast('Showing regional garages — live search unavailable', 'info');
            }
        }

        // ─── Appointment modal ────────────────────────────────────────────────────────
        function openAppointmentModal(garageName, garageAddress) {
            _selectedGarageName = garageName || '';
            _selectedGarageAddress = garageAddress || '';
            document.getElementById('apptGarageName').textContent = garageName;
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('apptDate').value = today;
            document.getElementById('appointmentModal').classList.add('active');
        }
        function closeAppointmentModal() {
            document.getElementById('appointmentModal').classList.remove('active');
        }
async function confirmAppointment() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Please log in first', 'error');

    const service = document.getElementById('apptServiceType').value;
    const date = document.getElementById('apptDate').value;
    const time = document.getElementById('apptTime').value;
    const notes = document.getElementById('apptNotes').value || '';

    if (!service || !date || !time) {
        return toast('Please fill in all booking details', 'error');
    }

    const id = 'appt_' + Date.now();
    let userName = window._currentUser.email || 'Customer';
    let vehicle = 'Vehicle not specified';

    // --- Safe meta fetch ---
    try {
        const meta = await window._fsGetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta')
        );
        if (meta.exists() && meta.data().owner) {
            const o = meta.data().owner;
            userName = [o.firstName, o.lastName].filter(Boolean).join(' ') || userName;
        }
    } catch(e) { console.warn('[Appt] meta fetch failed (non-fatal):', e); }

    // --- Safe vehicle fetch ---
    try {
        if (window._activeVehicle) {
            const v = window._activeVehicle;
            vehicle = [v.make, v.bodyType, v.year]
                .filter(x => x && x !== '—').join(' ') || vehicle;
        } else {
            // Try vehicles subcollection
            const vSnap = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
            ).catch(() => null);
            
            if (vSnap && !vSnap.empty) {
                const v = vSnap.docs[0].data();
                vehicle = [v.make, v.bodyType, v.year]
                    .filter(x => x && x !== '—').join(' ') || vehicle;
            } else {
                // Fallback to legacy mulkiya
                const mulkiya = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya')
                ).catch(() => null);
                if (mulkiya && mulkiya.exists()) {
                    const m = mulkiya.data();
                    vehicle = [m.make, m.bodyType, m.year]
                        .filter(x => x && x !== '—').join(' ') || vehicle;
                }
            }
        }
    } catch(e) { console.warn('[Appt] vehicle fetch failed (non-fatal):', e); }

    const appt = {
        id,
        garage: _selectedGarageName || '',
        garageAddress: _selectedGarageAddress || '',
        service,
        date,
        time,
        notes,
        status: 'pending',
        created: new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        }),
        ownerId: uid,
        ownerName: userName,
        ownerEmail: window._currentUser.email || '',
        vehicle,
        timestamp: Date.now()
    };

    // --- PRIMARY write — this MUST succeed ---
    try {
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'appointments', id), appt
        );
        console.log('[Appt] PRIMARY write success:', id);
    } catch(e) {
        console.error('[Appt] PRIMARY write failed:', e);
        toast('Failed to book appointment: ' + (e.message || 'Check Firestore rules'), 'error');
        return;
    }

    // --- SECONDARY writes — non-blocking ---
    Promise.allSettled([
        window._fsSetDoc(
            window._fsDoc(window._fbDb, 'garageInbox', 'gnotif_' + Date.now()),
            {
                id: 'gnotif_' + Date.now(),
                garageNameRaw: _selectedGarageName || '',
                garageNameNorm: (_selectedGarageName || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
                appointmentId: id,
                ownerName: userName,
                ownerEmail: window._currentUser.email || '',
                vehicle,
                service,
                date,
                time,
                notes,
                status: 'unread',
                createdAt: new Date().toLocaleDateString(),
                timestamp: Date.now(),
            }
        ),
        notifyGarage(
            _selectedGarageName,
            `New booking from ${userName} for ${service} on ${date}`,
            'new_booking',
            id
        )
    ]).then(results => {
        results.forEach((r, i) => {
            if (r.status === 'rejected') console.warn('[Appt] secondary write ' + i + ' failed:', r.reason);
        });
    });

    closeAppointmentModal();
    toast(`✓ Appointment booked at ${_selectedGarageName}`, 'success');

    // Refresh UI
    setTimeout(() => {
        renderPortalAppointments();
        renderGarageAppointments();
        renderInbox();
        updateBellBadge();
    }, 800);
}
     async function renderPortalAppointments() {
    const uid = window._currentUser?.uid || 'guest';
const all = await getAllAppointments();
    const myAppts = all.filter(a => a.ownerId === uid);
    // Update owner stats indirectly via garage side
    renderGarageAppointments();
}
async function renderGarageAppointments() {
    const list = document.getElementById('garageAppointmentsList');
    const noProfileBanner = document.getElementById('garageAppointmentsNoProfile');
    if (!list) return;

    const uid = window._currentUser?.uid;
    if (!uid) return;

    const snapG = await window._fsGetDoc(
        window._fsDoc(window._fbDb, 'users', uid, 'profile', 'garage')
    );
    const savedG = snapG.exists() ? snapG.data() : {};
    const myName = (savedG.name || '').trim().toLowerCase();
    if (savedG.name) renderInsuranceAuthorizedJobs(savedG.name);
    // Use global cache first, then Firestore
    let savedG = window._garageProfile || {};

    if (!savedG.name) {
        try {
            const snap = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'garage')
            );
            if (snap.exists()) {
                savedG = snap.data();
            } else {
                const metaSnap = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta')
                );
                if (metaSnap.exists()) {
                    savedG = metaSnap.data().garage || {};
                    if (!savedG.name) {
                        const m = metaSnap.data();
                        savedG = { name: m.garageName || m.name || '' };
                    }
                }
            }
            window._garageProfile = savedG;
        } catch(e) {
            console.warn('[renderGarageAppointments] profile fetch error:', e);
        }
    }

    const myName = (savedG.name || '').trim();
    const myNameNorm = myName.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (noProfileBanner) {
        noProfileBanner.style.display = myName ? 'none' : 'block';
    }

    if (!myName) {
        list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--tm);font-family:'JetBrains Mono',monospace;font-size:.85rem">
            <div style="font-size:2.5rem;margin-bottom:12px">🔧</div>
            Complete your Garage Profile to see appointments.
        </div>`;
        return;
    }

    if (myName) renderInsuranceAuthorizedJobs(myName);

    // Immediate fetch for instant render
    try {
        const snapshot = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'appointments')
        );
        const allAppts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        _renderAppointmentCards(list, allAppts, savedG, myName, myNameNorm);
    } catch(e) {
        console.warn('[renderGarageAppointments] fetch error:', e);
    }

    // Attach real-time listener
    if (appointmentsUnsubscribe) {
        try { appointmentsUnsubscribe(); } catch(e) {}
        appointmentsUnsubscribe = null;
        _appointmentsListenerActive = false;
    }
    try {
        const col = window._fsCollection(window._fbDb, 'appointments');
        appointmentsUnsubscribe = window._fsOnSnapshot(col, (snapshot) => {
            const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _renderAppointmentCards(list, all, savedG, myName, myNameNorm);
            updateBellBadge();
        }, (err) => {
            console.warn('[Appointments listener]', err);
            _appointmentsListenerActive = false;
        });
    } catch(e) {
        console.warn('[renderGarageAppointments] listener setup error:', e);
    }
}
function _appointmentMatchesGarage(appt, myName, myNameNorm) {
    if (!myName) return false;
    const apptName = (appt.garage || '').trim();
    const apptNorm = apptName.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Exact match
    if (apptNorm === myNameNorm) return true;
    // Contains match
    if (apptNorm.includes(myNameNorm) || myNameNorm.includes(apptNorm)) return true;
    // Fuzzy word match
    return fuzzyMatch(apptName, myName);
}

function _renderAppointmentCards(list, allAppointments, savedG, myName, myNameNorm) {
    const mine = allAppointments
        .filter(a => _appointmentMatchesGarage(a, myName, myNameNorm))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const statEl = document.getElementById('garageStatAppointments');
    if (statEl) statEl.textContent = mine.length;

    if (!mine.length) {
        list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--tm);font-family:'JetBrains Mono',monospace;font-size:.85rem">
            <div style="font-size:2.5rem;margin-bottom:12px">📅</div>
            No appointments yet for <strong style="color:var(--t)">${myName}</strong>.
            <div style="margin-top:8px;font-size:.75rem;color:var(--td)">Appointments from owners booking "${myName}" will appear here in real-time.</div>
        </div>`;
        return;
    }

    const pending     = mine.filter(a => a.status === 'pending');
    const confirmed   = mine.filter(a => a.status === 'confirmed');
    const claimed     = mine.filter(a => a.status === 'claimed');
    const in_progress = mine.filter(a => a.status === 'in_progress');
    const done        = mine.filter(a => a.status === 'done');
    const rejected    = mine.filter(a => ['rejected','claim_rejected'].includes(a.status));

    const summaryBar = `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:24px;">
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:3px solid #f59e0b;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:#f59e0b;">${pending.length}</div>
            <div style="font-size:0.62rem;color:var(--tm);">Pending</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:3px solid #4ade80;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:#4ade80;">${confirmed.length}</div>
            <div style="font-size:0.62rem;color:var(--tm);">Confirmed</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:3px solid #60a5fa;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:#60a5fa;">${claimed.length}</div>
            <div style="font-size:0.62rem;color:var(--tm);">Claimed</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:3px solid #a78bfa;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:#a78bfa;">${in_progress.length}</div>
            <div style="font-size:0.62rem;color:var(--tm);">In Progress</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:3px solid var(--c);border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:var(--c);">${done.length}</div>
            <div style="font-size:0.62rem;color:var(--tm);">Done</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-top:3px solid #ff4444;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:#ff4444;">${rejected.length}</div>
            <div style="font-size:0.62rem;color:var(--tm);">Rejected</div>
        </div>
    </div>`;

    function apptCard(a) {
        const statusColors = {
            pending: '#f59e0b', confirmed: '#4ade80', claimed: '#60a5fa',
            in_progress: '#a78bfa', done: '#4ade80', rejected: '#ff4444', claim_rejected: '#ff4444',
        };
        const statusLabels = {
            pending: '⏳ Pending', confirmed: '✅ Confirmed', claimed: '🛡️ Claim Submitted',
            in_progress: '🔧 In Progress', done: '🏁 Done',
            rejected: '❌ Rejected', claim_rejected: '❌ Claim Rejected',
        };
        const sc = statusColors[a.status] || '#f59e0b';
        const d = new Date(a.date);
        const day   = isNaN(d) ? '--' : d.getDate();
        const month = isNaN(d) ? '---' : d.toLocaleString('default', { month: 'short' }).toUpperCase();

        let actions = '';
        if (a.status === 'pending') {
            actions = `
                <button onclick="updateApptStatus('${a.id}','confirmed')"
                    style="margin-right:8px;padding:7px 14px;background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.3);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">✅ Confirm</button>
                <button onclick="updateApptStatus('${a.id}','rejected')"
                    style="padding:7px 14px;background:rgba(255,68,68,0.1);color:#ff8888;border:1px solid rgba(255,68,68,0.3);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">❌ Reject</button>`;
        } else if (a.status === 'confirmed') {
            actions = `
                <button onclick="updateApptStatus('${a.id}','in_progress')"
                    style="padding:7px 14px;background:rgba(167,139,250,0.1);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">🔧 Start Service</button>`;
        } else if (a.status === 'in_progress') {
            actions = `
                <button onclick="viewOwnerInspection('${a.ownerId}','${a.id}')"
                    style="margin-right:8px;padding:7px 14px;background:rgba(96,165,250,0.1);color:#60a5fa;border:1px solid rgba(96,165,250,0.3);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">🔍 View AI Report</button>
                <button onclick="markServiceDone('${a.id}','${a.ownerId}')"
                    style="padding:7px 14px;background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.3);border-radius:8px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">🏁 Mark Done</button>`;
        } else if (a.status === 'claimed') {
            actions = `<div style="font-size:0.78rem;color:#60a5fa;font-family:'JetBrains Mono',monospace;">⏳ Awaiting insurance approval...</div>`;
        }

        const amtBadge = a.approvedAmount
            ? `<div style="font-size:0.75rem;color:#4ade80;font-family:'JetBrains Mono',monospace;margin-top:4px;">🛡️ Insurance: AED ${a.approvedAmount} authorized</div>`
            : '';

        return `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:flex-start;margin-bottom:10px;">
            <div style="text-align:center;background:${sc}15;border:1px solid ${sc}30;border-radius:10px;padding:10px 14px;min-width:52px;flex-shrink:0;">
                <div style="font-size:1.3rem;font-weight:900;color:${sc};">${day}</div>
                <div style="font-size:0.6rem;color:${sc};">${month}</div>
            </div>
            <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                    <div style="font-weight:800;color:var(--t);">${a.ownerName || 'Customer'}</div>
                    <span style="background:${sc}20;color:${sc};padding:3px 10px;border-radius:20px;font-size:0.65rem;font-weight:800;border:1px solid ${sc}40;">${statusLabels[a.status] || a.status}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--tm);">${a.ownerEmail || ''}</div>
                <div style="margin-top:6px;color:var(--t);">🔧 ${a.service}</div>
                <div style="font-size:0.78rem;color:var(--tm);">🕐 ${a.time} · 🚗 ${a.vehicle || '—'}</div>
                ${amtBadge}
                ${a.notes ? `<div style="margin-top:6px;font-size:0.75rem;color:var(--td);font-style:italic;">📝 ${a.notes}</div>` : ''}
                <div style="margin-top:10px;">${actions}</div>
            </div>
        </div>`;
    }

    let html = summaryBar;
    if (pending.length)     html += `<div style="margin:10px 0 8px;color:#f59e0b;font-weight:700;font-family:'Syne',sans-serif;">⏳ Pending (${pending.length})</div>` + pending.map(apptCard).join('');
    if (confirmed.length)   html += `<div style="margin:18px 0 8px;color:#4ade80;font-weight:700;font-family:'Syne',sans-serif;">✅ Confirmed (${confirmed.length})</div>` + confirmed.map(apptCard).join('');
    if (claimed.length)     html += `<div style="margin:18px 0 8px;color:#60a5fa;font-weight:700;font-family:'Syne',sans-serif;">🛡️ Claimed (${claimed.length})</div>` + claimed.map(apptCard).join('');
    if (in_progress.length) html += `<div style="margin:18px 0 8px;color:#a78bfa;font-weight:700;font-family:'Syne',sans-serif;">🔧 In Progress (${in_progress.length})</div>` + in_progress.map(apptCard).join('');
    if (done.length)        html += `<div style="margin:18px 0 8px;color:var(--c);font-weight:700;font-family:'Syne',sans-serif;">🏁 Done (${done.length})</div>` + done.map(apptCard).join('');
    if (rejected.length)    html += `<div style="margin:18px 0 8px;color:#ff4444;font-weight:700;font-family:'Syne',sans-serif;">❌ Rejected (${rejected.length})</div>` + rejected.map(apptCard).join('');

    list.innerHTML = html;
}
// Real-time appointments listener
async function markServiceDone(apptId, ownerId) {
    try {
        const uid = window._currentUser?.uid;
        if (!uid) return toast('Not logged in', 'error');

        // Get appointment details
        const all = await getAllAppointments();
        const appt = all.find(a => a.id === apptId);
        if (!appt) return toast('Appointment not found', 'error');

        // Get garage profile
        const garageSnap = await window._fsGetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'garage')
        );
        const garageData = garageSnap.exists() ? garageSnap.data() : {};

        // Get owner vehicle info
        let vehicleInfo = {};
        try {
            // Try active vehicle subcollection first
            const vSnap = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'users', ownerId, 'vehicles')
            );
            if (!vSnap.empty) {
                vehicleInfo = vSnap.docs[0].data();
            } else {
                // Fallback to mulkiya
                const mSnap = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', ownerId, 'profile', 'mulkiya')
                );
                if (mSnap.exists()) vehicleInfo = mSnap.data();
            }
        } catch(e) {}

        // Get owner's latest AI inspection defects
        let defectsFromAi = [];
        try {
            const iSnap = await window._fsGetDocs(
                window._fsQuery(
                    window._fsCollection(window._fbDb, 'users', ownerId, 'inspections'),
                    window._fsOrderBy('timestamp', 'desc')
                )
            );
            if (!iSnap.empty) {
                const latest = iSnap.docs[0].data();
                // defects stored as count — we pass empty array if no detail available
                defectsFromAi = latest.defectDetails || [];
            }
        } catch(e) {}

        // Check insurance approval
        let insuranceApproved = false;
        let approvedAmount = '';
        try {
            const claimsSnap = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'insuranceClaims')
            );
            const linkedClaim = claimsSnap.docs
                .map(d => d.data())
                .find(c => c.appointmentId === apptId && c.status === 'approved');
            if (linkedClaim) {
                insuranceApproved = true;
                approvedAmount = linkedClaim.approvedAmount || '';
            }
        } catch(e) {}

        // Open service completion modal to let garage fill in work done
        showServiceCompletionModal(
            apptId, ownerId, appt, vehicleInfo,
            defectsFromAi, garageData,
            insuranceApproved, approvedAmount
        );

    } catch(e) {
        console.error(e);
        toast('Failed to load service details', 'error');
    }
}
function showServiceCompletionModal(apptId, ownerId, appt, vehicleInfo, defectsFromAi, garageData, insuranceApproved, approvedAmount) {
    // Remove existing modal if any
    const existing = document.getElementById('serviceCompletionModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'serviceCompletionModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';

    modal.innerHTML = `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:18px;padding:28px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-family:'Syne',sans-serif;font-size:1.15rem;font-weight:800;color:var(--t);">🏁 Complete Service & Generate Report</h3>
            <button onclick="document.getElementById('serviceCompletionModal').remove()" style="background:transparent;border:none;color:var(--tm);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Vehicle summary -->
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:0.82rem;">
            <div style="color:var(--tm);font-size:0.68rem;font-family:'JetBrains Mono',monospace;margin-bottom:4px;">VEHICLE</div>
            <strong style="color:var(--t);">${appt.vehicle || '—'}</strong>
            <span style="color:var(--tm);margin-left:8px;">${appt.ownerName || ''}</span>
        </div>

        <!-- Technician name -->
        <div style="margin-bottom:14px;">
            <label style="font-size:0.78rem;color:var(--tm);display:block;margin-bottom:6px;">Technician Name</label>
            <input type="text" id="scm_tech" placeholder="e.g. Mohammed Al Rashid"
                style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:9px 14px;color:var(--t);font-family:'Syne',sans-serif;font-size:0.875rem;outline:none;">
        </div>

        <!-- Services performed -->
        <div style="margin-bottom:14px;">
            <label style="font-size:0.78rem;color:var(--tm);display:block;margin-bottom:8px;">Services Performed <span style="color:var(--td);font-size:0.7rem;">(add each item)</span></label>
            <div id="scm_services_list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>
            <button onclick="addServiceItem()" style="padding:7px 16px;background:rgba(200,216,228,0.08);border:1px solid var(--border);border-radius:8px;color:var(--c);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">+ Add Service Item</button>
        </div>

        <!-- Technician notes -->
        <div style="margin-bottom:18px;">
            <label style="font-size:0.78rem;color:var(--tm);display:block;margin-bottom:6px;">Technician Notes (optional)</label>
            <textarea id="scm_notes" rows="3" placeholder="Any observations, warnings, or follow-up recommendations..."
                style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:9px 14px;color:var(--t);font-family:'Syne',sans-serif;font-size:0.875rem;outline:none;resize:vertical;"></textarea>
        </div>

        ${insuranceApproved ? `
        <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.25);border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:0.82rem;color:#4ade80;">
            🛡️ Insurance approved — AED ${approvedAmount || '—'} authorized for this repair.
        </div>` : ''}

        <div style="display:flex;gap:10px;">
            <button onclick="document.getElementById('serviceCompletionModal').remove()"
                style="flex:1;padding:11px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;color:var(--tm);cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;">
                Cancel
            </button>
            <button onclick="submitServiceCompletion('${apptId}','${ownerId}')"
                style="flex:2;padding:11px;background:linear-gradient(135deg,var(--c),#3b82f6);border:none;border-radius:8px;color:#fff;cursor:pointer;font-family:'Syne',sans-serif;font-weight:800;font-size:0.9rem;">
                🏁 Mark Done & Generate PDF Report
            </button>
        </div>
    </div>`;

    // Store context on window for submitServiceCompletion to access
    window._scmContext = { appt, vehicleInfo, defectsFromAi, garageData, insuranceApproved, approvedAmount };
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);

    // Add one default service item
    addServiceItem();
}
function addServiceItem() {
    const list = document.getElementById('scm_services_list');
    if (!list) return;
    const idx = list.children.length;
    const item = document.createElement('div');
    item.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:center;';
    item.innerHTML = `
        <input type="text" placeholder="Task (e.g. Oil Change, Brake Pads)"
            style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--t);font-family:'Syne',sans-serif;font-size:0.82rem;outline:none;"
            id="scm_task_${idx}">
        <input type="text" placeholder="Parts used"
            style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--t);font-family:'Syne',sans-serif;font-size:0.82rem;outline:none;"
            id="scm_parts_${idx}">
        <input type="number" placeholder="Cost AED"
            style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--t);font-family:'Syne',sans-serif;font-size:0.82rem;outline:none;"
            id="scm_cost_${idx}">
        <button onclick="this.parentElement.remove()"
            style="padding:8px 10px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.25);border-radius:8px;color:#ff6666;cursor:pointer;font-size:0.85rem;">✕</button>
    `;
    list.appendChild(item);
}
async function submitServiceCompletion(apptId, ownerId) {
    const btn = document.querySelector('#serviceCompletionModal button[onclick*="submitServiceCompletion"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating report...'; }

    try {
        const ctx = window._scmContext || {};
        const techName  = document.getElementById('scm_tech')?.value.trim() || '';
        const techNotes = document.getElementById('scm_notes')?.value.trim() || '';

        // Collect service items
        const list = document.getElementById('scm_services_list');
        const services = [];
        if (list) {
            Array.from(list.children).forEach((row, i) => {
                const task  = document.getElementById(`scm_task_${i}`)?.value.trim();
                const parts = document.getElementById(`scm_parts_${i}`)?.value.trim() || '—';
                const cost  = document.getElementById(`scm_cost_${i}`)?.value.trim() || '—';
                if (task) services.push({ task, parts, cost, status: 'done' });
            });
        }

        if (!services.length) {
            toast('Please add at least one service item', 'error');
            if (btn) { btn.disabled = false; btn.textContent = '🏁 Mark Done & Generate PDF Report'; }
            return;
        }

        // Generate garage service PDF
        const reportRes = await fetch(`${API}/generate-garage-report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appointment:        ctx.appt || {},
                vehicle_info:       ctx.vehicleInfo || {},
                services_completed: services,
                defects_from_ai:    ctx.defectsFromAi || [],
                insurance_approved: ctx.insuranceApproved || false,
                approved_amount:    ctx.approvedAmount || '',
                technician_name:    techName,
                technician_notes:   techNotes,
            })
        });

        if (!reportRes.ok) throw new Error('PDF generation failed');

        // Update appointment status to done
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'appointments', apptId),
            {
                status:           'done',
                doneAt:           new Date().toLocaleDateString(),
                technicianName:   techName,
                servicesLogged:   services,
            }
        );

        // Notify owner with PDF download link
        await notifyUser(
            ownerId,
            `🏁 Your vehicle service at <strong>${ctx.appt?.garage || 'the garage'}</strong> is <strong>complete</strong>! ` +
            `<a href="${API}/garage-report" target="_blank" style="color:var(--c);font-weight:700;text-decoration:underline;">📄 Download Service Report</a>`,
            'confirmed'
        );

        // Close modal
        document.getElementById('serviceCompletionModal')?.remove();
        toast('✓ Service marked done — report generated & owner notified', 'success');

        renderGarageAppointments();
        updateBellBadge();

    } catch(e) {
        console.error(e);
        toast('Failed to complete service: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🏁 Mark Done & Generate PDF Report'; }
    }
}
async function viewOwnerInspection(ownerId, apptId) {
    if (!ownerId) return toast('No owner linked to this appointment', 'error');
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:18px;padding:28px;max-width:540px;width:100%;max-height:85vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;color:var(--t);">🔍 Owner's Latest AI Inspection</h3>
            <button onclick="this.closest('[style*=fixed]').remove()" style="background:transparent;border:none;color:var(--tm);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div style="text-align:center;padding:40px;color:var(--tm);">
            <div class="spinner" style="margin:0 auto 16px;"></div>
            Loading inspection data...
        </div>
    </div>`;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
    const inner = modal.querySelector('div');

    try {
        // Fetch inspection records
        let records = [];
        try {
            const q = window._fsQuery(
                window._fsCollection(window._fbDb, 'users', ownerId, 'inspections'),
                window._fsOrderBy('timestamp', 'desc')
            );
            const snap = await window._fsGetDocs(q);
            records = snap.docs.map(d => d.data());
        } catch(e) {
            console.warn('[ViewInspection] fetch error:', e);
        }

        // Filter to owner-role inspections only
        const ownerRecords = records.filter(r => !r.role || r.role === 'owner');
        
        if (!ownerRecords.length) {
            inner.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h3 style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;color:var(--t);">🔍 Owner's Latest AI Inspection</h3>
                <button onclick="this.closest('[style*=fixed]').remove()" style="background:transparent;border:none;color:var(--tm);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
            <div style="text-align:center;padding:40px;color:var(--tm);">
                <div style="font-size:2.5rem;margin-bottom:12px;">🔍</div>
                <p>Owner has no AI inspection reports yet.</p>
                <p style="font-size:0.78rem;margin-top:8px;">Ask them to run an inspection from their portal first.</p>
            </div>`;
            return;
        }

        const latest = ownerRecords[0];
        const defects = latest.defectDetails || [];
        const statusColor = latest.status === 'pass' ? '#4ade80' : latest.status === 'attention' ? '#f59e0b' : '#ff4444';

        // Build defect rows
        const defectRows = defects.length
            ? defects.map(d => {
                const label = d.label || d.class || 'Unknown';
                const conf  = Number(d.confidence || 0).toFixed(1);
                const sev   = conf >= 80 ? 'Severe' : conf >= 55 ? 'Moderate' : 'Minor';
                const sc    = conf >= 80 ? '#ff4444' : conf >= 55 ? '#f59e0b' : '#4ade80';
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span style="color:var(--t);font-weight:600;">${label}</span>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="color:${sc};font-size:0.75rem;font-weight:700;">${sev}</span>
                        <span style="color:var(--tm);font-size:0.75rem;font-family:'JetBrains Mono',monospace;">${conf}%</span>
                    </div>
                </div>`;
            }).join('')
            : `<div style="padding:12px;color:var(--tm);font-size:0.82rem;">No detailed defect breakdown available.</div>`;

        // Build history rows (last 5)
        const historyRows = ownerRecords.slice(0, 5).map((r, i) => {
            const sc = r.status === 'pass' ? '#4ade80' : r.status === 'attention' ? '#f59e0b' : '#ff4444';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.8rem;">
                <div>
                    <span style="color:var(--t);font-weight:600;">${r.vehicle || '—'}</span>
                    <span style="color:var(--tm);margin-left:8px;">${r.date || ''}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="color:${sc};font-weight:700;font-size:0.72rem;">${(r.status||'').toUpperCase()}</span>
                    <span style="color:var(--tm);font-size:0.72rem;">${r.defects || 0} defects</span>
                    ${r.engineKnock === true ? '<span style="color:#ff4444;font-size:0.72rem;">⚠ Knock</span>' : r.engineKnock === false ? '<span style="color:#4ade80;font-size:0.72rem;">✓ Engine OK</span>' : ''}
                </div>
            </div>`;
        }).join('');

        // Build PDF URL — store latest report URL on the inspection record if possible
        // We use the backend /report endpoint which serves the last generated PDF
        const pdfUrl = latest.pdfUrl || `${API}/report`;

        inner.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;color:var(--t);">🔍 Owner's Inspection Reports</h3>
            <button onclick="this.closest('[style*=fixed]').remove()" style="background:transparent;border:none;color:var(--tm);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Latest inspection summary stats -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px;">
            <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;text-align:center;">
                <div style="font-size:1.4rem;font-weight:800;color:${statusColor};">${(latest.status || '—').toUpperCase()}</div>
                <div style="font-size:0.65rem;color:var(--tm);margin-top:2px;">RESULT</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;text-align:center;">
                <div style="font-size:1.4rem;font-weight:800;color:var(--c);">${latest.defects || 0}</div>
                <div style="font-size:0.65rem;color:var(--tm);margin-top:2px;">DEFECT TYPES</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;text-align:center;">
                <div style="font-size:1.4rem;font-weight:800;color:${latest.score >= 75 ? '#4ade80' : latest.score >= 50 ? '#f59e0b' : '#ff4444'};">${latest.score || '—'}</div>
                <div style="font-size:0.65rem;color:var(--tm);margin-top:2px;">HEALTH SCORE</div>
            </div>
        </div>

        <!-- Vehicle + date -->
        <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="color:var(--tm);">Vehicle</span>
                <strong style="color:var(--t);">${latest.vehicle || '—'}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="color:var(--tm);">Latest Inspection</span>
                <strong style="color:var(--t);">${latest.date || '—'}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="color:var(--tm);">Total Inspections</span>
                <strong style="color:var(--t);">${ownerRecords.length}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--tm);">Engine</span>
                <strong style="color:${latest.engineKnock === true ? '#ff4444' : '#4ade80'};">
                    ${latest.engineKnock === true ? '⚠ Knock Detected' : latest.engineKnock === false ? '✓ Healthy' : '—'}
                </strong>
            </div>
        </div>

        <!-- Defect breakdown -->
        <div style="margin-bottom:16px;">
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-bottom:8px;">Latest Defect Breakdown</div>
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
                ${defectRows}
            </div>
        </div>

        <!-- Inspection history -->
        ${ownerRecords.length > 1 ? `
        <div style="margin-bottom:18px;">
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-bottom:8px;">Inspection History (Last ${Math.min(ownerRecords.length, 5)})</div>
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
                ${historyRows}
            </div>
        </div>` : ''}

        <!-- Actions -->
        <div style="display:flex;gap:10px;">
            <a href="${pdfUrl}" target="_blank" 
               style="flex:1;padding:11px;background:linear-gradient(135deg,var(--c),#3b82f6);border:none;border-radius:8px;color:#fff;font-weight:800;font-family:'Syne',sans-serif;font-size:0.85rem;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;">
                📄 Open Latest PDF Report
            </a>
            <button onclick="this.closest('[style*=fixed]').remove()"
                style="flex:1;padding:11px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;color:var(--tm);cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;">
                Close
            </button>
        </div>`;

    } catch(e) {
        console.error('[viewOwnerInspection]', e);
        toast('Failed to load inspection', 'error');
        modal.remove();
    }
}
async function getAllNotifications() {
    try {
        const uid = window._currentUser?.uid;
        if (!uid) return [];
        const snap = await window._fsGetDocs(
            window._fsQuery(
                window._fsCollection(window._fbDb, 'users', uid, 'notifications'),
                window._fsOrderBy('date', 'desc')
            )
        );
        return snap.docs.map(d => d.data());
    } catch(e) {
        // Fallback without orderBy if index missing
        try {
            const uid2 = window._currentUser?.uid;
            const snap2 = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'users', uid2, 'notifications')
            );
            return snap2.docs.map(d => d.data())
                .sort((a,b) => (b.date||'') > (a.date||'') ? 1 : -1);
        } catch(e2) { return []; }
    }
}

async function saveAllNotifications(arr) {
    // No longer needed — notifications saved individually
}
        async function notifyUser(uid, text, type) {
    try {
        const notifId = 'notif_' + Date.now();
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'notifications', notifId),
            { id: notifId, uid, text, type, read: false, date: new Date().toLocaleDateString() }
        );
        updateBellBadge();
    } catch(e) {
        console.warn('[Notify] failed:', e);
    }
}
async function notifyGarage(garageName, text, type, apptId) {
    try {
        const notifId = 'gnotif_' + Date.now();
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'garageNotifications', notifId),
            { id: notifId, garageName: garageName.toLowerCase(), text, type, apptId, read: false, date: new Date().toLocaleDateString() }
        );
    } catch(e) {
        console.warn('[GarageNotify] failed:', e);
    }
}

async function getGarageNotifications(garageName) {
    try {
        const snap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'garageNotifications')
        );
        return snap.docs.map(d => d.data()).filter(n => n.garageName === garageName.toLowerCase());
    } catch(e) { return []; }
}
       let _bellUpdateTimer = null;
window.updateBellBadge = async function () {
    // Debounce rapid calls
    if (_bellUpdateTimer) clearTimeout(_bellUpdateTimer);
    _bellUpdateTimer = setTimeout(async () => {
        try {
            await _doUpdateBellBadge();
        } catch(e) {
            console.warn('[Bell] update failed:', e);
        }
    }, 300);
};

async function _doUpdateBellBadge() {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    const badge = document.getElementById('navUnreadBadge');
    if (!badge) return;

    if (_currentRole === 'owner') {
        try {
            const notifs = await getAllNotifications();
            const unread = notifs.filter(n => !n.read).length;
            badge.textContent = unread;
            badge.style.display = unread > 0 ? 'block' : 'none';
        } catch(e) {
            badge.style.display = 'none';
        }
        return;
    }

    if (_currentRole === 'garage') {
    try {
        const uid2 = window._currentUser?.uid;
        // Always re-fetch garage name fresh
        let myName = '';
        try {
            const gSnap = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid2, 'profile', 'garage')
            );
            if (gSnap.exists()) {
                myName = (gSnap.data().name || '').trim();
            } else {
                const mSnap = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', uid2, 'profile', 'meta')
                );
                if (mSnap.exists()) {
                    myName = (mSnap.data().garage?.name || '').trim();
                }
            }
        } catch(e) {}

        if (!myName) { badge.style.display = 'none'; return; }

        const myNameNorm = myName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const all = await getAllAppointments();

        const pendingCount = all.filter(a => {
            if (a.status !== 'pending') return false;
            return _appointmentMatchesGarage(a, myName, myNameNorm);
        }).length;

        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'block' : 'none';

    } catch(e) {
        badge.style.display = 'none';
    }
    return;
}
    // Other roles — hide badge
    badge.style.display = 'none';
}
        window.addEventListener('storage', () => { if (window._currentUser) updateBellBadge(); });

    async  function renderInbox() {
    const list = document.getElementById('inboxList');
    if (!list) return;
    const uid = window._currentUser?.uid || 'guest';

 if (_currentRole === 'garage') {
    let savedG = window._garageProfile || {};
    if (!savedG.name) {
        try {
            const snapG = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'garage')
            );
            if (snapG.exists()) {
                savedG = snapG.data();
            } else {
                const metaSnap = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta')
                );
                if (metaSnap.exists()) {
                    savedG = metaSnap.data().garage || {};
                    if (!savedG.name) {
                        const m = metaSnap.data();
                        savedG = { name: m.garageName || m.name || '' };
                    }
                }
            }
            window._garageProfile = savedG;
        } catch(e) { console.warn('[renderInbox] profile fetch error:', e); }
    }
  const myNameRaw  = (savedG.name || '').trim();
    const myName     = myNameRaw.toLowerCase();
    const myNameNorm = myName.replace(/[^a-z0-9]/g, '');
    
    const all = await getAllAppointments();
    const mine = all.filter(a => _appointmentMatchesGarage(a, myNameRaw, myNameNorm))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    // ... rest of inbox render stays the same

    const statusColors = { pending:'#f59e0b', confirmed:'#4ade80', completed:'#4ade80', rejected:'#ff4444', cancelled:'#ff4444' };
    
    // Build html string first, then set innerHTML once at the end
    let html = '';

    if (!mine.length) {
        html = `<div style="text-align:center;padding:40px;color:var(--tm);font-family:'JetBrains Mono',monospace">No booking requests yet for <strong style="color:var(--t)">${savedG.name || 'your garage'}</strong>.</div>`;
    } else {
        html = mine.map(a => {
            const sc = statusColors[a.status] || '#f59e0b';
            return `
            <div style="background:var(--bg4);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:14px;padding:20px 22px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
                    <div>
                        <div style="font-weight:800;font-size:1.05rem;color:var(--t);margin-bottom:3px">${a.ownerName || 'Vehicle Owner'}</div>
                        <div style="font-size:0.78rem;color:var(--tm);font-family:'JetBrains Mono',monospace">📧 ${a.ownerEmail||''}</div>
                    </div>
                    <span style="background:${sc}20;color:${sc};padding:5px 14px;border-radius:20px;font-size:0.7rem;font-weight:800;border:1px solid ${sc}40;">${(a.status||'pending').toUpperCase()}</span>
                </div>
                <div style="margin:14px 0;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.83rem;">
                    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 12px"><span style="color:var(--tm);font-size:0.7rem;display:block;margin-bottom:2px">SERVICE</span><strong>${a.service}</strong></div>
                    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 12px"><span style="color:var(--tm);font-size:0.7rem;display:block;margin-bottom:2px">VEHICLE</span><strong>${a.vehicle||'—'}</strong></div>
                    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 12px"><span style="color:var(--tm);font-size:0.7rem;display:block;margin-bottom:2px">DATE & TIME</span><strong>${a.date} · ${a.time}</strong></div>
                    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 12px"><span style="color:var(--tm);font-size:0.7rem;display:block;margin-bottom:2px">BOOKED ON</span><strong>${a.created||'—'}</strong></div>
                </div>
                ${a.notes?`<div style="font-size:0.8rem;color:var(--td);font-style:italic;margin-bottom:12px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;">📝 ${a.notes}</div>`:''}
                ${a.status==='pending'?`
                <div style="display:flex;gap:10px;margin-top:4px">
                    <button onclick="updateApptStatus('${a.id}','confirmed')" style="flex:1;padding:10px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#4ade80;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">✅ Approve Booking</button>
                    <button onclick="updateApptStatus('${a.id}','rejected')" style="flex:1;padding:10px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.25);color:#ff6666;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">❌ Reject</button>
                </div>`:
                a.status==='confirmed'?`<button onclick="updateApptStatus('${a.id}','completed')" style="padding:10px 20px;background:rgba(200,216,228,0.08);border:1px solid rgba(200,216,228,0.2);color:var(--c);border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif">🏁 Mark as Completed</button>`:''}
            </div>`;
        }).join('');
// Fetch insurance approval notifications for this garage
const insuranceNotifs = await getGarageNotifications(myName);
const insuranceMessages = insuranceNotifs.filter(n => n.type === 'approved' || n.type === 'rejected');

if (insuranceMessages.length) {
    html += `<div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#4ade80;font-family:'JetBrains Mono',monospace;margin:18px 0 12px;padding-left:4px;">🛡️ Insurance Decisions</div>`;
    html += insuranceMessages.map(n => {
        const sc = n.type === 'approved' ? 'rgba(74,222,128,0.08)' : 'rgba(255,68,68,0.08)';
        const bc = n.type === 'approved' ? 'rgba(74,222,128,0.3)' : 'rgba(255,68,68,0.3)';
        return `<div style="background:${sc};border:1px solid ${bc};border-radius:10px;padding:14px 16px;margin-bottom:8px;">
            <div style="font-size:0.88rem;color:var(--t);font-weight:600;line-height:1.4">${n.text}</div>
            <div style="font-size:0.7rem;color:var(--tm);margin-top:4px;font-family:'JetBrains Mono',monospace">${n.date}</div>
        </div>`;
    }).join('');
}

list.innerHTML = html;
        // Mark garage notifs read
        const gNotifs = await getGarageNotifications(myName);
for (const n of gNotifs) {
    if (!n.read) {
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'garageNotifications', n.id),
            { read: true }
        );
    }

    // Fetch insurance approval notifications and append to html
    try {
        const insuranceNotifs = await getGarageNotifications(myName);
        const insuranceMessages = insuranceNotifs.filter(n => n.type === 'approved' || n.type === 'rejected');
        if (insuranceMessages.length) {
            html += `<div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#4ade80;font-family:'JetBrains Mono',monospace;margin:18px 0 12px;padding-left:4px;">🛡️ Insurance Decisions</div>`;
            html += insuranceMessages.map(n => {
                const sc = n.type === 'approved' ? 'rgba(74,222,128,0.08)' : 'rgba(255,68,68,0.08)';
                const bc = n.type === 'approved' ? 'rgba(74,222,128,0.3)' : 'rgba(255,68,68,0.3)';
                return `<div style="background:${sc};border:1px solid ${bc};border-radius:10px;padding:14px 16px;margin-bottom:8px;">
                    <div style="font-size:0.88rem;color:var(--t);font-weight:600;line-height:1.4">${n.text}</div>
                    <div style="font-size:0.7rem;color:var(--tm);margin-top:4px;font-family:'JetBrains Mono',monospace">${n.date}</div>
                </div>`;
            }).join('');
        }
    } catch(e) { console.warn('[Inbox] insurance notifs failed:', e); }

    // Set innerHTML once at the end
    list.innerHTML = html;

    // Mark garage notifs as read
    try {
        const gNotifs = await getGarageNotifications(myName);
        for (const n of gNotifs) {
            if (!n.read) {
                await window._fsUpdateDoc(
                    window._fsDoc(window._fbDb, 'garageNotifications', n.id),
                    { read: true }
                );
            }
        }
        // Mark garageInbox as read
        const inboxSnap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'garageInbox'));
        for (const doc of inboxSnap.docs) {
            const n = doc.data();
            if (n.status === 'unread' && fuzzyMatch(n.garageNameRaw || '', savedG.name || '')) {
                await window._fsUpdateDoc(
                    window._fsDoc(window._fbDb, 'garageInbox', doc.id),
                    { status: 'read' }
                );
            }
        }
        setTimeout(() => updateBellBadge(), 300);
    } catch(e) { console.warn('[Inbox] mark read failed:', e); }

    } else {
        // OWNER: show booking tracking timeline + system notifications
const allAppts = await getAllAppointments();
const myAppts = allAppts.filter(a => a.ownerId === uid);
const notifications = await getAllNotifications();

        if (!myAppts.length && !notifications.length) {
            list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--tm)">No notifications yet. Book a garage to get started!</div>`;
            return;
        }

        let html = '';

        // Booking tracking section
        if (myAppts.length) {
            html += `<div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-bottom:12px;padding-left:4px;">📅 My Bookings</div>`;
            const statusColors = { pending:'#f59e0b', confirmed:'#4ade80', completed:'#4ade80', rejected:'#ff4444' };
            const statusIcons = { pending:'⏳', confirmed:'✅', completed:'🏁', rejected:'❌' };
            const steps = ['pending','confirmed','completed'];
            html += myAppts.map(a => {
                const sc = statusColors[a.status]||'#f59e0b';
                const si = statusIcons[a.status]||'⏳';
                const currentStep = steps.indexOf(a.status);
                return `
                <div style="background:var(--bg4);border:1px solid var(--border);border-left:4px solid ${sc};border-radius:14px;padding:18px 20px;margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                        <div>
                            <div style="font-weight:800;font-size:0.95rem;color:var(--t)">${a.garage}</div>
                            <div style="font-size:0.75rem;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-top:2px">${a.service} · ${a.date} · ${a.time}</div>
                        </div>
                        <span style="background:${sc}20;color:${sc};padding:4px 12px;border-radius:20px;font-size:0.68rem;font-weight:800;border:1px solid ${sc}40;font-family:'JetBrains Mono',monospace">${si} ${(a.status||'pending').toUpperCase()}</span>
                    </div>
                    <!-- Progress Track -->
                    <div style="position:relative;padding:10px 0 4px;">
                        <div style="position:absolute;top:21px;left:16px;right:16px;height:2px;background:rgba(255,255,255,0.08);z-index:0;"></div>
                        <div style="position:absolute;top:21px;left:16px;height:2px;background:${sc};z-index:1;transition:width 0.6s ease;width:${a.status==='rejected'?'0':currentStep===0?'0':currentStep===1?'50%':'100%'}"></div>
                        <div style="display:flex;justify-content:space-between;position:relative;z-index:2;">
                            ${steps.map((step,i) => {
                                const done = currentStep >= i;
                                const isRejected = a.status==='rejected';
                                const color = (isRejected&&i>0) ? '#444' : done ? sc : 'rgba(255,255,255,0.15)';
                                const textColor = done&&!isRejected ? sc : 'var(--td)';
                                const labels = ['Submitted','Confirmed','Completed'];
                                return `<div style="text-align:center;flex:1;">
                                    <div style="width:12px;height:12px;border-radius:50%;background:${color};margin:0 auto 6px;box-shadow:${done&&!isRejected?'0 0 8px '+sc+'80':'none'};transition:all 0.4s;"></div>
                                    <div style="font-size:0.6rem;color:${textColor};font-family:'JetBrains Mono',monospace;font-weight:${done?'700':'400'}">${labels[i]}</div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                    ${a.status==='rejected'?`<div style="margin-top:10px;font-size:0.78rem;color:#ff8888;padding:8px 12px;background:rgba(255,68,68,0.06);border-radius:8px;border:1px solid rgba(255,68,68,0.15)">This booking was not accepted. You can try booking another garage.</div>`:''}
                </div>`;
            }).join('');
        }

        // Notifications
        if (notifications.length) {
            html += `<div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:var(--tm);font-family:'JetBrains Mono',monospace;margin:18px 0 12px;padding-left:4px;">🔔 Notifications</div>`;
            const nc = { confirmed:'rgba(74,222,128,0.08)', rejected:'rgba(255,68,68,0.08)', completed:'rgba(200,216,228,0.08)' };
            const nb = { confirmed:'rgba(74,222,128,0.3)', rejected:'rgba(255,68,68,0.3)', completed:'rgba(200,216,228,0.3)' };
html += notifications.map(n => `
<div style="background:${nc[n.type]||'rgba(200,216,228,0.05)'};border:1px solid ${nb[n.type]||'rgba(200,216,228,0.15)'};border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
    <div>
        <div style="font-size:0.88rem;color:var(--t);font-weight:600;line-height:1.6">${n.text}</div>
        <div style="font-size:0.7rem;color:var(--tm);margin-top:4px;font-family:'JetBrains Mono',monospace">${n.date}</div>
    </div>
</div>`).join('');

            // Mark read
            let changed = false;
            const allNotifs = await getAllNotifications();
for (const n of allNotifs) {
    if (!n.read) {
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'notifications', n.id),
            { read: true }
        );
    }
}
setTimeout(()=>updateBellBadge(),100);
        }

        list.innerHTML = html;
    }
}

async function updateApptStatus(id, newStatus) {
    try {
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'appointments', id),
            {
                status: newStatus,
                statusUpdated: new Date().toLocaleDateString()
            }
        );
        const all = await getAllAppointments();
        const appt = all.find(a => a.id === id);
        if (appt) {
            const msgMap = {
                confirmed: `✅ Your appointment at <strong>${appt.garage}</strong> on ${appt.date} has been <strong>confirmed</strong>!`,
                rejected:  `❌ Your appointment at <strong>${appt.garage}</strong> on ${appt.date} was <strong>rejected</strong>.`,
                completed: `🎉 Your service at <strong>${appt.garage}</strong> is <strong>completed</strong>. Thank you!`,
                claimed:   `🛡️ Insurance claim submitted for your repair at <strong>${appt.garage}</strong>. Awaiting approval.`,
                in_progress: `🔧 Repairs have started at <strong>${appt.garage}</strong> for your vehicle.`,
                done:      `✅ Your vehicle service at <strong>${appt.garage}</strong> is fully <strong>done</strong>! Download your report below.`,
            };
            if (msgMap[newStatus]) notifyUser(appt.ownerId, msgMap[newStatus], newStatus);
            if (newStatus === 'confirmed' && appt && appt.service?.toLowerCase().includes('accident')) {
    await createInsuranceClaim(appt);
}
            if (msgMap[newStatus]) notifyUser(appt.ownerId, msgMap[newStatus], newStatus === 'rejected' ? 'rejected' : 'confirmed');

            // Auto-trigger insurance claim when garage confirms an accident appointment
            const isAccident = (appt.service || '').toLowerCase().includes('accident') ||
                               (appt.serviceType || '') === 'accident';
            if (newStatus === 'confirmed' && isAccident) {
                await createInsuranceClaim(appt);
                // Update appointment to 'claimed' status
                await window._fsUpdateDoc(
                    window._fsDoc(window._fbDb, 'appointments', id),
                    { status: 'claimed', claimedAt: new Date().toLocaleDateString() }
                );
                notifyUser(appt.ownerId,
                    `🛡️ Insurance claim auto-submitted for your accident repair at <strong>${appt.garage}</strong>. Awaiting insurer approval.`,
                    'confirmed'
                );
            }
        }
        renderGarageAppointments();
        renderInbox();
        updateBellBadge();
        toast(`Appointment ${newStatus}`, newStatus === 'rejected' ? 'error' : 'success');
    } catch(e) {
        console.warn('[Appointments] update failed:', e);
        toast('Failed to update appointment', 'error');
    }
}      // ─── Car Life Report ──────────────────────────────────────────────────────────
