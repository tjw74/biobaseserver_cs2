#!/usr/bin/env bash
set -euo pipefail
systemctl start biobase-render-xorg.service biobase-render-desktop.service biobase-render-vnc.service biobase-render-novnc.service biobase-render-steam.service
/usr/local/bin/biobase-fit-steam-windows || true
echo "Steam service is running in Biobase render session. Viewer: http://192.168.1.120:6080/vnc.html?autoconnect=1&resize=remote&path=websockify"
