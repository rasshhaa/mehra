        // ─── Portal show/hide ─────────────────────────────────────────────────────────
 async function showPortal(user, role) {
    _currentRole = role;

    // Hide everything first
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('live-camera').classList.remove('active');
    document.getElementById('publicNav').style.display = 'none';

    // Activate portal
    document.getElementById('rolePortal').classList.add('active');

    // Reset portal sections and nav
    document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.snav-item').forEach(i => i.classList.remove('active'));

    // Show correct sidebar nav
    document.getElementById('ownerNav').style.display = role === 'owner' ? 'block' : 'none';
    document.getElementById('garageNav').style.display = role === 'garage' ? 'block' : 'none';
    document.getElementById('insuranceNav').style.display = role === 'insurance' ? 'block' : 'none';
    document.getElementById('rtaNav').style.display = role === 'rta' ? 'block' : 'none';
    document.getElementById('tasjeelNav').style.display = role === 'tasjeel' ? 'block' : 'none';
    document.getElementById('marketplaceNav').style.display = role === 'marketplace' ? 'block' : 'none';

    // Update sidebar badge
    const badge = document.getElementById('sidebarRoleBadge');
    if (role === 'garage') {
        badge.textContent = 'Service Center';
    } else if (role === 'insurance') {
        badge.textContent = 'Insurance Company';
    } else if (role === 'rta') {
        badge.textContent = 'RTA Authority';
    } else if (role === 'tasjeel') {
        badge.textContent = 'Tasjeel Centre';
    } else if (role === 'marketplace') {
        badge.textContent = 'Marketplace Operator';
    } else {
        badge.textContent = 'Vehicle Owner';
    }
    badge.className = `sidebar-role-badge ${role}`;

    // Hide service type field for non-garages
    const stf = document.getElementById('serviceTypeField');
    if (stf) stf.style.display = role === 'garage' ? '' : 'none';

    // Set user info
    const email = user.email || '';
    document.getElementById('sidebarEmail').textContent = email;
    document.getElementById('sidebarAvatar').textContent = email.charAt(0).toUpperCase();

    // ────── ROLE-SPECIFIC LOADING ──────
    state = freshState();

    if (role === 'owner') {
        portalGoTo('profile');
        checkAndLoadSavedProfile();
        // Inside the `if (role === 'owner')` block, after checkAndLoadSavedProfile():
setTimeout(() => checkExpiryWarnings(), 2000); // slight delay so UI settles
    } 
    else if (role === 'garage') {
        // Garage profile loading + rich card
        Promise.all([
            window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'garage')),
            window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'meta'))
        ]).then(([garageSnap, metaSnap]) => {
            const savedG = garageSnap.exists() ? garageSnap.data()
                         : (metaSnap.exists() && metaSnap.data().garage ? metaSnap.data().garage : {});

            if (!garageSnap.exists() && savedG.name) {
                window._fsSetDoc(
                    window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'garage'),
                    savedG
                ).catch(e => console.warn('[Garage] auto-save failed:', e));
            }

            // Populate form
            document.getElementById('garageName').value    = savedG.name    || '';
            document.getElementById('garagePhone').value   = savedG.phone   || '';
            document.getElementById('garageAddress').value = savedG.address || '';
            document.getElementById('garageCity').value    = savedG.city    || '';
            document.getElementById('garageLicense').value = savedG.license || '';

            // Render rich hero card (Fix 5)
            renderGarageProfileCard(savedG);

            renderGarageAppointments();
            updateBellBadge();
        });

        portalGoTo('garageProfile');
    } 
    else if (role === 'insurance') {
        // Load insurance profile
    // Read garage name from ALL possible Firestore locations
    let savedG = {};
    try {
        const [garageSnap, metaSnap] = await Promise.all([
            window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'garage')),
            window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'meta'))
        ]);

        if (garageSnap.exists()) {
            savedG = garageSnap.data();
        } else if (metaSnap.exists() && metaSnap.data().garage) {
            savedG = metaSnap.data().garage;
        } else if (metaSnap.exists()) {
            // Signup data stored flat on meta
            const m = metaSnap.data();
            savedG = {
                name:    m.garageName || m.name || '',
                city:    m.garageCity || m.city || '',
                license: m.garageLicense || m.license || '',
                phone:   m.garagePhone || m.phone || '',
                address: m.garageAddress || m.address || '',
            };
        }

        // If name still empty, try reading the auth displayName
        if (!savedG.name && user.displayName) {
            savedG.name = user.displayName;
        }

    } catch(e) {
        console.warn('[showPortal garage] profile read error:', e);
    }

    // Store globally so all functions can access it without re-fetching
    window._garageProfile = savedG;
    console.log('[Garage Login] Profile loaded:', savedG);
    console.log('[Garage Login] Name:', savedG.name);

    // Auto-save to profile/garage if it only exists in meta
    if (savedG.name) {
        window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'garage'),
            savedG
        ).catch(e => console.warn('[Garage] auto-save failed:', e));
    }

    // Populate form fields
    if (document.getElementById('garageName'))    document.getElementById('garageName').value    = savedG.name    || '';
    if (document.getElementById('garagePhone'))   document.getElementById('garagePhone').value   = savedG.phone   || '';
    if (document.getElementById('garageAddress')) document.getElementById('garageAddress').value = savedG.address || '';
    if (document.getElementById('garageCity'))    document.getElementById('garageCity').value    = savedG.city    || '';
    if (document.getElementById('garageLicense')) document.getElementById('garageLicense').value = savedG.license || '';

    renderGarageProfileCard(savedG);
    portalGoTo('garageProfile');

    // Scan for existing appointments and notify
   if (savedG.name) {
        // Run scan immediately, no delay
        scanAndNotifyExistingAppointments(savedG.name, user.uid);
    }

    // Small delay so _garageProfile is set before rendering
    setTimeout(() => renderGarageAppointments(), 200);
    updateBellBadge();

    // Real-time listener
    getAllAppointmentsRealTime((all) => {
        updateBellBadge();
        if (document.getElementById('sec-appointments')?.classList.contains('active')) {
            renderGarageAppointments();
        }
        _checkForNewPendingAppointments(all);
    });
} else if (role === 'insurance') {
        window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'insurance'))
            .then(snap => {
                if (snap.exists()) {
                    const d = snap.data();
                    document.getElementById('insCompanyName').value = d.name || '';
                    document.getElementById('insLicense').value     = d.license || '';
                    document.getElementById('insPhone').value       = d.phone || '';
                    document.getElementById('insCity').value        = d.city || '';
                }
            })
            .catch(err => console.warn('[Insurance Profile] load error:', err));

        portalGoTo('insProfile');
        renderInsClaims();   // Show incoming claims by default
        portalGoTo('insProfile');
        renderInsClaims();
    }
    else if (role === 'rta') {
        window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'rta'))
            .then(snap => {
                if (snap.exists()) {
                    const d = snap.data();
                    document.getElementById('rtaOfficerName').value = d.name || '';
                    document.getElementById('rtaDept').value = d.dept || '';
                    document.getElementById('rtaBadge').value = d.badge || '';
                }
            }).catch(e => {});
        portalGoTo('rtaDashboard');
        renderRtaDashboard();
    }
    else if (role === 'tasjeel') {
        window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'tasjeel'))
            .then(snap => {
                if (snap.exists()) {
                    const d = snap.data();
                    document.getElementById('tasjeelCentreName').value = d.name || '';
                    document.getElementById('tasjeelLocation').value = d.location || '';
                    document.getElementById('tasjeelLicense').value = d.license || '';
                }
            }).catch(e => {});
        portalGoTo('tasjeelDashboard');
        renderTasjeelDashboard();
    }
    else if (role === 'marketplace') {
        window._fsGetDoc(window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'mkt'))
            .then(snap => {
                if (snap.exists()) {
                    const d = snap.data();
                    document.getElementById('mktPlatformName').value = d.name || '';
                    document.getElementById('mktContactPerson').value = d.contact || '';
                    document.getElementById('mktBizLicense').value = d.license || '';
                }
            }).catch(e => {});
        portalGoTo('mktDashboard');
        renderMktDashboard();
    }

    // Common renders
    renderPortalHistory();
    renderPortalAppointments();
    updateBellBadge();
}
        function hidePortal() {
    document.getElementById('rolePortal').classList.remove('active');
function hidePortal() {
    // Stop listeners
    if (typeof stopAppointmentsListener === 'function') stopAppointmentsListener();

    // Stop any active camera
    if (typeof lcStopStreamOnly === 'function') lcStopStreamOnly();

    // Hide portal and live camera
    const portal = document.getElementById('rolePortal');
    if (portal) portal.classList.remove('active');
    const liveCamera = document.getElementById('live-camera');
    if (liveCamera) liveCamera.classList.remove('active');

    // Show public nav
    document.getElementById('publicNav').style.display = '';

    // Deactivate all pages then show landing
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('landing').classList.add('active');

    // Deactivate all portal sections
    document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));

    // Close sidebar
    closeSidebar();
    window.scrollTo(0, 0);
}
async function scanAndNotifyExistingAppointments(garageName, garageUid) {
    try {
        const all = await getAllAppointments();
        const norm = garageName.toLowerCase().replace(/[^a-z0-9]/g, '');

        const matched = all.filter(a => {
            const apptNorm = (a.garage || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return apptNorm === norm ||
                   apptNorm.includes(norm) ||
                   norm.includes(apptNorm) ||
                   fuzzyMatch(a.garage || '', garageName);
        });

        console.log('[Scan] Garage:', garageName, '| Matched:', matched.length, '| All appts:', all.length);
        console.log('[Scan] All garages in appointments:', [...new Set(all.map(a => a.garage))]);

        if (!matched.length) {
            console.log('[Scan] No matches found');
            return;
        }

        const newCount = matched.length;

        // Update bell badge immediately
        const badge = document.getElementById('navUnreadBadge');
        if (badge) {
            badge.textContent = newCount;
            badge.style.display = 'block';
        }

        // Show welcome banner
        showGarageWelcomeAlert(garageName, newCount, matched);

        // Write to garageInbox for persistence
        for (const appt of matched) {
            const notifId = 'gnotif_scan_' + appt.id;
            window._fsSetDoc(
                window._fsDoc(window._fbDb, 'garageInbox', notifId),
                {
                    id: notifId,
                    garageNameRaw:  garageName,
                    garageNameNorm: norm,
                    appointmentId:  appt.id,
                    ownerName:      appt.ownerName  || 'Vehicle Owner',
                    ownerEmail:     appt.ownerEmail || '',
                    vehicle:        appt.vehicle    || '—',
                    service:        appt.service    || '—',
                    date:           appt.date       || '—',
                    time:           appt.time       || '—',
                    notes:          appt.notes      || '',
                    status:         'unread',
                    createdAt:      appt.created    || new Date().toLocaleDateString(),
                    timestamp:      appt.timestamp  || Date.now(),
                    scannedOnLogin: true,
                }
            ).catch(e => console.warn('[Scan] inbox write:', e));
        }

    } catch(e) {
        console.error('[scanAndNotify] failed:', e);
    }
}
// Tracks last seen appointment IDs to avoid duplicate popups during session
let _lastSeenApptIds = new Set();

function _checkForNewPendingAppointments(allAppointments) {
    const garageName = document.getElementById('garageName')?.value?.trim() || '';
    if (!garageName) return;

    const norm = garageName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mine = allAppointments.filter(a => {
        const apptNorm = (a.garage || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return fuzzyMatch(a.garage || '', garageName) ||
               apptNorm.includes(norm) || norm.includes(apptNorm);
    });

    mine.forEach(appt => {
        if (!_lastSeenApptIds.has(appt.id) && appt.status === 'pending') {
            _lastSeenApptIds.add(appt.id);
            // Only toast if we've already initialised (not first load)
            if (_lastSeenApptIds.size > 1) {
                toast(`🔔 New booking from ${appt.ownerName || 'a customer'} — ${appt.service}`, 'success');
            }
        } else {
            _lastSeenApptIds.add(appt.id); // mark as seen silently on first load
        }
    });
}

// Shows a sticky alert banner inside the garage portal when old bookings are found
function showGarageWelcomeAlert(garageName, count, appointments) {
    // Remove any existing alert
    const existing = document.getElementById('garageWelcomeBanner');
    if (existing) existing.remove();

    const container = document.querySelector('#sec-garageProfile .portal-content');
    if (!container) return;

    const names = [...new Set(appointments.map(a => a.ownerName).filter(Boolean))].slice(0, 3);
    const nameList = names.join(', ') + (appointments.length > 3 ? ` +${appointments.length - 3} more` : '');

    const banner = document.createElement('div');
    banner.id = 'garageWelcomeBanner';
    banner.style.cssText = `
        background: rgba(74,222,128,0.08);
        border: 1px solid rgba(74,222,128,0.35);
        border-radius: 14px;
        padding: 18px 22px;
        margin-bottom: 20px;
        position: relative;
        animation: fadeSlideIn 0.4s ease;
    `;

    // Add animation keyframe once
    if (!document.getElementById('bannerAnimStyle')) {
        const s = document.createElement('style');
        s.id = 'bannerAnimStyle';
        s.innerHTML = `@keyframes fadeSlideIn {
            from { opacity:0; transform:translateY(-10px); }
            to   { opacity:1; transform:translateY(0); }
        }`;
        document.head.appendChild(s);
    }

    banner.innerHTML = `
        <button onclick="this.parentElement.remove()"
            style="position:absolute;top:10px;right:14px;background:transparent;border:none;
                   color:rgba(74,222,128,0.6);font-size:1.1rem;cursor:pointer;line-height:1;">✕</button>
        <div style="display:flex;align-items:flex-start;gap:14px;">
            <div style="font-size:1.6rem;flex-shrink:0;">🔔</div>
            <div>
                <div style="font-weight:800;color:#4ade80;font-size:1rem;margin-bottom:4px;">
                    ${count} pending appointment${count !== 1 ? 's' : ''} waiting for you!
                </div>
                <div style="font-size:0.82rem;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-bottom:12px;">
                    Booked for <strong style="color:var(--t);">${garageName}</strong> — from: ${nameList}
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button onclick="portalGoTo('appointments')"
                        style="padding:8px 18px;background:rgba(74,222,128,0.15);color:#4ade80;
                               border:1px solid rgba(74,222,128,0.4);border-radius:8px;
                               font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;font-size:0.82rem;">
                        📅 View Appointments
                    </button>
                    <button onclick="portalGoTo('inbox')"
                        style="padding:8px 18px;background:rgba(200,216,228,0.08);color:var(--c);
                               border:1px solid rgba(200,216,228,0.2);border-radius:8px;
                               font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;font-size:0.82rem;">
                        📬 Open Inbox
                    </button>
                    <button onclick="this.closest('#garageWelcomeBanner').remove()"
                        style="padding:8px 18px;background:transparent;color:var(--tm);
                               border:1px solid var(--border);border-radius:8px;
                               font-weight:600;cursor:pointer;font-family:'Syne',sans-serif;font-size:0.82rem;">
                        Dismiss
                    </button>
                </div>
            </div>
        </div>`;

    // Insert at the very top of the profile content
    container.insertBefore(banner, container.firstChild);

    // Also show a toast
    toast(`🔔 ${count} booking${count !== 1 ? 's' : ''} found for ${garageName}`, 'success');
}
