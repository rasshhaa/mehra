// ═══════════════════════════════════════════════════════════
// MARKETPLACE
// ═══════════════════════════════════════════════════════════
let _allMarketplaceListings = [];

async function renderMarketplace() {
    const uid = window._currentUser?.uid;
    if (!uid) return;

    // Load vehicle info from mulkiya
    try {
        const snap = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya'));
        const mpVehicle = document.getElementById('mpVehicleDisplay');
        if (snap.exists() && mpVehicle) {
            const d = snap.data();
            const parts = [d.make, d.bodyType, d.year, d.color].filter(v => v && v !== '—');
            const plate = d.plateNumber && d.plateNumber !== '—' ? ' · Plate: ' + d.plateNumber : '';
            const vin   = d.vin && d.vin !== '—' ? ' · VIN: ' + d.vin : '';
            mpVehicle.innerHTML = '<strong style="color:var(--t)">' + (parts.join(' ') || 'Vehicle') + '</strong>' + plate + vin;
            mpVehicle.style.color = 'var(--t)';
        }
    } catch(e) {}

    // Load all public marketplace listings
    try {
        const snap = await window._fsGetDocs(window._fsCollection(window._fbDb, 'marketplace'));
        _allMarketplaceListings = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
        renderMarketplaceGrid(_allMarketplaceListings);
    } catch(e) {
        console.warn('[Marketplace] load error:', e);
    }
}
function renderMarketplaceGrid(listings) {
    const grid = document.getElementById('marketplaceGrid');
    if (!grid) return;

    if (!listings.length) {
        grid.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--tm);font-family:\'JetBrains Mono\',monospace;font-size:.85rem;grid-column:1/-1"><div style="font-size:2.5rem;margin-bottom:12px">🛒</div>No verified listings yet — be the first!</div>';
        return;
    }

    grid.innerHTML = listings.map(l => `
        <div class="garage-card" style="position:relative">

            <!-- VERIFIED badge -->
            <div style="position:absolute;top:12px;right:12px;background:rgba(74,222,128,.12);color:#4ade80;font-size:.65rem;font-weight:800;padding:3px 10px;border-radius:20px;border:1px solid rgba(74,222,128,.3)">✓ VERIFIED</div>

            <!-- SOLD badge - appears when status is 'sold' -->
            ${l.status === 'sold' ? `
            <div style="position:absolute;top:12px;left:12px;background:rgba(255,68,68,0.9);color:#fff;font-size:0.68rem;font-weight:800;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,68,68,0.6);box-shadow:0 2px 8px rgba(255,68,68,0.4);">
                SOLD
            </div>` : ''}

            <div class="gc-name">${l.vehicle || 'Vehicle'}</div>
            
            <div class="gc-address" style="margin-bottom:6px">
                Health Score: <strong style="color:${typeof l.healthScore === 'number' ? (l.healthScore >= 75 ? '#4ade80' : l.healthScore >= 50 ? '#f59e0b' : '#ff4444') : 'var(--c)'}">
                    ${l.healthScore || '—'}${typeof l.healthScore === 'number' ? '/100' : ''}
                </strong>
            </div>

            <div class="gc-meta" style="margin-bottom:12px">
                <span style="font-size:.78rem;color:var(--t);font-weight:700">
                    AED ${l.price ? Number(l.price).toLocaleString() : '—'}
                </span>
                ${l.contact ? `<span style="font-size:.72rem;color:var(--tm);font-family:'JetBrains Mono',monospace"> • ${l.contact}</span>` : ''}
            </div>

            ${l.notes ? `<div style="font-size:.78rem;color:var(--td);margin-bottom:12px;font-style:italic">${l.notes}</div>` : ''}

            <div style="font-size:.7rem;color:var(--tm);font-family:'JetBrains Mono',monospace">
                Listed ${l.createdAt || '—'}
            </div>

            <!-- Owner controls: Mark as Sold + Delete -->
            ${l.uid === window._currentUser?.uid && l.status !== 'sold' ? `
            <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;display:flex;gap:8px;">
                <button onclick="markListingAsSold('${l.id}')" 
                        style="flex:1;padding:8px;background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.3);border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">
                    ✅ Mark as Sold
                </button>
                <button onclick="removeMarketplaceListing('${l.id}')" 
                        style="padding:8px 12px;background:rgba(255,68,68,0.08);color:#ff6666;border:1px solid rgba(255,68,68,0.25);border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;">
                    🗑
                </button>
            </div>` : ''}

        </div>
    `).join('');
}
function filterMarketplace(query) {
    if (!query.trim()) { renderMarketplaceGrid(_allMarketplaceListings); return; }
    const q = query.toLowerCase();
    const filtered = _allMarketplaceListings.filter(l => (l.vehicle || '').toLowerCase().includes(q) || (l.notes || '').toLowerCase().includes(q));
    renderMarketplaceGrid(filtered);
}
async function calculateVehicleHealthScore(uid) {
    try {
        const iSnap = await window._fsGetDocs(
            window._fsQuery(
                window._fsCollection(window._fbDb, 'users', uid, 'inspections'),
                window._fsOrderBy('timestamp', 'desc')
            )
        );
        if (iSnap.empty) return null;

        const records = iSnap.docs.map(d => d.data())
            .filter(r => !r.role || r.role === 'owner');

        if (!records.length) return null;

        const total      = records.length;
        const passed     = records.filter(r => r.status === 'pass').length;
        const defects    = records.reduce((s, r) => s + (r.defects || 0), 0);
        const knockCount = records.filter(r => r.engineKnock === true).length;

        // Use score from latest if available
        const latest = records[0];
        if (latest.score) return latest.score;

        // Calculate if not stored
        const score = Math.max(0, Math.min(100,
            Math.round(100 - (defects * 5) - (knockCount * 15) - ((total - passed) * 8))
        ));
        return score;
    } catch(e) {
        console.warn('[Health Score]', e);
        return null;
    }
}

