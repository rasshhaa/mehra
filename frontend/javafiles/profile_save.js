        // ─── Toast ────────────────────────────────────────────────────────────────────
        let toastTimer;
        function toast(msg, type = 'info') {
            const el = document.getElementById('toast');
            el.textContent = msg; el.className = `show ${type}`;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
        }

        // ─── Profile save ─────────────────────────────────────────────────────────────
        function saveProfile() {
            const uid = window._currentUser?.uid; if (!uid) return toast('Not logged in', 'error');
            const data = {
                firstName: document.getElementById('pFirstName').value,
                lastName: document.getElementById('pLastName').value,
                phone: document.getElementById('pPhone').value,
            };
            localStorage.setItem('profile:' + uid, JSON.stringify(data));
            toast('Profile saved ✓', 'success');
        }

        function saveVehicle() {
            const uid = window._currentUser?.uid; if (!uid) return toast('Not logged in', 'error');
            const data = {
                vin: document.getElementById('pVin').value,
                make: document.getElementById('pMake').value,
                bodyType: document.getElementById('pBodyType').value,
                year: document.getElementById('pYear').value,
                mileage: document.getElementById('pMileage').value,
                color: document.getElementById('pColor').value,
            };
            localStorage.setItem('vehicle:' + uid, JSON.stringify(data));
            if (data.vin) document.getElementById('vin').value = data.vin;
            if (data.make) document.getElementById('make').value = data.make;
            if (data.bodyType) document.getElementById('bodyType').value = data.bodyType;
            if (data.year) document.getElementById('year').value = data.year;
            if (data.mileage) document.getElementById('mileage').value = data.mileage;
            toast('Vehicle saved ✓', 'success');
        }

  async function saveGarageProfile() {
    const uid = window._currentUser?.uid;
    if (!uid) return toast('Not logged in', 'error');

    const data = {
        name:    document.getElementById('garageName').value.trim(),
        phone:   document.getElementById('garagePhone').value.trim(),
        address: document.getElementById('garageAddress').value.trim(),
        city:    document.getElementById('garageCity').value.trim(),
        license: document.getElementById('garageLicense').value.trim(),
    };

    try {
        await window._fsSetDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'garage'),
            data
        );

        // Also update meta
        await window._fsUpdateDoc(
            window._fsDoc(window._fbDb, 'users', uid, 'profile', 'meta'),
            { garage: data }
        );

        toast('Garage profile saved ✓', 'success');

        // FIX 5: Render rich profile card after successful save
        renderGarageProfileCard(data);

        renderGarageAppointments();
        updateBellBadge();
    } catch(e) {
        toast('Failed to save garage profile', 'error');
    }
}
