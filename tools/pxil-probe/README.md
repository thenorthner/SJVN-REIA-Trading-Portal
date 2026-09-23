# PXIL probe — how to run it on the whitelisted server

PXIL filters by source IP, separately for staging and production. Only the SJVN
server whose public IP PXIL whitelisted (`49.50.97.173`, the Cyfuture NAT in
front of the Windows VM at `192.168.0.2`) can call these APIs at all. From
anywhere else — including the development Mac, which PXIL saw as
`223.31.159.139` and refused on 17 Sep — all six endpoints answer
`403 {"message": "Access denied. Your IP is not allowed."}`.

So the work splits in two:

| Where | What | Needs |
|---|---|---|
| On the server | `tools/pxil-probe/pxil-probe.mjs` — calls PXIL, writes a capture | Node 18+, nothing else |
| Anywhere | `backend/scripts/pxilAnalyse.js <capture.json>` — renders the report | the repo |

Capture once, analyse many times. A server session has to be arranged; a
corrected analysis should not have to be.

## 1. Get the file onto the server

There is **no git repo on the server**. The Windows deploy is a stripped bundle —
`deploy-windows.ps1` ships source only, with `.git`, `node_modules` and the dev
database removed — so `git fetch` and `git pull` are not available there. Copy
the file over instead, the same way the deploy itself goes:

From the Mac, Finder → `Cmd+K` → `smb://192.168.0.2` → log in as Administrator,
then drop `pxil-probe.mjs` next to the deployed app, at
`D:\WebApplications\REIA Commercial\sjvn-deploy\`.

(Not RDP drag-drop — slow, and it breaks partway.)

Dropping it beside the app rather than anywhere else is deliberate: the tool
looks for `backend\.env` relative to **the folder you run it from**, so as long
as you `cd` to the deploy folder it picks up the deployed token with no token
pasted on the command line. (`--env` overrides this with an explicit path.)

Nothing needs to be installed. The tool has no dependencies, so the Node that
already runs the platform is enough, and it never touches `node_modules`, the
database, or the running service.

## 2. Run it

RDP to `192.168.0.2:9007` over the VPN, open PowerShell:

```powershell
cd "D:\WebApplications\REIA Commercial\sjvn-deploy"
node pxil-probe.mjs 2026-08-01 2026-09-22 --token=<production token> --base=https://dashboard.pxil.in
```

- The date range should span a day **above the 12th** — that is the only thing
  that can prove PXIL's responses are `DD-MM-YYYY` rather than `MM-DD-YYYY`, and
  it should cover a period with known trades or every answer is "no rows".
- Leave `--token` off only if the deployed `backend\.env` already holds the
  **production** token. It held the staging one as of 23 Sep, and each
  environment has its own. Run from the folder above and that `.env` is found
  automatically; the report prints the token's fingerprint, never the token, so
  check the fingerprint to see which environment you actually hit.
- `--no-ip` skips the one call to `ifconfig.me`. Leave it on the first time: it
  prints the address PXIL will actually see, which is the thing they whitelist.

It makes 12 GET requests (six endpoints × both auth styles) and writes
`pxil-capture-<timestamp>.json` in the current directory. It opens no database,
runs no migration, and writes nothing else.

## 3. Send the capture back

The capture lands in the same folder. Copy it back over the same SMB share.

Then, on any machine with the repo:

```bash
node backend/scripts/pxilAnalyse.js pxil-capture-2026-09-23T10-30-00-000Z.json
```

That renders the same report a live run would, and answers:

- **Q2** which auth style each endpoint really accepts (and whether PXIL has
  quietly upgraded Member DOR and Reverse Auction off the query string)
- **Q4** whether Member DOR's `Total` equals the sum of its own `Category` in
  live data, or whether the 1,15,386.32 gap in their sample is real
- **Q6** which Format-D fields are populated, and how `TransactionPrice` relates
  to `TransactionRate`
- **Q7** whether responses are `DD-MM-YYYY`
- **Q9** whether a day is 95 or 96 blocks, and whether a slot is labelled by its
  start or its end

## What is safe to share

The **report** carries no credential — send it to PXIL freely.

The **capture** holds real trade data and the server's hostname. It is internal:
send it to the project, not to PXIL. The token is never written to it (only an
8-hex SHA-256 fingerprint, enough to tell staging's token from production's),
and no URL is recorded either, because under query auth a URL contains the
token.
