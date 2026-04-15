
        const API = 'http://localhost:8000';
        let authMode = 'signup';
        let pdfOption = 'preview';
        let _currentRole = 'owner';
        let _selectedGarageName = '';
        let _selectedGarageAddress = '';
        let _pendingRole = null;
        let _garageServiceType = 'service';
        let _historyCache = [];

        // ─── GLOBAL APPOINTMENT STORE ───────────────────────────────────────────────
        // All appointments stored globally so garage owners can see them.
        // Key: APPT_STORE_KEY → array of appointment objects, each with { garageName, garageAddress, ... }
  

        // ─── Inspection state ────────────────────────────────────────────────────────
        function freshState() {
            return {
                step: 1, mode: 'upload', files: [],
                batchDone: false, batchDefects: [], batchAnnotated: [],
                perImageDefects: [], crossedIndices: new Set(),
                audioFile: null, audioResult: null, reportReady: false,
                liveCameraResult: null, _historySaved: false,
            };
        }
        let state = freshState();
            

