# CS2 bot game control UI (FastAPI + mcrcon; same RCON path as bb_monitor_rcon)
FROM python:3.12-slim

ARG MCRCON_VERSION=0.7.1
ARG MCRCON_URL=https://github.com/Tiiffi/mcrcon/releases/download/v${MCRCON_VERSION}/mcrcon-${MCRCON_VERSION}-linux-x86-64.tar.gz

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL -o /tmp/mcrcon.tgz "${MCRCON_URL}" \
    && tar -xzf /tmp/mcrcon.tgz -C /tmp \
    && mv /tmp/mcrcon-*/mcrcon /usr/local/bin/mcrcon \
    && chmod +x /usr/local/bin/mcrcon \
    && rm -rf /tmp/mcrcon-* /tmp/mcrcon.tgz /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY static/ ./static/
RUN chmod -R a+rX /app/static

ENV RCON_HOST=bb_cs2_server RCON_PORT=27015 MCRCON_BIN=/usr/local/bin/mcrcon
EXPOSE 8765
USER nobody
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
