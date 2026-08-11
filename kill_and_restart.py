#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

REMOTE_USER = "user01"
REMOTE_HOST = "192.168.58.63"
REMOTE_PWD = "password@1234"

def kill_and_restart():
    cmd = [
        "ssh",
        "-F", "/dev/null",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "PubkeyAuthentication=no",
        "-o", "PreferredAuthentications=keyboard-interactive,password",
        f"{REMOTE_USER}@{REMOTE_HOST}"
    ]
    
    pid, master = pty.fork()
    if pid == 0:
        os.execvp("ssh", cmd)
    else:
        commands = [
            "echo '=== STOP SERVICE FIRST ==='",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl stop sjvn-platform",
            "echo '=== FIND PROCESS ON 4000 ==='",
            f"echo '{REMOTE_PWD}' | sudo -S ss -tlpn | grep 4000 || true",
            f"echo '{REMOTE_PWD}' | sudo -S fuser -k 4000/tcp || true",
            f"echo '{REMOTE_PWD}' | sudo -S pkill -9 -f 'node.*server.js' || true",
            "sleep 1",
            "echo '=== CHECK PORT 4000 IS FREE ==='",
            f"echo '{REMOTE_PWD}' | sudo -S ss -tlpn | grep 4000 || echo 'Port 4000 is clean and free'",
            "echo '=== START SJVN PLATFORM ==='",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl start sjvn-platform",
            "sleep 3",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl status sjvn-platform --no-pager",
            "echo '=== TEST DIRECT 4000 HEALTH ==='",
            "curl -s http://127.0.0.1:4000/api/health",
            "echo ''",
            "echo '=== TEST APACHE PORT 80 HEALTH ==='",
            "curl -s http://127.0.0.1/api/health",
            "echo ''",
            "exit"
        ]
        
        full_payload = "\n".join(commands) + "\n"
        buffer = b""
        password_sent = False
        payload_sent = False
        start_time = time.time()
        
        while time.time() - start_time < 30:
            r, _, _ = select.select([master], [], [], 0.2)
            if master in r:
                try:
                    data = os.read(master, 1024)
                    if not data:
                        break
                    sys.stdout.write(data.decode("utf-8", errors="ignore"))
                    sys.stdout.flush()
                    buffer += data
                    
                    if not password_sent and (b"assword" in buffer or b"Password" in buffer):
                        time.sleep(0.3)
                        os.write(master, (REMOTE_PWD + "\n").encode())
                        password_sent = True
                        buffer = b""
                        
                    if password_sent and not payload_sent and (b"$" in buffer or b"user01@" in buffer):
                        time.sleep(0.5)
                        os.write(master, full_payload.encode())
                        payload_sent = True
                        buffer = b""
                        
                except OSError:
                    break
            else:
                p, s = os.waitpid(pid, os.WNOHANG)
                if p != 0:
                    break
                    
        os.waitpid(pid, 0)

if __name__ == "__main__":
    kill_and_restart()
