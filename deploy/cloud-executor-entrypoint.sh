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

x11vnc -display "$DISPLAY" -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 >/tmp/cloud-executor-x11vnc.log 2>&1 &
VNC_PID=$!
sleep 0.1
if ! kill -0 "$VNC_PID" 2>/dev/null; then
  echo "CLOUD_EXECUTOR_VNC_UNAVAILABLE" >&2
  exit 1
fi

# 0.0.0.0 is container-local. Compose maps the host side to 127.0.0.1 only.
websockify --web=/usr/share/novnc "0.0.0.0:$NOVNC_PORT" "127.0.0.1:5900" >/tmp/cloud-executor-websockify.log 2>&1 &
NOVNC_PID=$!
sleep 0.1
if ! kill -0 "$NOVNC_PID" 2>/dev/null; then
  echo "CLOUD_EXECUTOR_NOVNC_UNAVAILABLE" >&2
  exit 1
fi

trap - EXIT INT TERM
case "${1:-}" in
  login)
    shift
    if [ "$#" -ne 0 ]; then
      echo "CLOUD_EXECUTOR_COMMAND_INVALID" >&2
      exit 2
    fi
    exec node scripts/cloud-executor.js login
    ;;
  worker|'')
    if [ "${1:-}" = "worker" ]; then shift; fi
    if [ "$#" -ne 0 ]; then
      echo "CLOUD_EXECUTOR_COMMAND_INVALID" >&2
      exit 2
    fi
    exec node scripts/cloud-executor-worker.js
    ;;
  *)
    echo "CLOUD_EXECUTOR_COMMAND_INVALID" >&2
    exit 2
    ;;
esac
