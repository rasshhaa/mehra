        // ─── Portal navigation ────────────────────────────────────────────────────────
        // FIX: Don't call startNewInspection() on every portalGoTo('inspection') — only
        // navigate there. User must manually click "New Inspection" to reset state.
     function portalGoTo(section) {
    document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('sec-' + section);
    if (el) el.classList.add('active');

    document.querySelectorAll('.snav-item').forEach(i => i.classList.remove('active'));
    const map = {
        profile: 'snav-profile',
        inspection: 'snav-inspection',
        portalHistory: 'snav-history',
        bookGarage: 'snav-bookgarage',
        carLife: 'snav-carlife',
        garageProfile: 'snav-garageProfile',
        serviceInspection: 'snav-serviceInspection',
        myInspections: 'snav-myInspections',
        appointments: 'snav-appointments',
        insProfile: 'snav-insProfile',
insClaims:  'snav-insClaims',
        insPolicyHolders: 'snav-insPolicyHolders',
insHistory: 'snav-insHistory',
        renewal: 'snav-renewal',
        marketplace: 'snav-marketplace',
        rtaDashboard: 'snav-rtaDashboard',
        rtaFines: 'snav-rtaFines',
        rtaRegistrations: 'snav-rtaRegistrations',
        rtaFleet: 'snav-rtaFleet',
        rtaAnalytics: 'snav-rtaAnalytics',
        tasjeelDashboard: 'snav-tasjeelDashboard',
        tasjeelSlots: 'snav-tasjeelSlots',
        tasjeelResults: 'snav-tasjeelResults',
        tasjeelQueue: 'snav-tasjeelQueue',
        mktDashboard: 'snav-mktDashboard',
        mktListings: 'snav-mktListings',
        mktVerification: 'snav-mktVerification',
        mktAnalytics: 'snav-mktAnalytics',
    };

    const navId = map[section];
    if (navId) {
        const navEl = document.getElementById(navId);
        if (navEl) navEl.classList.add('active');
    }

    closeSidebar();
    window.scrollTo(0, 0);

    // Section-specific init
    if (section === 'appointments') renderGarageAppointments();
    if (section === 'bookGarage') populateGarageCards();
    if (section === 'inbox') renderInbox();
if (section === 'bookGarage') {
    populateGarageCards(); // shows fallback + MEHRA verified immediately
    // Also update the count label
    getMehraRegisteredGarages().then(garages => {
        const countEl = document.getElementById('garageCountLabel');
        if (countEl && garages.length) {
            countEl.textContent = `${garages.length} MEHRA verified garage${garages.length !== 1 ? 's' : ''} · Enable location for nearby garages`;
        }
    }).catch(() => {});
}    if (section === 'inbox') renderInbox();
    if (section === 'insClaims')  renderInsClaims();
if (section === 'insHistory') renderInsHistory();
if (section === 'insPolicyHolders') renderInsPolicyHolders();

    if (section === 'profile') {
        checkAndLoadSavedProfile();
    }
    if (section === 'inspection') {
        loadMulkiyaData();
    }
    if (section === 'renewal') {
        renderRenewalStatus();
        const _uid = window._currentUser?.uid;
        if (_uid) { renderRenewalHistory(_uid); checkRenewalSelfReportEligibility(_uid); }
    }
    if (section === 'marketplace') {
        renderMarketplace();
    }
    if (section === 'rtaDashboard') renderRtaDashboard();
    if (section === 'rtaFines') renderRtaFines();
    if (section === 'rtaRegistrations') renderRtaRegistrations();
    if (section === 'rtaFleet') renderRtaFleet();
    if (section === 'rtaAnalytics') renderRtaAnalytics();
    if (section === 'tasjeelDashboard') renderTasjeelDashboard();
    if (section === 'tasjeelSlots') renderTasjeelSlots();
    if (section === 'tasjeelResults') renderTasjeelResults();
    if (section === 'tasjeelQueue') renderTasjeelQueue();
    if (section === 'mktDashboard') renderMktDashboard();
    if (section === 'mktListings') renderMktListings();
    if (section === 'mktVerification') renderMktVerification();
    if (section === 'mktAnalytics') renderMktAnalytics();

    // ==================== FIX 4 — Garage Profile Auto-populate + Warning Banner ====================
    if (section === 'garageProfile') {
        const uid = window._currentUser?.uid;
        if (!uid) return;

        window._fsGetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'garage'))
            .then(snap => {
                if (!snap.exists()) {
                    // Pull from meta signup data as fallback
                    return window._fsGetDoc(
                        window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta')
                    );
                }
                return snap;
            }).then(snap => {
                if (snap && snap.exists()) {
                    const d = snap.data().garage || snap.data();

                    // Auto-populate form fields
                    if (d.name) {
                        document.getElementById('garageName').value    = d.name    || '';
                        document.getElementById('garageCity').value    = d.city    || '';
                        document.getElementById('garageLicense').value = d.license || '';
                        document.getElementById('garagePhone').value   = d.phone   || '';
                        document.getElementById('garageAddress').value = d.address || '';
                    }
                }
            })
            .catch(err => console.warn('[Garage Profile] load error:', err));

        // Show warning banner if garage name doesn't match any existing bookings
        setTimeout(async () => {
            const nameField = document.getElementById('garageName');
            if (!nameField) return;

            const currentName = (nameField.value || '').trim();
            if (!currentName) return;

            try {
                const allAppts = await getAllAppointments();
                const hasMatchingBooking = allAppts.some(appt => 
                    fuzzyMatch(appt.garage || '', currentName)
                );

                // Remove any existing banner first
                const existingBanner = document.getElementById('garageNameWarningBanner');
                if (existingBanner) existingBanner.remove();

                if (!hasMatchingBooking) {
                    const bannerHTML = `
                    <div id="garageNameWarningBanner" style="margin:16px 0 20px;padding:14px 18px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);border-radius:12px;color:#fbbf24;font-size:0.85rem;">
                        ⚠️ <strong>Warning:</strong> No bookings currently match your garage name "<strong>${currentName}</strong>". 
                        Make sure this name exactly (or very closely) matches what vehicle owners see when booking.
                    </div>`;

                    const profileCard = document.querySelector('#sec-garageProfile .profile-card');
                    if (profileCard) {
                        profileCard.insertAdjacentHTML('afterbegin', bannerHTML);
                    }
                }
            } catch (e) {
                console.warn('[Garage Warning] failed:', e);
            }
        }, 800); // Small delay so form is populated first
    }
}
        // ─── Page routing ─────────────────────────────────────────────────────────────
    function goTo(page) {
    // Stop any active camera streams
    if (typeof lcStopStreamOnly === 'function') lcStopStreamOnly();

    // Hide portal
    const portal = document.getElementById('rolePortal');
    if (portal) portal.classList.remove('active');

    // Hide live camera page
    const liveCamera = document.getElementById('live-camera');
    if (liveCamera) liveCamera.classList.remove('active');

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // Show public nav
    document.getElementById('publicNav').style.display = '';

    // Show target page
    const target = document.getElementById(page);
    if (target) {
        target.classList.add('active');
    } else {
        // Fallback to landing
        document.getElementById('landing').classList.add('active');
    }

    // Close sidebar if open
    closeSidebar();
    window.scrollTo(0, 0);
}

        function goToLiveCamera() {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById('live-camera').classList.add('active');
            document.getElementById('rolePortal').classList.remove('active');
            document.getElementById('publicNav').style.display = '';
            lcRefreshCameras();
            document.getElementById('mscLive').classList.add('active');
            document.getElementById('mscUpload').classList.remove('active');
        }

        function returnFromLiveCamera() {
            lcStopStreamOnly();
            document.getElementById('live-camera').classList.remove('active');
            document.getElementById('publicNav').style.display = 'none';
            document.getElementById('rolePortal').classList.add('active');
            // FIX: just show the inspection section without resetting step
            document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
            document.getElementById('sec-inspection').classList.add('active');
            setStep(2);
        }

        // ─── Sidebar ──────────────────────────────────────────────────────────────────
        function toggleSidebar() {
            document.getElementById('mainSidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('active');
        }
        function closeSidebar() {
            document.getElementById('mainSidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('active');
        }

