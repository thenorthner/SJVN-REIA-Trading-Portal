# Server setup aur kahin se bhi access

Do hisse: pehle platform server pe chalao, phir usse bahar se pahunchne layak banao.

---

## Hissa 1 — server pe chalu karo

Server pe login karo (`ssh user01@10.10.237.60`, password se — pehli baar), aur
ye poora block ek saath paste kar do:

```bash
# ── 1. SSH key theek karo (abhi Permission denied de raha hai) ────────────
chmod 755 ~ && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
sudo restorecon -R ~/.ssh 2>/dev/null || true

# key sahi hai ya nahi — fingerprint SHA256:vpsmeWO2ThnW6QDGX6RM/uL/HpeWBbmLPlPE5ZENCCo aana chahiye
ssh-keygen -lf ~/.ssh/authorized_keys

# agar nahi aata, ya file khaali/wrapped hai, to dobara likho (ek hi line me):
# echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJtO6yelzhzicaj0F4mYB9FgrUlcmT42lLYiYNn6rcrN kshitijsharma@mac' > ~/.ssh/authorized_keys
# chmod 600 ~/.ssh/authorized_keys

# sshd sach me kya dekh raha hai
sudo sshd -T | grep -iE 'authorizedkeysfile|pubkeyauthentication|strictmodes'

# ── 2. Node aur git ───────────────────────────────────────────────────────
command -v node >/dev/null || {
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}
sudo apt-get install -y git sqlite3

# ── 3. Platform deploy ────────────────────────────────────────────────────
cd ~
git clone https://github.com/thenorthner/SJVN-REIA-Trading-Portal.git 2>/dev/null || \
  (cd SJVN-REIA-Trading-Portal && git pull)
cd SJVN-REIA-Trading-Portal
./deploy.sh

# ── 4. Service banao taaki reboot ke baad bhi chale ───────────────────────
sudo cp sjvn-platform.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sjvn-platform
sudo systemctl status sjvn-platform --no-pager

# ── 5. Firewall khol do ───────────────────────────────────────────────────
sudo ufw allow 4000/tcp 2>/dev/null || true

# ── 6. Chal raha hai? ─────────────────────────────────────────────────────
curl -s http://localhost:4000/api/health && echo
ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v 127.0.0.1
```

Aakhri command jo IP dikhaye, uspar browser me kholo: **`http://<IP>:4000`**

Tumhara Mac aur server ek hi subnet pe hain (`192.168.58.x`), to office network se
seedha `http://192.168.58.63:4000` chal jaana chahiye — **koi SSH tunnel chahiye
hi nahi.**

Key theek hone ke baad tunnel bhi bina password ke chalega:

```bash
launchctl load -w ~/Library/LaunchAgents/local.sjvn.tunnel.plist   # Mac par
```

---

## Hissa 2 — kahin se bhi access

Office network se bahar bhi chahiye to teen raste hain. Isse pehle **ek baat
samajh lo**: is platform me asli SJVN commercial data hai — contracts, invoices,
tariffs, NOC details. Aur abhi:

- Plain HTTP hai, HTTPS nahi — login password bina encryption ke jaata hai
- Seed ke saare accounts ka password ek hi hai (`password123`)

Isliye ise seedha internet par khol dena theek nahi hoga. Do surakshit raste
neeche hain.

### Rasta A — Tailscale (yahi recommend karta hoon)

Private network banata hai. Tumhare apne devices — laptop, phone, ghar ka
computer — sab server tak pahunch sakte hain, par duniya nahi. Port forwarding
nahi, public exposure nahi, aur HTTPS built-in.

**Server pe:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# jo link aaye usse browser me kholo aur login karo
sudo tailscale ip -4        # ye IP note kar lo, jaise 100.x.y.z
```

**Apne har device pe:** Tailscale app install karke wahi account se login karo.

Ab kahin se bhi: **`http://100.x.y.z:4000`**

HTTPS bhi chahiye to:
```bash
sudo tailscale cert "$(tailscale status --json | grep -o '"DNSName":"[^"]*' | head -1 | cut -d'"' -f4)"
sudo tailscale serve --bg 4000
# ab https://<machine>.<tailnet>.ts.net par khulega
```

### Rasta B — Cloudflare Tunnel (asli public link)

Agar kisi aur ko bhi dikhana hai jiske paas Tailscale nahi hai, to ye HTTPS ka
public URL deta hai — bina router chhede.

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# quick test — turant ek trycloudflare.com link deta hai
cloudflared tunnel --url http://localhost:4000
```

Sthayi banane ke liye:
```bash
cloudflared tunnel login
cloudflared tunnel create sjvn
cloudflared tunnel route dns sjvn sjvn.tumhara-domain.com
cloudflared tunnel run sjvn
```

**Zaroori:** iske saath Cloudflare Access lagao, warna URL jaanne wala koi bhi
login page tak pahunch jaayega:
`Zero Trust → Access → Applications → Add` — aur sirf apni email allow karo.

### Rasta C — router pe port forward

Ye mat karo. Platform seedha internet par, plain HTTP par, `password123` wale
accounts ke saath — kuch hi din me scan ho jaayega.

---

## Bahar kholne se pehle ye zaroor karo

```bash
# 1. saare demo passwords badlo — admin@sjvn.in se login karke Users screen se,
#    ya jo accounts nahi chahiye unhe delete kar do

# 2. JWT secret sach me set hai? (deploy.sh ne bana diya hoga)
grep JWT_SECRET ~/SJVN-REIA-Trading-Portal/backend/.env

# 3. rozana backup
(crontab -l 2>/dev/null; echo "0 2 * * * sqlite3 ~/SJVN-REIA-Trading-Portal/backend/src/db/platform.db \".backup '~/backups/platform-\$(date +\\%F).db'\"") | crontab -
mkdir -p ~/backups
```

---

## Kuch na chale to

| Dikkat | Dekho |
|---|---|
| `./deploy.sh` fail | `node --version` — 18+ chahiye |
| Service start nahi hui | `sudo journalctl -u sjvn-platform -n 50 --no-pager` |
| Page khaali | `cd frontend && npm run build`, phir restart |
| Server se khulta hai, Mac se nahi | `sudo ufw allow 4000/tcp` |
| Tunnel `Permission denied` | Hissa 1 ka step 1 dobara — home dir permissions |
