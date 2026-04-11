# MEHRA — UAE Unified Vehicle Ecosystem

## Project Structure

```
mehra_project/
├── backend/
│   ├── main.py          # FastAPI server (all API endpoints)
│   ├── report.py        # PDF report generation + Groq AI analysis
│   └── uploads/         # Temp image uploads (auto-created)
├── frontend/
│   ├── mehra.html       # Full MEHRA web app (single-file)
│   └── static/          # Annotated images + generated PDFs (auto-created)
├── requirements.txt     # Python dependencies
├── .vscode/
│   ├── launch.json      # VS Code debug config
│   └── settings.json    # VS Code Python settings
└── README.md
```

---

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Python | 3.10 or 3.11 | https://python.org |
| pip | latest | bundled with Python |
| ffmpeg | any recent | https://ffmpeg.org (required for engine audio) |
| VS Code | latest | https://code.visualstudio.com |

### Install ffmpeg (Windows)
1. Download from https://ffmpeg.org/download.html
2. Extract and add `bin/` folder to your system PATH
3. Verify: `ffmpeg -version` in terminal

### Install ffmpeg (macOS)
```bash
brew install ffmpeg
```

### Install ffmpeg (Ubuntu/Debian)
```bash
sudo apt install ffmpeg
```

---

## Setup & Run

### Step 1 — Open in VS Code
```
File → Open Folder → select mehra_project/
```

### Step 2 — Create virtual environment
Open the VS Code terminal (`Ctrl+`` `) and run:

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### Step 3 — Install dependencies
```bash
pip install -r requirements.txt
```

> ⚠️ `torch` and `transformers` are large (~2 GB). The engine audio model downloads
> automatically on first use. If you don't need engine audio analysis, you can
> skip these:
> ```bash
> pip install fastapi uvicorn python-multipart opencv-python reportlab inference-sdk numpy pillow httpx
> ```

### Step 4 — Start the backend server

**Option A — VS Code debugger:**
Press `F5` (or Run → Start Debugging) → select "Run MEHRA Backend"

**Option B — Terminal:**
```bash
cd backend
uvicorn main:app --reload
```

### Step 5 — Open the frontend
Open your browser and go to:
```
http://localhost:8000
```
The MEHRA web app will load automatically.

Alternatively, open `frontend/mehra.html` directly in your browser —
but API calls (inspection, report generation) require the backend to be running.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serve mehra.html |
| `POST` | `/inspect` | Upload images → Roboflow detection → annotated results |
| `POST` | `/analyze-engine` | Upload audio → AST model → knock detection |
| `POST` | `/generate-report` | Generate PDF with Groq AI analysis |
| `POST` | `/detect-live` | Single frame live camera detection |
| `POST` | `/finalize-live-detection` | Finalize live session + generate report |
| `POST` | `/reset-live-detection` | Clear live session state |
| `POST` | `/ai-analysis` | Standalone Groq AI analysis (no PDF) |
| `GET` | `/report` | Download/preview the latest generated PDF |
| `GET` | `/get-captured-images` | List captured live frames |

Interactive API docs: http://localhost:8000/docs

---

## Configuration

All keys are in `backend/report.py` and `backend/main.py`:

| Setting | File | Variable |
|---------|------|----------|
| Groq API key | `report.py` | `GROQ_API_KEY` |
| Roboflow API key | `main.py` | `api_key` in `InferenceHTTPClient` |
| Roboflow model ID | `main.py` | `VEHICLE_MODEL_ID` |
| Groq model | `report.py` | `GROQ_MODEL` |

---

## Troubleshooting

**`ModuleNotFoundError: inference_sdk`**
```bash
pip install inference-sdk
```

**Engine audio fails**
- Ensure `ffmpeg` is installed and on PATH
- First run downloads ~1.5 GB model from HuggingFace — needs internet

**CORS errors in browser**
- Make sure backend is running on port 8000
- The frontend HTML calls `http://localhost:8000` — don't change this port

**`cv2` import error on Windows**
```bash
pip install opencv-python-headless
```

**Port already in use**
```bash
# Change port in launch.json or run:
uvicorn main:app --port 8001 --reload
# Then update API const in mehra.html: const API = 'http://localhost:8001'
```
