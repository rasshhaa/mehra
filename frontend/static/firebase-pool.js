/**
 * Dual Firebase project pool — optional Firestore failover when daily quota is hit.
 * See docs/firebase-dual-project-failover.md
 *
 * Browser failover to backup only works if mehrapt2 rules allow access (e.g. test mode)
 * OR users are signed into backup Auth. Otherwise use backend API + local cache.
 * Set window.__FIREBASE_SECONDARY_DEV_OPEN__ = true only with open/test rules on backup.
 */
(function (global) {
    const POOL_KEY = 'autovault:firestorePool:active';
    const POOL_DAY_KEY = 'autovault:firestorePool:day';
    const PRIMARY = 'primary';
    const SECONDARY = 'secondary';

    function todayUtc() {
        return new Date().toISOString().slice(0, 10);
    }

    function isQuotaError(e) {
        const msg = String((e && (e.message || e.code)) || e || '').toLowerCase();
        return (
            msg.includes('quota') ||
            msg.includes('resource-exhausted') ||
            msg.includes('exceeded') ||
            msg.includes('429')
        );
    }

    function isPermissionError(e) {
        const msg = String((e && (e.message || e.code)) || e || '').toLowerCase();
        return msg.includes('permission') || msg.includes('insufficient');
    }

    function clientFailoverAllowed() {
        return global.__FIREBASE_SECONDARY_DEV_OPEN__ === true;
    }

    function readStoredActive() {
        try {
            const day = localStorage.getItem(POOL_DAY_KEY);
            if (day !== todayUtc()) {
                localStorage.setItem(POOL_DAY_KEY, todayUtc());
                localStorage.setItem(POOL_KEY, PRIMARY);
                return PRIMARY;
            }
            const active = localStorage.getItem(POOL_KEY);
            return active === SECONDARY && clientFailoverAllowed() ? SECONDARY : PRIMARY;
        } catch (_) {
            return PRIMARY;
        }
    }

    function persistActive(which) {
        try {
            localStorage.setItem(POOL_DAY_KEY, todayUtc());
            localStorage.setItem(POOL_KEY, which);
        } catch (_) {}
    }

    function initFirebasePool(opts) {
        const {
            primaryDb,
            secondaryDb,
            primaryStorage,
            secondaryStorage,
            sdk,
        } = opts;

        const hasSecondary = !!secondaryDb;
        let active = hasSecondary ? readStoredActive() : PRIMARY;
        if (active === SECONDARY && !hasSecondary) active = PRIMARY;

        function currentDb() {
            return active === SECONDARY && secondaryDb ? secondaryDb : primaryDb;
        }

        function currentStorage() {
            return active === SECONDARY && secondaryStorage ? secondaryStorage : primaryStorage;
        }

        function switchToSecondary() {
            if (!hasSecondary || active === SECONDARY || !clientFailoverAllowed()) {
                global._firestoreQuotaExhausted = true;
                return false;
            }
            active = SECONDARY;
            persistActive(SECONDARY);
            if (typeof global.toast === 'function') {
                global.toast(
                    'Primary Firebase limit reached — using backup database until midnight UTC.',
                    'error',
                );
            }
            console.warn('[Firebase] Switched browser Firestore to backup project (dev open rules).');
            return true;
        }

        function remapRef(ref, db) {
            if (!ref || !ref.path) return ref;
            return sdk.doc(db, ref.path);
        }

        async function withFailover(fn) {
            try {
                return await fn(currentDb());
            } catch (e) {
                if (hasSecondary && active === PRIMARY && isQuotaError(e)) {
                    if (clientFailoverAllowed() && switchToSecondary()) {
                        return await fn(currentDb());
                    }
                    global._firestoreQuotaExhausted = true;
                }
                if (active === SECONDARY && isPermissionError(e)) {
                    console.warn(
                        '[Firebase] Backup permission denied — add service account on server or test-mode rules on mehrapt2.',
                    );
                }
                throw e;
            }
        }

        const pool = {
            getActive: () => active,
            hasSecondary: () => hasSecondary,
            isQuotaError,
            isPermissionError,
            switchToSecondary,
            resetToPrimary: () => {
                active = PRIMARY;
                persistActive(PRIMARY);
                global._firestoreQuotaExhausted = false;
            },
            getDb: currentDb,
            getStorage: currentStorage,
            wrapGetDoc: (ref) => withFailover((db) => sdk.getDoc(remapRef(ref, db))),
            wrapGetDocs: async (queryRef) => {
                try {
                    return await sdk.getDocs(queryRef);
                } catch (e) {
                    if (hasSecondary && active === PRIMARY && isQuotaError(e)) {
                        if (clientFailoverAllowed() && switchToSecondary()) {
                            return await sdk.getDocs(queryRef);
                        }
                        global._firestoreQuotaExhausted = true;
                    }
                    throw e;
                }
            },
            wrapSetDoc: (ref, data, options) =>
                withFailover((db) => sdk.setDoc(remapRef(ref, db), data, options)),
            wrapUpdateDoc: (ref, data) => withFailover((db) => sdk.updateDoc(remapRef(ref, db), data)),
            wrapAddDoc: (collRef, data) => {
                const path = collRef?.path;
                return withFailover((db) => {
                    const coll = path && sdk.collection ? sdk.collection(db, path) : collRef;
                    return sdk.addDoc(coll, data);
                });
            },
            wrapDeleteDoc: (ref) => withFailover((db) => sdk.deleteDoc(remapRef(ref, db))),
        };

        global.__firebasePool = pool;
        return pool;
    }

    global.initFirebasePool = initFirebasePool;
    global.isFirestoreQuotaError = isQuotaError;
})(typeof window !== 'undefined' ? window : globalThis);
