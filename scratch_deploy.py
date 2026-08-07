#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

REMOTE_USER = "user01"
REMOTE_PWD = "password@1234"

def run_on_host(host):
    print(f"\n============================================================")
    print(f"🚀 ATTEMPTING CONNECTION TO {host}...")
    print(f"============================================================")
    
    cmd = [
        "ssh",
        "-F", "/dev/null",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "PubkeyAuthentication=no",
        "-o", "PreferredAuthentications=keyboard-interactive,password",
        f"{REMOTE_USER}@{host}"
    ]
    
    pid, master = pty.fork()
    if pid == 0:
        os.execvp("ssh", cmd)
    else:
        commands = [
            "echo '--- IP INTERFACES ---'",
            "ip -4 addr show",
            "echo '--- DIRECTORIES ---'",
            "ls -la $HOME",
            "cd $HOME/sjvn-energy-platform 2>/dev/null || cd $HOME/SJVN-REIA-Trading-Portal 2>/dev/null || cd $HOME",
            "pwd",
            "git fetch origin",
            "git reset --hard origin/main",
            "chmod +x deploy.sh 2>/dev/null || true",
            "./deploy.sh",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl daemon-reload",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl restart sjvn-platform 2>/dev/null || true",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl restart sjvn-platform.service 2>/dev/null || true",
            "echo '--- HEALTH CHECK ---'",
            "curl -s http://localhost:4000/api/health",
            "echo ''",
            "echo '--- DONE ---'",
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
    for h in ["192.168.58.63", "10.10.237.60"]:
        try:
            run_on_host(h)
        except Exception as e:
            print(f"Error on {h}: {e}")
