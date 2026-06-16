/**
 * Marketplace chat — moderation UI, inbox, timestamps, read receipts, safety actions.
 */
(function () {
    const SAFETY_BANNER =
        '💡 Safety Tip: Never pay outside AutoVault. Always meet in a public place. Do not share bank details.';
    const MOD_WARN =
        '⚠️ For your safety, do not share personal contact details until you are ready to meet. AutoVault keeps your info protected.';

    window._mpChatSafetyShown = window._mpChatSafetyShown || {};

    function mpThreadKey(listingId, buyerUid) {
        return `${listingId || ''}__${buyerUid || ''}`;
    }

    function mpFormatChatTime(ts) {
        const n = Number(ts) || 0;
        if (!n) return '—';
        const d = new Date(n);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hr ago`;
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' });
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function mpMessageStatusHtml(r, mine) {
        if (!mine) return '';
        const st = String(r.status || '').toLowerCase();
        const read = r.readAt || st === 'read';
        const delivered = r.deliveredAt || read || st === 'delivered';
        if (read) {
            return '<span class="mp-chat-ticks read" title="Read">✓✓</span>';
        }
        if (delivered) {
            return '<span class="mp-chat-ticks delivered" title="Delivered">✓✓</span>';
        }
        return '<span class="mp-chat-ticks sent" title="Sent">✓</span>';
    }

    function mpShowModerationWarning() {
        let el = document.getElementById('mpChatModWarn');
        if (!el) {
            const row = document.querySelector('.mp-chat-popup-inputrow');
            if (!row) return;
            el = document.createElement('div');
            el.id = 'mpChatModWarn';
            el.className = 'mp-chat-mod-warn';
            row.parentNode.insertBefore(el, row);
        }
        el.textContent = MOD_WARN;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 6000);
    }

    function mpActiveListingMeta() {
        const lid = String(window._marketplaceChatListingId || '').trim();
        const listing = (window._allMarketplaceListings || []).find((x) => String(x.id) === lid);
        if (!listing) {
            return {
                vehicle: window._marketplaceChatVehicleLabel || 'Listing',
                price: null,
                thumbnail: null,
            };
        }
        const photos = window.mpListingPhotoUrls ? window.mpListingPhotoUrls(listing) : (listing.photoUrls || []);
        return {
            vehicle: listing.vehicle || 'Vehicle',
            price: listing.price,
            thumbnail: photos[0] || null,
        };
    }

    function mpUpdateChatHeader() {
        const meta = mpActiveListingMeta();
        const title = document.getElementById('mpChatPopupListingLabel');
        const sub = document.getElementById('mpChatPopupListingSub');
        const thumb = document.getElementById('mpChatHeaderThumb');
        if (title) title.textContent = meta.vehicle;
        if (sub) {
            sub.textContent = meta.price != null
                ? `AED ${Number(meta.price).toLocaleString()}`
                : (window._marketplaceChatVehicleLabel || '');
        }
        if (thumb) {
            if (meta.thumbnail) {
                thumb.innerHTML = `<img src="${String(meta.thumbnail).replace(/"/g, '&quot;')}" alt="">`;
                thumb.style.display = 'flex';
            } else {
                thumb.innerHTML = '🚗';
                thumb.style.display = 'flex';
            }
        }
        const typingEl = document.getElementById('mpChatTyping');
        if (typingEl) typingEl.style.display = 'none';
    }

    const _origRender = window.renderMarketplaceOwnerChatRows;
    window.renderMarketplaceOwnerChatRows = function () {
        const listEl = document.getElementById('mpChatList');
        const uid = window._currentUser?.uid;
        if (!listEl || !uid) return;

        const selected = String(window._marketplaceChatListingId || '').trim();
        const buyerUid = String(window._marketplaceChatBuyerUid || '').trim();
        const rows = (window._marketplaceChatRows || [])
            .filter((r) => !selected || String(r.listingId || '') === selected)
            .filter((r) => !buyerUid || String(r.buyerUid || '') === buyerUid)
            .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));

        mpUpdateChatHeader();

        if (!rows.length) {
            listEl.innerHTML = '<div class="mp-chat-empty">No messages yet.<br><span style="font-size:.72rem">Buyers can message you from Contact Seller or Buy.</span></div>';
            return;
        }

        const threadKey = mpThreadKey(selected, buyerUid || rows[0]?.buyerUid);
        let html = '';
        if (selected && !window._mpChatSafetyShown[threadKey]) {
            window._mpChatSafetyShown[threadKey] = true;
            html += `<div class="mp-chat-safety-banner">${SAFETY_BANNER}</div>`;
        }

        html += rows.map((r) => {
            const mine = String(r.fromUid || '') === String(uid);
            const who = mine ? 'You' : (String(r.fromRole || '').toLowerCase() === 'seller' ? 'Seller' : 'Buyer');
            const ts = mpFormatChatTime(r.ts);
            const body = String(r.body || '').replace(/</g, '&lt;');
            if (!mine && String(r.fromRole || '').toLowerCase() === 'buyer') {
                window._marketplaceChatBuyerUid = String(r.fromUid || r.buyerUid || '');
            }
            return `<div class="mp-chat-bubble-row ${mine ? 'mine' : 'theirs'}">
            <div class="mp-chat-bubble">
                <div class="mp-chat-meta"><span>${who} · ${ts}</span>${mpMessageStatusHtml(r, mine)}</div>
                <div>${body}</div>
            </div>
        </div>`;
        }).join('');

        listEl.innerHTML = html;
        listEl.scrollTop = listEl.scrollHeight;

        if (selected && buyerUid) {
            mpMarkChatRead(selected, buyerUid);
        }
    };

    async function mpMarkChatRead(listingId, buyerUid) {
        try {
            const headers = await getAuthBearerHeader(true);
            if (!headers) return;
            await fetch(`${API}/marketplace/chat/read`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId, buyerUid }),
            });
        } catch (_) {}
    }

    const _origSendMsg = window.sendMarketplaceOwnerChatMessage;
    window.sendMarketplaceOwnerChatMessage = async function (message, listingId, sellerUid, vehicleLabel, buyerUid) {
        const uid = window._currentUser?.uid;
        if (!uid) return;
        const clean = String(message || '').trim();
        if (!clean) return;
        const isSeller = sellerUid && String(sellerUid) === String(uid);
        let targetBuyerUid = buyerUid || window._marketplaceChatBuyerUid || '';
        if (isSeller && !targetBuyerUid) {
            const rows = (window._marketplaceChatRows || []).filter((r) => String(r.listingId || '') === String(listingId || ''));
            const fromBuyer = rows.find((r) => String(r.fromRole || '').toLowerCase() === 'buyer');
            targetBuyerUid = fromBuyer ? String(fromBuyer.fromUid || fromBuyer.buyerUid || '') : '';
        }
        const optId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const optimistic = {
            id: optId,
            listingId: listingId || '',
            vehicle: vehicleLabel || '',
            buyerUid: isSeller ? targetBuyerUid : uid,
            sellerUid: sellerUid || '',
            fromUid: uid,
            fromRole: isSeller ? 'seller' : 'buyer',
            body: clean,
            ts: Date.now(),
            status: 'sent',
            _optimistic: true,
        };
        if (typeof mpAppendOptimisticChatMessage === 'function') {
            mpAppendOptimisticChatMessage(optimistic);
        }
        try {
            const headers = await getAuthBearerHeader(true);
            if (!headers) throw new Error('missing_auth');
            const payload = {
                listingId: listingId || '',
                message: clean,
                sellerUid: sellerUid || '',
                vehicle: vehicleLabel || '',
            };
            if (isSeller && targetBuyerUid) payload.buyerUid = targetBuyerUid;
            const res = await fetch(`${API}/marketplace/chat/send`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                const detail = j.detail;
                if (detail && (detail.code === 'moderation_blocked' || (typeof detail === 'object' && detail.message))) {
                    mpShowModerationWarning();
                    const m = typeof detail === 'string' ? detail : (detail.message || MOD_WARN);
                    if (typeof toast === 'function') toast(m, 'error');
                } else {
                    throw new Error(typeof detail === 'string' ? detail : (detail?.message || 'chat_send_failed'));
                }
                window._marketplaceChatRows = (window._marketplaceChatRows || []).filter((r) => r.id !== optId);
                renderMarketplaceOwnerChatRows();
                return;
            }
            window._marketplaceChatListingId = listingId || '';
            const saved = j.message || {};
            window._marketplaceChatRows = (window._marketplaceChatRows || []).map((r) => (
                r._optimistic && r.id === optId ? { ...saved, listingId: saved.listingId || listingId } : r
            ));
            renderMarketplaceOwnerChatRows();
        } catch (e) {
            window._marketplaceChatRows = (window._marketplaceChatRows || []).filter((r) => r.id !== optId);
            renderMarketplaceOwnerChatRows();
            if (String(e.message || '') !== 'missing_auth') {
                toast('Could not send message', 'error');
            }
        }
    };

    let _mpTypingTimer = null;
    function mpBindTypingInput() {
        const inp = document.getElementById('mpChatInput');
        if (!inp || inp._mpTypingBound) return;
        inp._mpTypingBound = true;
        const ping = async (on) => {
            const lid = String(window._marketplaceChatListingId || '').trim();
            if (!lid) return;
            try {
                const headers = await getAuthBearerHeader(true);
                if (!headers) return;
                await fetch(`${API}/marketplace/chat/typing`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        listingId: lid,
                        buyerUid: window._marketplaceChatBuyerUid || undefined,
                        typing: !!on,
                    }),
                });
            } catch (_) {}
        };
        inp.addEventListener('input', () => {
            ping(true);
            clearTimeout(_mpTypingTimer);
            _mpTypingTimer = setTimeout(() => ping(false), 2000);
        });
    }

    const _origOpen = window.openMarketplaceChatPopup;
    window.openMarketplaceChatPopup = async function (listingId, vehicleLabel, sellerUid, buyerUid) {
        if (buyerUid) window._marketplaceChatBuyerUid = buyerUid;
        await _origOpen(listingId, vehicleLabel, sellerUid);
        mpBindTypingInput();
        mpUpdateChatHeader();
    };

    const _origLoad = window.loadMarketplaceOwnerChats;
    window.loadMarketplaceOwnerChats = async function (opts) {
        await _origLoad(opts);
        const j = window._mpLastChatPayload || {};
        const typingEl = document.getElementById('mpChatTyping');
        const uid = window._currentUser?.uid;
        if (typingEl && j.typingFromUid && j.typingFromUid !== uid) {
            const role = String(window._marketplaceChatSellerUid) === String(j.typingFromUid) ? 'Seller' : 'Buyer';
            typingEl.textContent = `${role} is typing…`;
            typingEl.style.display = 'block';
        } else if (typingEl) {
            typingEl.style.display = 'none';
        }
    };

    (function patchChatLoadPayload() {
        const origFetch = window.fetch;
        if (origFetch._mpChatLoad) return;
        window.fetch = async function (url, opts) {
            const res = await origFetch.apply(this, arguments);
            if (String(url).includes('/marketplace/chat') && !String(url).includes('/inbox') && (!opts?.method || opts.method === 'GET')) {
                try {
                    window._mpLastChatPayload = await res.clone().json();
                } catch (_) {}
            }
            return res;
        };
        window.fetch._mpChatLoad = true;
    })();

    window.mpReportChat = async function () {
        const chatId = mpThreadKey(
            window._marketplaceChatListingId,
            window._marketplaceChatBuyerUid || window._currentUser?.uid
        );
        const reason = window.prompt('Report reason (spam, harassment, scam, other):', 'other') || 'other';
        try {
            const headers = await getAuthBearerHeader(true);
            await fetch(`${API}/marketplace/chat/report`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId,
                    listingId: window._marketplaceChatListingId,
                    buyerUid: window._marketplaceChatBuyerUid,
                    reason,
                }),
            });
            toast('Report submitted — thank you', 'success');
        } catch (_) {
            toast('Could not submit report', 'error');
        }
    };

    window.mpBlockChatUser = async function () {
        const uid = window._currentUser?.uid;
        const seller = window._marketplaceChatSellerUid;
        const buyer = window._marketplaceChatBuyerUid;
        const other = String(uid) === String(seller) ? buyer : seller;
        if (!other) return toast('No user to block', 'error');
        if (!window.confirm('Block this user? They will not be able to message you.')) return;
        try {
            const headers = await getAuthBearerHeader(true);
            await fetch(`${API}/marketplace/chat/block`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ blockedUid: other, listingId: window._marketplaceChatListingId }),
            });
            toast('User blocked', 'success');
            closeMarketplaceChatPopup();
        } catch (_) {
            toast('Could not block user', 'error');
        }
    };

    window.mpToggleChatMenu = function () {
        const m = document.getElementById('mpChatMenu');
        if (m) m.classList.toggle('open');
    };

    window.loadMarketplaceChatInbox = async function () {
        const mount = document.getElementById('mpInboxList');
        if (!mount) return;
        mount.innerHTML = '<div class="mp-inbox-loading">Loading conversations…</div>';
        try {
            const headers = await getAuthBearerHeader(true);
            if (!headers) throw new Error('auth');
            const res = await fetch(`${API}/marketplace/chat/inbox`, { headers });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.detail || 'inbox_failed');
            const threads = Array.isArray(j.threads) ? j.threads : [];
            if (!threads.length) {
                mount.innerHTML = '<div class="mp-inbox-empty">No marketplace chats yet. Contact a seller from a listing to start.</div>';
                return;
            }
            mount.innerHTML = threads.map((t) => {
                const thumb = t.thumbnail
                    ? `<img src="${String(t.thumbnail).replace(/"/g, '&quot;')}" alt="">`
                    : '🚗';
                const price = t.price != null ? `AED ${Number(t.price).toLocaleString()}` : '';
                const unread = Number(t.unread) || 0;
                const escV = String(t.vehicle || 'Vehicle').replace(/'/g, "\\'");
                return `<button type="button" class="mp-inbox-row" onclick="mpOpenInboxThread('${t.listingId}','${escV}','${t.sellerUid}','${t.buyerUid}')">
                    <div class="mp-inbox-thumb">${thumb}</div>
                    <div class="mp-inbox-body">
                        <div class="mp-inbox-top">
                            <strong>${String(t.vehicle || 'Listing').replace(/</g, '')}</strong>
                            <span class="mp-inbox-time">${mpFormatChatTime(t.lastTs)}</span>
                        </div>
                        <div class="mp-inbox-meta">${price}</div>
                        <div class="mp-inbox-preview">${String(t.lastMessage || '').replace(/</g, '')}</div>
                    </div>
                    ${unread ? `<span class="mp-inbox-badge">${unread}</span>` : ''}
                </button>`;
            }).join('');
        } catch (_) {
            mount.innerHTML = '<div class="mp-inbox-empty">Could not load inbox.</div>';
        }
    };

    window.mpOpenInboxThread = function (listingId, vehicle, sellerUid, buyerUid) {
        window._marketplaceChatBuyerUid = buyerUid || '';
        openMarketplaceChatPopup(listingId, vehicle, sellerUid, buyerUid);
        portalGoTo('marketplace');
    };

    window.openMarketplaceChatInbox = function () {
        portalGoTo('chatInbox');
        loadMarketplaceChatInbox();
    };

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('mpChatMenu');
        if (menu && !e.target.closest('.mp-chat-head-actions')) {
            menu.classList.remove('open');
        }
    });
})();
