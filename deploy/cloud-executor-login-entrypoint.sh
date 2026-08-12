#!/bin/sh
set -eu

DISPLAY="${CLOUD_EXECUTOR_DISPLAY:-:99}"
NOVNC_PORT="${CLOUD_EXECUTOR_NOVNC_PORT:-6080}"
export DISPLAY

case "$NOVNC_PORT" in
  *[!0-9]*|'')
    echo "CLOUD_EXECUTOR_NOVNC_PORT_INVALID" >&2
    exit 1
    ;;
esac
if [ "$NOVNC_PORT" -lt 1 ] || [ "$NOVNC_PORT" -gt 65535 ]; then
  echo "CLOUD_EXECUTOR_NOVNC_PORT_INVALID" >&2
  exit 1
fi

cleanup() {
  kill "${NOVNC_PID:-}" "${VNC_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp &
XVFB_PID=$!

attempt=0
until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ] || ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "CLOUD_EXECUTOR_XVFB_UNAVAILABLE" >&2
    exit 1
  fi
  sleep 0.1
done

x11vnc -display "$DISPLAY" -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!
sleep 0.1
if ! kill -0 "$VNC_PID" 2>/dev/null; then
  echo "CLOUD_EXECUTOR_VNC_UNAVAILABLE" >&2
  exit 1
fi

# 0.0.0.0 is container-local and fixed here so Docker's host-loopback mapping can reach it.
# The host bind remains 127.0.0.1 and cannot be changed through Cloud Executor configuration.
websockify --web=/usr/share/novnc "0.0.0.0:$NOVNC_PORT" "127.0.0.1:5900" >/tmp/websockify.log 2>&1 &
NOVNC_PID=$!
sleep 0.1
if ! kill -0 "$NOVNC_PID" 2>/dev/null; then
  echo "CLOUD_EXECUTOR_NOVNC_UNAVAILABLE" >&2
  exit 1
fi

trap - EXIT INT TERM
exec node scripts/cloud-executor.js login
