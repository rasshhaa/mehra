/**
 * Marketplace listing display helpers — vehicle title, plate/VIN, health score UI.
 */
(function (global) {
    'use strict';

    const SMALL_WORDS = new Set(['and', 'or', 'of', 'the', 'in', 'at', 'for', 'to', 'a', 'an']);

    function titleCaseVehicle(text) {
        const raw = String(text || '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        return raw.split(' ').map((word, i) => {
            if (!word) return '';
            if (word.includes('-')) {
                return word.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '')).join('-');
            }
            if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
            return word.length > 1 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toUpperCase();
        }).join(' ');
    }

    function dedupeTokens(tokens) {
        const t = tokens.filter(Boolean);
        if (t.length < 2) return t;
        const upper = t.map((x) => x.toUpperCase());
        for (let n = Math.min(4, Math.floor(t.length / 2)); n > 0; n--) {
            if (upper.slice(0, n).join(' ') === upper.slice(n, 2 * n).join(' ')) {
                return t.slice(n);
            }
        }
        return t;
    }

    function formatListingVehicleDisplay(l) {
        const raw = String((l && l.vehicle) || '').trim();
        if (!raw || raw === '—') return 'Vehicle';
        let work = raw;
        let yearSuffix = '';
        const ym = work.match(/\b((?:19|20)\d{2})\b\s*$/);
        if (ym) {
            yearSuffix = ym[1];
            work = work.slice(0, ym.index).trim();
        }
        const tokens = dedupeTokens(work.split(/[\s\-_/]+/));
        let name = titleCaseVehicle(tokens.join(' '));
        if (yearSuffix) name = `${name} ${yearSuffix}`.trim();
        return name || 'Vehicle';
    }

    function isEmptyPlate(p) {
        const s = String(p || '').trim();
        return !s || s === '—' || s === '-' || s.toLowerCase() === 'not provided';
    }

    function formatListingPlate(l, isMine) {
        const p = l && l.plateNumber;
        if (!isEmptyPlate(p)) return String(p).trim();
        return 'Not Provided';
    }

    function formatListingVin(l, isMine) {
        const v = String((l && l.vin) || '').trim();
        if (!v || v === '—') return '—';
        if (isMine && v.length >= 11 && !v.includes('…')) return v;
        if (v.includes('…') || v.length <= 8) return v;
        if (v.length <= 6) return '***';
        return `${v.slice(0, 4)}…${v.slice(-4)}`;
    }

    function mpHealthBarColor(score) {
        if (score == null || Number.isNaN(score)) return '#57606a';
        if (score > 70) return '#3fb950';
        if (score >= 40) return '#f0883e';
        return '#ff7777';
    }

    function mpListingHealthScore(l) {
        const candidates = [l && l.healthScore, l && l.health_score, l && l.aiHealthScore, l && l.score];
        for (const v of candidates) {
            const n = Number(v);
            if (!Number.isNaN(n) && n >= 0) return Math.max(0, Math.min(100, Math.round(n)));
        }
        return null;
    }

    function defaultHealthBreakdown(score) {
        const s = score != null ? score : 50;
        return [
            { key: 'inspection', label: 'Inspection Results', weight: 40, score: s, contribution: Math.round(s * 40 / 100) },
            { key: 'accident_free', label: 'Accident-Free History', weight: 30, score: s, contribution: Math.round(s * 30 / 100) },
            { key: 'service', label: 'Service Records', weight: 20, score: s, contribution: Math.round(s * 20 / 100) },
            { key: 'age_mileage', label: 'Age & Mileage', weight: 10, score: s, contribution: Math.round(s * 10 / 100) },
        ];
    }

    function ensureHealthModal() {
        let el = document.getElementById('mpHealthScoreModal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'mpHealthScoreModal';
        el.className = 'mp-health-modal';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.innerHTML = `
            <div class="mp-health-modal-backdrop" data-mp-health-close></div>
            <div class="mp-health-modal-panel">
                <button type="button" class="mp-health-modal-close" data-mp-health-close aria-label="Close">&times;</button>
                <h3 class="mp-health-modal-title">Vehicle Health Score</h3>
                <p class="mp-health-modal-formula" id="mpHealthModalFormula"></p>
                <div class="mp-health-modal-total" id="mpHealthModalTotal"></div>
                <div class="mp-health-modal-rows" id="mpHealthModalRows"></div>
            </div>`;
        document.body.appendChild(el);
        el.querySelectorAll('[data-mp-health-close]').forEach((btn) => {
            btn.addEventListener('click', () => el.classList.remove('active'));
        });
        return el;
    }

    function openHealthScoreModal(listing) {
        const l = listing || {};
        const score = mpListingHealthScore(l);
        const breakdown = Array.isArray(l.healthScoreBreakdown) && l.healthScoreBreakdown.length
            ? l.healthScoreBreakdown
            : defaultHealthBreakdown(score);
        const formula = l.healthScoreFormula || 'Inspection 40% + Accident-Free 30% + Service 20% + Age & Mileage 10%';
        const modal = ensureHealthModal();
        const color = mpHealthBarColor(score);
        document.getElementById('mpHealthModalFormula').textContent = formula;
        document.getElementById('mpHealthModalTotal').innerHTML = `
            <span style="color:${color};font-size:1.75rem;font-weight:800">${score != null ? score : '—'}</span>
            <span style="color:#8b949e;font-size:1rem"> / 100</span>`;
        document.getElementById('mpHealthModalRows').innerHTML = breakdown.map((row) => {
            const sc = Number(row.score);
            const w = Number(row.weight) || 0;
            const contrib = row.contribution != null ? row.contribution : Math.round((sc * w) / 100 * 10) / 10;
            const barColor = mpHealthBarColor(sc);
            const pct = Math.max(0, Math.min(100, sc));
            return `<div class="mp-health-breakdown-row">
                <div class="mp-health-breakdown-head">
                    <span>${row.label || row.key}</span>
                    <span style="color:#8b949e">${w}% weight · ${contrib} pts</span>
                </div>
                <div class="mp-health-bar-track"><div class="mp-health-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
                <div style="font-size:.75rem;color:#c9d1d9;margin-top:4px">Component: <strong>${Number.isNaN(sc) ? '—' : sc}/100</strong></div>
            </div>`;
        }).join('');
        modal.classList.add('active');
    }

    function healthScoreBlockHtml(l, listingId) {
        const hs = mpListingHealthScore(l);
        const color = mpHealthBarColor(hs);
        const pct = hs != null ? hs : 0;
        const lid = String(listingId || (l && l.id) || '').replace(/'/g, "\\'");
        const label = hs != null ? `Health: ${hs}/100` : 'Health: —/100';
        return `<button type="button" class="mp-health-score-btn" onclick="openMpHealthScoreModal('${lid}')" title="View health score breakdown">
            <span class="mp-health-score-label">${label}</span>
            <div class="mp-health-bar-track mp-health-bar-track--inline"><div class="mp-health-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        </button>`;
    }

    function openMpHealthScoreModal(listingId) {
        const rows = global._allMarketplaceListings || [];
        const hit = rows.find((x) => String(x.id) === String(listingId));
        if (hit) openHealthScoreModal(hit);
    }

    global.formatListingVehicleDisplay = formatListingVehicleDisplay;
    global.formatListingPlate = formatListingPlate;
    global.formatListingVin = formatListingVin;
    global.mpHealthBarColor = mpHealthBarColor;
    global.mpListingHealthScore = mpListingHealthScore;
    global.healthScoreBlockHtml = healthScoreBlockHtml;
    global.openHealthScoreModal = openHealthScoreModal;
    global.openMpHealthScoreModal = openMpHealthScoreModal;
})(typeof window !== 'undefined' ? window : global);
