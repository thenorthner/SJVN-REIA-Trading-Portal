#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

REMOTE_USER = "user01"
REMOTE_HOST = "192.168.58.63"
REMOTE_PWD = "password@1234"

def inspect():
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
            "echo '=== WHO IS LISTENING ON PORT 4000 ==='",
            f"echo '{REMOTE_PWD}' | sudo -S lsof -i :4000 || sudo netstat -tlpn | grep 4000",
            "echo '=== PM2 LIST ==='",
            "pm2 list",
            "echo '=== SYSTEMD SERVICE ==='",
            "systemctl is-active sjvn-platform || true",
            "echo '=== WHERE IS GIT REPO AND COMMITS ==='",
            "cd $HOME/sjvn-energy-platform",
            "git log -n 3 --oneline",
            "ls -la frontend/dist",
            "echo '=== COPY DIST TO BACKEND PUBLIC IF ANY ==='",
            "mkdir -p backend/public",
            "cp -r frontend/dist/* backend/public/ 2>/dev/null || true",
            "echo '=== REBUILD FRONTEND & RESTART PM2 + SYSTEMCTL ==='",
            "cd frontend && npm run build && cd ..",
            "pm2 restart all || true",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl restart sjvn-platform || true",
            "echo '=== VERIFY HTML FROM LOCALHOST 4000 ==='",
            "curl -s http://localhost:4000/ | grep -E 'assets/index-.*js'",
            "exit"
        ]
        
        full_payload = "\n".join(commands) + "\n"
        buffer = b""
        password_sent = False
        payload_sent = False
        start_time = time.time()
        
        while time.time() - start_time < 120:
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
    inspect()
