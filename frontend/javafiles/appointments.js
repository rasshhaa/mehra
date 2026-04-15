function fuzzyMatch(a, b) {
    if (!a || !b) return false;
    a = String(a).toLowerCase().trim();
    b = String(b).toLowerCase().trim();

    if (a === b) return true;

    const normA = a.replace(/[^a-z0-9]/g, '');
    const normB = b.replace(/[^a-z0-9]/g, '');

    if (normA === normB) return true;
    if (normA.includes(normB) || normB.includes(normA)) return true;

    // Word-level matching — if majority of words overlap, it's a match
    const wordsA = a.split(/\s+/).filter(w => w.length > 2);
    const wordsB = b.split(/\s+/).filter(w => w.length > 2);
    if (!wordsA.length || !wordsB.length) return false;
    const shorter = wordsA.length < wordsB.length ? wordsA : wordsB;
    const longer  = wordsA.length < wordsB.length ? wordsB : wordsA;
    const matchCount = shorter.filter(w => longer.some(lw => lw.includes(w) || w.includes(lw))).length;
    return matchCount >= Math.ceil(shorter.length * 0.6);
}
// Real-time appointments listener
// Real-time appointments listener
let appointmentsUnsubscribe = null;
let _lastAppointmentsCallback = null;
let _appointmentsListenerActive = false;

function getAllAppointmentsRealTime(callback) {
    // Store latest callback — only one listener runs at a time
    _lastAppointmentsCallback = callback;

    // If listener already active, just update callback reference
    if (_appointmentsListenerActive) return;

    // Clean up any previous listener
    if (appointmentsUnsubscribe) {
        try { appointmentsUnsubscribe(); } catch(e) {}
        appointmentsUnsubscribe = null;
    }

    if (!window._fbDb || !window._fsCollection || !window._fsOnSnapshot) {
        console.warn('[Appointments] Firestore not ready');
        return;
    }

    _appointmentsListenerActive = true;

    try {
        const col = window._fsCollection(window._fbDb, 'appointments');
        appointmentsUnsubscribe = window._fsOnSnapshot(col, (snapshot) => {
            const all = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Always call the latest callback
            if (_lastAppointmentsCallback) {
                try { _lastAppointmentsCallback(all); } catch(e) {
                    console.warn('[Appointments] callback error:', e);
                }
            }
        }, (error) => {
            console.error('[Appointments] listener error:', error);
            _appointmentsListenerActive = false;
            appointmentsUnsubscribe = null;
            // Retry after 5 seconds
            setTimeout(() => {
                if (_lastAppointmentsCallback) {
                    getAllAppointmentsRealTime(_lastAppointmentsCallback);
                }
            }, 5000);
        });
    } catch(e) {
        console.error('[Appointments] setup failed:', e);
        _appointmentsListenerActive = false;
    }
}

function stopAppointmentsListener() {
    if (appointmentsUnsubscribe) {
        try { appointmentsUnsubscribe(); } catch(e) {}
        appointmentsUnsubscribe = null;
    }
    _appointmentsListenerActive = false;
    _lastAppointmentsCallback = null;
}

// Fallback for old calls
// Fallback one-time fetch - used by renderPortalAppointments, updateBellBadge, renderCarLifeTimeline, etc.
async function getAllAppointments() {
    try {
        const snap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'appointments')
        );
        return snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch(e) {
        console.warn('[Appointments] load failed:', e);
        return [];
    }
}
