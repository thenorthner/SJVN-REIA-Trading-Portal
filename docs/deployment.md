# Server pe deploy kaise karein

Poora platform ek hi Node process se chalta hai — wahi process UI bhi serve karta
hai aur API bhi. Matlab nginx ya koi reverse proxy configure karne ki zaroorat
nahi, aur ek hi link se sab kuch khulta hai.

---

## Ek baar ka setup

Server pe SSH karke (`ssh user01@192.168.58.63`), repo clone karo aur script chalao:

```bash
git clone https://github.com/thenorthner/SJVN-REIA-Trading-Portal.git
cd SJVN-REIA-Trading-Portal
./deploy.sh
```

Script ye sab karti hai:

1. Node 18+ hai ya nahi check karti hai
2. `backend/.env` banati hai aur usme ek **naya JWT secret** generate karti hai
3. Dono taraf ki dependencies install karti hai
4. Frontend build karti hai (`frontend/dist`)
5. Database na ho to seed karti hai — hai to chhod deti hai aur sirf migrations lagti hain
6. Aakhir me batati hai ki kaunse link par khulega

## Baad ke updates

Ek baar server set ho jaane ke baad, har naye release ke liye sirf ye chalao:

```bash
cd sjvn-energy-platform && ./update.sh
```

Ye script poora cycle khud sambhaalti hai:

1. `git fetch` — kuch naya nahi hai to wahin ruk jaati hai
2. Fast-forward pull (agar server ki history diverge ho gayi ho to rukti hai, chupchaap overwrite nahi karti)
3. `deploy.sh` — dependencies + frontend build
4. **Test suite chalati hai — service restart karne se PEHLE**, taaki toota hua release live na pahunche
5. `systemctl restart` + health check
6. Kuch bhi fail ho to **apne aap pichhle commit pe rollback** karke rebuild kar deti hai

Service ka naam alag ho to `SJVN_SERVICE=my-service ./update.sh`.

---

Phir service chalu karo:

```bash
sudo cp sjvn-platform.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sjvn-platform
```

Link: **http://192.168.58.63:4000**

---

## Chalu karne se pehle ye teen cheezein

### 1. JWT secret — sabse zaroori

Repo **public hai**, aur usme development ka JWT secret likha hua hai
(`sjvn-dev-secret-change-me`). Jo bhi wo GitHub par padhe, wo apne aap ek valid
`SJVN_ADMIN` token bana sakta hai aur poore platform me ghus sakta hai.

Isliye ab server `NODE_ENV=production` me us default secret ke saath **start hi
nahi hoga** — saaf error dega. `deploy.sh` pehli baar chalne par asli secret bana
deti hai. Khud banana ho to:

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
```

Aur `backend/.env` me `JWT_SECRET=` ke aage daal do. Ye file kabhi commit mat karna
(`.gitignore` me already hai).

### 2. Demo passwords badlo

Seed ke saare users ka password ek hi hai — `password123`. Laptop par theek tha,
network par nahi. Server chalu hone ke baad turant:

- `admin@sjvn.in` se login karo
- jo accounts chahiye unke password reset karo (Users screen se)
- jo demo accounts nahi chahiye unhe delete kar do

### 3. Ye LAN address hai, internet nahi

`192.168.58.63` internal network ka address hai — sirf SJVN network se khulega.
Agar kabhi isse bahar se accessible karna ho, to pehle HTTPS lagana padega, kyunki
abhi login password plain HTTP par jaata hai.

---

## Roz ka istemal

```bash
sudo systemctl status sjvn-platform      # chal raha hai ya nahi
sudo journalctl -u sjvn-platform -f      # live logs
sudo systemctl restart sjvn-platform     # restart
```

### Naya code deploy karna

```bash
cd ~/SJVN-REIA-Trading-Portal
git pull
./deploy.sh
sudo systemctl restart sjvn-platform
```

`deploy.sh` dobara chalane se database **replace nahi hota**. Schema aur migrations
har boot par idempotent chalti hain, to purana data waise ka waisa rehta hai.

### Backup

Poora data ek hi SQLite file me hai:

```bash
# service band kiye bina safe copy
sqlite3 backend/src/db/platform.db ".backup '/home/user01/backup-$(date +%F).db'"
```

Ise cron me daal dena chahiye. Uploads (`backend/uploads/`) bhi copy karni hongi —
usme invoice attachments aur KYC documents hote hain.

---

## Configuration

Sab kuch `backend/.env` me:

| Variable | Kaam | Default |
|---|---|---|
| `JWT_SECRET` | Token signing key — **zaroori** | koi nahi; production me start block ho jaata hai |
| `NODE_ENV` | `production` rakho | `development` |
| `PORT` | Kis port par sunna hai | `4000` |
| `HOST` | Bind address | `0.0.0.0` (LAN par dikhne ke liye) |
| `CLIENT_DIR` | Built frontend ka path | `../frontend/dist` |
| `CORS_ORIGIN` | Comma-separated origins | khaali — production me cross-origin band |
| `SMTP_HOST` etc. | Invoice email | khaali = PDF `backend/outbox/` me likhti hai |

Baaki business settings — trading margin caps, LPS rates, block durations, price
bands, SLDC renewal window — code me nahi hain. Wo **Master Data** screen se
badalti hain, bina deploy kiye.

---

## Kuch galat ho to

**Service start nahi ho rahi**

```bash
sudo journalctl -u sjvn-platform -n 50 --no-pager
```

Sabse common: `JWT_SECRET is not set` — matlab `.env` nahi bani ya secret khaali hai.

**Link khulta hai par page khaali**

Frontend build nahi hua. Logs me dekho — agar `[WEB] No frontend build found` likha
hai to:

```bash
cd frontend && npm run build
sudo systemctl restart sjvn-platform
```

**Server se to khulta hai, doosri machine se nahi**

Firewall port block kar raha hoga:

```bash
sudo ufw allow 4000/tcp
```

**Login nahi ho raha**

Agar `JWT_SECRET` badla hai to purane sab tokens invalid ho jaate hain — ye
expected hai. Browser me logout karke dobara login karo.

---

## Deployment me kya kya check kiya gaya

Local production build par ye sab verify hua:

| Check | Result |
|---|---|
| `NODE_ENV=production` bina `JWT_SECRET` ke | start refuse, saaf error message |
| Asli secret ke saath | ek process, UI + API dono |
| `/` par UI | 200 |
| `/trading/dam` jaisa deep link | 200 (SPA fallback) |
| `/api/health` | 200 JSON |
| Unknown API route | 404 JSON, HTML nahi |
| Login → authenticated API call | kaam karta hai |
| Public dev secret se banaya token | **reject** — `Invalid or expired token` |
