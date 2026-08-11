#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

REMOTE_USER = "user01"
REMOTE_HOST = "192.168.58.63"
REMOTE_PWD = "password@1234"

def run():
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
            "cd /home/user01/sjvn-energy-platform",
            f"echo '{REMOTE_PWD}' | sudo -S cp sjvn-platform.service /etc/systemd/system/",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl daemon-reload",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl restart sjvn-platform",
            "sleep 3",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl status sjvn-platform --no-pager",
            "echo '=== HEALTH CHECK 4000 ==='",
            "curl -s http://127.0.0.1:4000/api/health",
            "echo ''",
            "echo '=== HEALTH CHECK APACHE PORT 80 ==='",
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
    run()
