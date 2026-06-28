# Full-stack AutoVault — engine audio, inspection, PDFs (Render / Railway / Fly)
FROM python:3.11-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch keeps image smaller and fits Render Standard (2 GB RAM)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY backend/requirements.txt /tmp/requirements.txt
RUN grep -v '^torch' /tmp/requirements.txt > /tmp/requirements-no-torch.txt \
    && pip install --no-cache-dir -r /tmp/requirements-no-torch.txt

COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV HF_HOME=/app/backend/.cache/huggingface
RUN mkdir -p /app/backend/.cache/huggingface /app/backend/uploads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
