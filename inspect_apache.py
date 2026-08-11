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
            "echo '=== APACHE SITES ENABLED ==='",
            "ls -la /etc/apache2/sites-enabled/",
            "cat /etc/apache2/sites-enabled/* 2>/dev/null || true",
            "echo '=== CHECK APACHE MODULES ==='",
            "apache2ctl -M | grep -i proxy || true",
            "echo '=== CHECK IPTABLES ==='",
            f"echo '{REMOTE_PWD}' | sudo -S iptables -L -n -v",
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
    inspect()
