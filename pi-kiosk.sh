#!/bin/bash
# Kiosk-Startskript für Raspberry Pi 4B
# Legt Chromium mit Hardware-Video-Beschleunigung und Vollbild-Kiosk-Modus auf.
#
# Anpassung: SERVER_URL auf die IP/Hostname des Infoscreen-Servers setzen.
# Optionaler Name für die System-Übersicht im Admin-Dashboard: ?name=Halle-A
#
# Empfohlene Systemvoraussetzungen:
#   - /boot/firmware/config.txt: gpu_mem=256
#   - raspi-config → Advanced Options → GL Driver → "GL (Fake KMS)" (Pi 4)
#   - sudo apt install chromium-browser xdotool unclutter

SERVER_URL="http://DEINE-SERVER-IP:3000/screen?name=Pi-Halle-A"

# Maus verstecken
unclutter -idle 0.5 -root &

# Bildschirmschoner/Energie-Sparen deaktivieren
xset s off
xset -dpms
xset s noblank

chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --kiosk \
  --start-fullscreen \
  --autoplay-policy=no-user-gesture-required \
  --disable-session-crashed-bubble \
  --disable-translate \
  --no-first-run \
  --fast \
  --fast-start \
  --disable-features=TranslateUI \
  \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --ignore-gpu-blocklist \
  --enable-accelerated-video-decode \
  --enable-accelerated-video-encode \
  --gpu-memory-buffer-video-frames \
  --use-gl=egl \
  \
  "$SERVER_URL"
