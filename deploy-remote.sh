#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

TARGET_HOST = "192.168.58.63"
TARGET_USER = "user01"
TARGET_PASS = "password@1234"
REPO_URL = "https://github.com/thenorthner/SJVN-REIA-Trading-Portal.git"
TARGET_DIR = "sjvn-energy-platform"

remote_cmd = f"""
set -e
echo "==> [1/4] Preparing repository on server..."
if [ -d "$HOME/{TARGET_DIR}" ]; then
    echo "Found existing directory, pulling latest code..."
    cd "$HOME/{TARGET_DIR}"
    git pull origin main
else
    echo "Cloning repository..."
    cd "$HOME"
    git clone {REPO_URL} {TARGET_DIR}
    cd "$HOME/{TARGET_DIR}"
fi

echo "==> [2/4] Running deploy.sh (build & DB setup)..."
chmod +x deploy.sh
./deploy.sh

echo "==> [3/4] Registering systemd service..."
echo "{TARGET_PASS}" | sudo -S cp sjvn-platform.service /etc/systemd/system/
echo "{TARGET_PASS}" | sudo -S systemctl daemon-reload
echo "{TARGET_PASS}" | sudo -S systemctl enable sjvn-platform
echo "{TARGET_PASS}" | sudo -S systemctl restart sjvn-platform

echo "==> [4/4] Checking service status..."
echo "{TARGET_PASS}" | sudo -S systemctl status sjvn-platform --no-pager

echo ""
echo "================================================================"
echo "✅ SJVN Platform Deployed Successfully!"
echo "👉 Accessible at: http://{TARGET_HOST}:4000"
echo "================================================================"
"""

def main():
    print(f"==> Connecting to {TARGET_USER}@{TARGET_HOST}...")
    master, slave = pty.openpty()
    pid = os.fork()

    if pid == 0:
        os.close(master)
        os.setsid()
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        os.close(slave)
        os.execvp("ssh", [
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ConnectTimeout=6",
            f"{TARGET_USER}@{TARGET_HOST}",
            f"bash -c '{remote_cmd}'"
        ])
    else:
        os.close(slave)
        password_sent = False
        buffer = b""
        start_time = time.time()
        
        while True:
            r, _, _ = select.select([master], [], [], 0.5)
            if master in r:
                try:
                    data = os.read(master, 1024)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                    buffer += data

                    if not password_sent and b"password:" in buffer.lower():
                        os.write(master, (TARGET_PASS + "\n").encode())
                        password_sent = True
                except OSError:
                    break
            else:
                pid_res, status = os.waitpid(pid, os.WNOHANG)
                if pid_res != 0:
                    break
            
            if time.time() - start_time > 300:
                print("\n❌ Deployment timed out after 5 minutes.")
                break

        _, status = os.waitpid(pid, 0)
        exit_code = os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else (status >> 8)
        if exit_code != 0 and not password_sent:
            print(f"\n⚠️  Could not reach {TARGET_HOST}. Please verify network / VPN connection to the server.")
        return exit_code

if __name__ == "__main__":
    sys.exit(main())
