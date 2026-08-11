#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

REMOTE_USER = "user01"
REMOTE_HOST = "192.168.58.63"
REMOTE_PWD = "password@1234"

def fix():
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
            "echo '=== CHECK SERVICE STATUS ==='",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl status sjvn-platform --no-pager",
            "echo '=== CHECK JOURNAL LOGS ==='",
            f"echo '{REMOTE_PWD}' | sudo -S journalctl -u sjvn-platform -n 30 --no-pager",
            "echo '=== CHECK OPEN PORTS ==='",
            f"echo '{REMOTE_PWD}' | sudo -S ss -tlpn | grep 4000 || sudo netstat -tlpn | grep 4000 || sudo lsof -i :4000",
            "echo '=== CHECK FIREWALL ==='",
            f"echo '{REMOTE_PWD}' | sudo -S ufw status",
            f"echo '{REMOTE_PWD}' | sudo -S ufw allow 4000/tcp",
            f"echo '{REMOTE_PWD}' | sudo -S iptables -I INPUT -p tcp --dport 4000 -j ACCEPT 2>/dev/null || true",
            "echo '=== RESTART SYSTEMD SERVICE ==='",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl restart sjvn-platform",
            "sleep 3",
            f"echo '{REMOTE_PWD}' | sudo -S systemctl status sjvn-platform --no-pager",
            "echo '=== CHECK LOCAL CURL ==='",
            "curl -v http://localhost:4000/api/health",
            "curl -v http://192.168.58.63:4000/api/health",
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
    fix()
