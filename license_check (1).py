"""
license_check.py — drop this next to your main script and call
`ensure_licensed()` near the top of main(), before the Flask server starts.

Flow:
  1. First run: no local activation file -> ask for license key on the console
     (or show a small Tkinter popup if you prefer a GUI).
  2. Calls https://fondpeace.com/api/activate with the key + this machine's
     hardware fingerprint.
  3. On success, saves an activation marker locally so future launches don't
     need internet or to ask again.

This is a practical deterrent (stops casual key-sharing), not an unbreakable
lock — no client-side check is. Pair it with PyArmor obfuscation (see build
notes) to raise the effort needed to bypass it.
"""

import hashlib
import json
import platform
import subprocess
import sys
import uuid
from pathlib import Path

import requests

ACTIVATE_URL = "https://fondpeace.com/api/activate"

if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
else:
    APP_DIR = Path(__file__).resolve().parent

ACTIVATION_FILE = APP_DIR / ".license_activation"


def _get_hardware_id() -> str:
    """Builds a fingerprint from stable machine identifiers. Not perfect
    (changes if the user reinstalls Windows or swaps the main disk), but
    stable across normal day-to-day use."""
    raw_parts = [platform.node(), platform.machine()]

    try:
        if platform.system() == "Windows":
            out = subprocess.check_output(
                "wmic csproduct get uuid", shell=True, text=True
            )
            raw_parts.append(out.strip().splitlines()[-1].strip())
    except Exception:
        pass

    raw_parts.append(str(uuid.getnode()))  # MAC-derived, fallback

    raw = "|".join(raw_parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _already_activated() -> bool:
    if not ACTIVATION_FILE.exists():
        return False
    try:
        data = json.loads(ACTIVATION_FILE.read_text())
        return data.get("deviceId") == _get_hardware_id()
    except Exception:
        return False


def _save_activation(license_key: str):
    ACTIVATION_FILE.write_text(
        json.dumps({"licenseKey": license_key, "deviceId": _get_hardware_id()})
    )
    # Hide the file on Windows so it's not the first thing someone deletes
    if platform.system() == "Windows":
        try:
            subprocess.run(["attrib", "+H", str(ACTIVATION_FILE)], check=False)
        except Exception:
            pass


def ensure_licensed():
    """Call this once at startup. Exits the app if activation fails."""
    if _already_activated():
        return

    print("First run — enter the license key from your purchase email.")
    license_key = input("License key: ").strip()

    device_id = _get_hardware_id()
    try:
        resp = requests.post(
            ACTIVATE_URL,
            json={"licenseKey": license_key, "deviceId": device_id},
            timeout=15,
        )
    except Exception:
        print("Could not reach the activation server. Check your internet connection.")
        sys.exit(1)

    if resp.status_code == 200:
        _save_activation(license_key)
        print("Activated. Starting Shorts Studio...")
        return

    try:
        msg = resp.json().get("error", "Activation failed")
    except Exception:
        msg = "Activation failed"
    print(f"Activation failed: {msg}")
    sys.exit(1)
