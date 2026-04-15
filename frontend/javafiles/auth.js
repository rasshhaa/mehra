        // ─── Auth ────────────────────────────────────────────────────────────────────
window._handleAuthChange = async function (user) {
    if (user) {
        let savedRole = _pendingRole;
        if (!savedRole) {
            try {
                const snap = await window._fsGetDoc(
                    window._fsDoc(window._fbDb, 'users', user.uid, 'profile', 'meta')
                );
                savedRole = snap.exists() ? (snap.data().role || 'owner') : 'owner';
            } catch(e) {
                savedRole = 'owner';
            }
        }
        _pendingRole = null;
        _currentRole = savedRole;

        // Ensure role is persisted

        // Full DOM reset
        document.getElementById('rolePortal').classList.remove('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.snav-item').forEach(i => i.classList.remove('active'));
       document.getElementById('ownerNav').style.display      = 'none';
        document.getElementById('garageNav').style.display     = 'none';
        document.getElementById('insuranceNav').style.display  = 'none';
      document.getElementById('ownerNav').style.display       = 'none';
document.getElementById('garageNav').style.display      = 'none';
document.getElementById('insuranceNav').style.display   = 'none';
document.getElementById('rtaNav').style.display         = 'none';
document.getElementById('tasjeelNav').style.display     = 'none';
document.getElementById('marketplaceNav').style.display = 'none';

        const ni = document.getElementById('navUserInfo');
        if (ni) {
            document.getElementById('navUserEmail').textContent = user.email;
            ni.style.display = 'flex';
        }
        const nb = document.getElementById('navAuthBtn');
        if (nb) nb.style.display = 'none';

        setTimeout(() => showPortal(user, savedRole), 0);

    } else {
        _pendingRole = null;
        _currentRole = 'owner';
        hidePortal();
        const ni = document.getElementById('navUserInfo');
        if (ni) ni.style.display = 'none';
        const nb = document.getElementById('navAuthBtn');
        if (nb) nb.style.display = 'inline-block';
    }
};

    async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const pw    = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    const btn   = document.getElementById('authSubmitBtn');
    errEl.classList.remove('show');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';
    try {
        if (!window._fbAuth) throw new Error('Firebase not initialised.');
        const db = window._fbDb;

      if (authMode === 'signup') {
            const role = document.getElementById('roleSelect').value;
            const cred = await window._fbCreateUser(window._fbAuth, email, pw);
            const uid  = cred.user.uid;
            _pendingRole = role;

            if (role === 'garage') {
                await window._fsSetDoc(window._fsDoc(db, 'users', uid, 'profile', 'meta'), {
                    role,
                    email,
                    createdAt: new Date().toISOString(),
                    garage: {
                        name:    document.getElementById('authGarageName').value.trim(),
                        city:    document.getElementById('authGarageCity').value.trim(),
                        license: document.getElementById('authGarageLicense').value.trim(),
                        address: '', phone: ''
                    }
                });
            } else if (role === 'owner') {
                await window._fsSetDoc(window._fsDoc(db, 'users', uid, 'profile', 'meta'), {
                    role,
                    email,
                    createdAt: new Date().toISOString(),
                    owner: {
                        firstName: document.getElementById('authFirstName').value.trim(),
                        lastName:  document.getElementById('authLastName').value.trim(),
                        phone: ''
                    }
                });
            } else if (role === 'insurance') {
                await window._fsSetDoc(window._fsDoc(db, 'users', uid, 'profile', 'meta'), {
                    role,
                    email,
                    createdAt: new Date().toISOString(),
                    role, email, createdAt: new Date().toISOString(),
                    insurance: {
                        name:    document.getElementById('authInsuranceName').value.trim(),
                        license: document.getElementById('authInsuranceLicense').value.trim(),
                        city:    document.getElementById('authInsuranceCity').value.trim(),
                    }
                });
            } else if (role === 'rta') {
                await window._fsSetDoc(window._fsDoc(db, 'users', uid, 'profile', 'meta'), {
                    role, email, createdAt: new Date().toISOString(),
                    rta: {
                        name:  document.getElementById('authRtaName').value.trim(),
                        dept:  document.getElementById('authRtaDept').value.trim(),
                        badge: document.getElementById('authRtaBadge').value.trim(),
                    }
                });
            } else if (role === 'tasjeel') {
                await window._fsSetDoc(window._fsDoc(db, 'users', uid, 'profile', 'meta'), {
                    role, email, createdAt: new Date().toISOString(),
                    tasjeel: {
                        name:     document.getElementById('authTasjeelName').value.trim(),
                        location: document.getElementById('authTasjeelLocation').value.trim(),
                        license:  document.getElementById('authTasjeelLicense').value.trim(),
                    }
                });
            } else if (role === 'marketplace') {
                await window._fsSetDoc(window._fsDoc(db, 'users', uid, 'profile', 'meta'), {
                    role, email, createdAt: new Date().toISOString(),
                    mkt: {
                        name:    document.getElementById('authMktName').value.trim(),
                        contact: document.getElementById('authMktContact').value.trim(),
                        license: document.getElementById('authMktLicense').value.trim(),
                    }
                });
            }
            toast('✓ Account created!', 'success');

        } else {
            const cred = await window._fbSignIn(window._fbAuth, email, pw);
            const uid  = cred.user.uid;
            const snap = await window._fsGetDoc(
                window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta')
            );
            _pendingRole = snap.exists() ? (snap.data().role || 'owner') : 'owner';
            toast('✓ Signed in!', 'success');
        }

    } catch (err) {
        let msg = err.message || 'Authentication failed';
        if (msg.includes('email-already-in-use')) msg = 'Email already in use.';
        else if (msg.includes('invalid-credential') || msg.includes('wrong-password')) msg = 'Invalid email or password.';
        else if (msg.includes('weak-password')) msg = 'Password must be at least 6 characters.';
        errEl.textContent = msg;
        errEl.classList.add('show');
        _pendingRole = null;
    }
    btn.disabled = false;
    btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
}

        function selectAuthRole(role) {
            if (role === 'login') {
                document.getElementById('roleSelect').value = 'owner';
                switchAuthMode('login');
            } else {
                document.getElementById('roleSelect').value = role;
                switchAuthMode('signup');
            }
            document.getElementById('authRoleSelection').style.display = 'none';
            document.getElementById('authFormArea').style.display = 'block';
        }

        function resetAuthRole() {
            document.getElementById('authRoleSelection').style.display = 'block';
            document.getElementById('authFormArea').style.display = 'none';
        }

        function forgotPassword() {
            const email = document.getElementById('authEmail').value.trim();
            if (!email) {
                toast('Please enter your email above first', 'error');
                return;
            }
            toast(`Password reset link sent to ${email}`, 'success');
        }

   async function signOutUser() {
    if (window._fbAuth && window._fbSignOut) {
        stopAppointmentsListener();
        window._ownerVehicles = null;
        window._activeVehicle = null;
        window._step1Vehicles = null;
        window._carLifeUrl = null;
        window._garageProfile = null;   // ← ADD THIS LINE
        _allMarketplaceListings = [];
        _mktAllListings = [];
        await window._fbSignOut(window._fbAuth);
        // ...rest unchanged
        toast('Signed out', 'info');
        hidePortal();
        goTo('landing');
    }
}

        function switchAuthMode(mode) {
    authMode = mode;
    const s = mode === 'signup';

    document.getElementById('loginTab').classList.toggle('active', !s);
    document.getElementById('signupTab').classList.toggle('active', s);

            document.getElementById('nameFields').style.display = s ? 'block' : 'none';
            if (s) {
             document.getElementById('ownerFields').style.display = role === 'owner' ? 'block' : 'none';
                document.getElementById('garageFields').style.display = role === 'garage' ? 'block' : 'none';
                document.getElementById('insuranceFields').style.display = role === 'insurance' ? 'block' : 'none';
                   }
    const role = document.getElementById('roleSelect').value || 'owner';

    // All role-specific field group IDs
    const allRoleFields = [
        'ownerFields', 'garageFields', 'insuranceFields',
        'rtaFields', 'tasjeelFields', 'marketplaceFields'
    ];

    // Show/hide the nameFields wrapper (contains ownerFields, garageFields, insuranceFields)
    document.getElementById('nameFields').style.display = s ? 'block' : 'none';

    if (s) {
        // Hide all role field groups first
        allRoleFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        // Show only the matching one
        const activeFields = document.getElementById(role + 'Fields');
        if (activeFields) activeFields.style.display = 'block';
    }

    document.getElementById('passwordHint').style.display = s ? 'block' : 'none';
    document.getElementById('authOptsRow').style.display = s ? 'none' : 'flex';

    const btn = document.getElementById('authSubmitBtn');
    btn.textContent = s ? 'Create Account' : 'Sign In';
    document.getElementById('authError').classList.remove('show');
}