async function publishMarketplaceListing() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Please log in first', 'error');

    const price   = document.getElementById('mpPrice').value;
    const contact = document.getElementById('mpContact').value.trim();
    const notes   = document.getElementById('mpNotes').value.trim();

    if (!price) return toast('Please enter an asking price', 'error');

    // Get vehicle details from mulkiya
    let vehicle = 'Vehicle';
    let healthScore = null;
    try {
        const snap = await window._fsGetDoc(window._fsDoc(window._fbDb, 'users', uid, 'profile', 'mulkiya'));
        if (snap.exists()) {
            const d = snap.data();
            vehicle = [d.make, d.bodyType, d.year].filter(v => v && v !== '—').join(' ') || 'Vehicle';
        }
        // Get health score from latest inspection
       // Get health score from latest inspection
let inspectionCount = 0;
try {
    const hSnap = await window._fsGetDocs(
        window._fsQuery(
            window._fsCollection(window._fbDb, 'users', uid, 'inspections'),
            window._fsOrderBy('timestamp', 'desc')
        )
    );
    inspectionCount = hSnap.size;
    if (!hSnap.empty) {
        const latest = hSnap.docs[0].data();
        healthScore = latest.score || null;
    }
} catch(e) { console.warn('[Marketplace] inspection fetch failed:', e); }
    } catch(e) {}

    const listing = {
        uid, vehicle, price, contact, notes,
        healthScore,
        carLifeUrl: window._carLifeUrl || null,
inspectionCount,
        createdAt: new Date().toLocaleDateString(),
        timestamp: Date.now(),
    };

    try {
        await window._fsSetDoc(window._fsDoc(window._fbDb, 'marketplace', uid), listing);
        toast('✓ Verified listing published!', 'success');
        renderMarketplace();
    } catch(e) {
        toast('Failed to publish listing', 'error');
    }
}

    if (!price || Number(price) <= 0) return toast('Please enter a valid asking price', 'error');

    const btn = document.querySelector('[onclick="publishMarketplaceListing()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Publishing...'; }

    try {
        // Get vehicle info
        let vehicle = 'Vehicle';
        let plateNumber = '—';
        let vin = '—';

        const activeV = window._activeVehicle;
        if (activeV) {
            vehicle = [activeV.make, activeV.bodyType, activeV.year]
                .filter(v => v && v !== '—').join(' ') || vehicle;
            plateNumber = activeV.plateNumber || '—';
            vin = activeV.vin || '—';
        } else {
            try {
                const vSnap = await window._fsGetDocs(
                    window._fsCollection(window._fbDb, 'users', uid, 'vehicles')
                );
                if (!vSnap.empty) {
                    const v = vSnap.docs[0].data();
                    vehicle = [v.make, v.bodyType, v.year]
                        .filter(x => x && x !== '—').join(' ') || vehicle;
                    plateNumber = v.plateNumber || '—';
                    vin = v.vin || '—';
                }
            } catch(e) {}
        }

        // Calculate health score
        const healthScore = await calculateVehicleHealthScore(uid);

        // Get inspection count
        let inspectionCount = 0;
        try {
            const iSnap = await window._fsGetDocs(
                window._fsCollection(window._fbDb, 'users', uid, 'inspections')
            );
            inspectionCount = iSnap.docs
                .filter(d => !d.data().role || d.data().role === 'owner').length;
        } catch(e) {}

        // Check for existing listing and update instead of duplicate
        const existingSnap = await window._fsGetDocs(
            window._fsCollection(window._fbDb, 'marketplace')
        );
        const myExisting = existingSnap.docs
            .find(d => d.data().uid === uid && d.data().status !== 'sold');

        const listing = {
            uid,
            vehicle,
            plateNumber,
            vin,
            price:          Number(price),
            contact,
            notes,
            healthScore,
            inspectionCount,
            carLifeUrl:     window._carLifeUrl || null,
            status:         'active',
            createdAt:      myExisting
                ? myExisting.data().createdAt
                : new Date().toLocaleDateString(),
            updatedAt:      new Date().toLocaleDateString(),
            timestamp:      Date.now(),
        };

        if (myExisting) {
            // Update existing listing
            await window._fsUpdateDoc(
                window._fsDoc(window._fbDb, 'marketplace', myExisting.id),
                listing
            );
            toast('✓ Verified listing updated!', 'success');
        } else {
            // Create new listing
            const listingId = 'listing_' + uid + '_' + Date.now();
            await window._fsSetDoc(
                window._fsDoc(window._fbDb, 'marketplace', listingId),
                listing
            );
            toast('✓ Verified listing published!', 'success');
        }

        // Show health score feedback
        if (healthScore !== null) {
            const label = healthScore >= 85 ? 'Excellent' :
                          healthScore >= 70 ? 'Good' :
                          healthScore >= 50 ? 'Fair' : 'Poor';
            toast(`Vehicle health score: ${healthScore}/100 — ${label}`, 'info');
        } else {
            toast('No AI inspections found — run an inspection to get a health score', 'info');
        }

        renderMarketplace();

    } catch(e) {
        console.error('[Marketplace Publish]', e);
        toast('Failed to publish listing: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Publish Verified Listing'; }
    }
}
function generateMarketplaceReport() {
    if (window._carLifeUrl) {
        const a = document.createElement('a');
        a.href = window._carLifeUrl;
        a.download = 'MEHRA_Verified_Vehicle_Report.html';
        a.click();
        toast('Buyer report downloaded', 'success');
    } else {
        toast('Generate your Car Life Report first (Car Life Report section)', 'info');
    }
}

async function markListingAsSold(listingId) {
    try {
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'marketplace', listingId),
            { status: 'sold', soldAt: new Date().toLocaleDateString() }
        );
        toast('✓ Listing marked as sold', 'success');
        renderMarketplace();
    } catch(e) { toast('Failed to update listing', 'error'); }
}

async function removeMarketplaceListing(listingId) {
    if (!confirm('Remove this listing from the marketplace?')) return;
    try {
        await window._fsDeleteDoc(window._fsDoc(window._fbDb, 'marketplace', listingId));
        toast('Listing removed', 'info');
        renderMarketplace();
    } catch(e) { toast('Failed to remove listing', 'error'); }
}
