#!/usr/bin/env python3
import os
import subprocess
import time
import sys

print("🚀 Starting background SSH tunnel daemon...", flush=True)
env = dict(os.environ)
env["SSH_AUTH_SOCK"] = ""

while True:
    try:
        proc = subprocess.Popen([
            "ssh",
            "-N",
            "-F", "/dev/null",
            "-i", "/Users/kshitijsharma/.ssh/id_ed25519",
            "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ServerAliveInterval=10",
            "-o", "ServerAliveCountMax=3",
            "-L", "0.0.0.0:4000:127.0.0.1:4000",
            "user01@10.10.237.60"
        ], env=env)
        print("✅ Tunnel process launched (PID:", proc.pid, ")", flush=True)
        proc.wait()
    except Exception as e:
        print(f"Tunnel exception: {e}", flush=True)
    print("⚠️ Tunnel exited, retrying in 2s...", flush=True)
    time.sleep(2)
