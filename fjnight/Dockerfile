# FJU Night — A Noite da Herança
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY frontend ./frontend
COPY models ./models
COPY config ./config
RUN python -m models.download_models
EXPOSE 8000
# O IP real do visitante é obtido pelo TRUSTED_PROXY_HOPS/CLIENT_IP_HEADER (ver README);
# nunca use --forwarded-allow-ips '*', que aceitaria IPs forjados pelo visitante.
CMD ["sh", "-c", "python -m backend.build && exec uvicorn backend.main:app --host 0.0.0.0 --port 8000"]
