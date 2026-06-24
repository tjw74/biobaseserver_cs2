# Build demoinfocs-golang summary CLI (CS2 / CS:GO demos).
FROM golang:1.24-bookworm AS go-build
WORKDIR /src
ENV GOTOOLCHAIN=auto
COPY demoinfocs_summary/go.mod demoinfocs_summary/go.sum ./
RUN go mod download
COPY demoinfocs_summary/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/demoinfocs-summary .

# Build React + shadcn UI, then serve with FastAPI (same port 8780).
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Match docker-compose default (BB_DASHBOARD_ROOT_PATH=/admin). Override --build-arg for root-hosted installs.
ARG VITE_DASHBOARD_BASE=/admin/
ENV VITE_DASHBOARD_BASE=$VITE_DASHBOARD_BASE
RUN npm run build

FROM node:22-bookworm-slim AS companion-build
WORKDIR /companion
COPY companion/package.json companion/package-lock.json* ./
RUN npm install
COPY companion/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py client_api.py client_movement_feed.py client_session_store.py demo_field_catalog.py demo_parse_preview.py demo_parser_compare.py demo_movement.py ./
COPY parser_workers ./parser_workers
COPY render_workers ./render_workers
RUN chmod 755 /app/render_workers/*.sh
COPY --from=go-build /out/demoinfocs-summary /usr/local/bin/demoinfocs-summary
RUN chmod 755 /usr/local/bin/demoinfocs-summary
COPY --from=frontend-build /fe/dist ./static
COPY --from=companion-build /companion/dist ./static_companion
RUN mkdir -p /data/clips \
    && chown -R nobody:nogroup /data/clips \
    && chmod -R a+rX /app/static \
    && chmod -R a+rX /app/static_companion \
    && chmod -R a+rX /app/parser_workers

ENV CS2_CONTROL_URL=http://bb_cs2_control:8765
ENV CLIPS_DIR=/data/clips
EXPOSE 8780
USER nobody
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8780"]
