# NOAR probe — how to run it on the whitelisted server

NOAR is reached through a Grid India gateway. SJVN's access is tied to the IP
registered for it — the test server's public address, `49.50.97.173` (the
Cyfuture NAT in front of the Windows VM at `192.168.0.2`). A developer machine
is a different address, so a run from the Mac proves nothing about the
credentials: a refusal there is expected and says nothing either way.

Hence the same split as the PXIL probe:

| Where | What | Needs |
|---|---|---|
| On the server | `tools/noar-probe/noar-probe.mjs` — calls NOAR, writes a capture | Node 18+, nothing else |
| Anywhere | read the capture | the repo |

## What it is for

The credentials arrived from O/o CGM (Power Trading) on 28-Sep-2026 with no
statement of which environment they belong to and no word on whitelisting. Four
things have to be established before the platform can be pointed at NOAR, and
one run settles all four:

1. **Does the server's IP get through?** A gateway 403 and NOAR's own 401 read
   nothing alike, and the tool sends a deliberately invalid credential as a
   control so the two cannot be confused.
2. **Which host — production or test?** The key/secret pair carries no
   environment marker. Both are tried (`external.noar.in`, `devdr.noar.in:84`).
3. **Is the one-month range limit real?** The guide says a month is the maximum
   and the platform chunks longer spans on that basis. One deliberately
   120-day request shows whether NOAR refuses, truncates, or does not care.
4. **The undocumented status codes.** `Status`, `BidStatus`, `CongestionStatus`
   and `PaymentStatus` are numeric with no published enumeration, which is why
   the platform reports differences instead of moving `noar_status` by itself.
   A capture of real applications turns the question to PwC from "please send
   the list" into "what does Status 4 mean on application X".

## Order of operations

The gateway has to know the address before any of this proves anything. Both
guides say so — NOAR's §1.5 ("Mutual whitelisting of IP should be done between
both communication network") and WBES's §2 ("Whitelisting of IP will be done at
gateway level").

1. **Run it once on the server anyway**, only to read the outbound IP it prints.
   That is the address the gateway will see, and it is the one thing worth
   confirming before asking anyone to register it — the deploy sits behind a
   Cyfuture NAT, so the server's own address is not the answer. Every NOAR call
   in that run will be refused, which is expected and fine.
2. **Send the whitelisting mails** — `docs/NOAR_IP_Whitelisting_Email_Draft.md`
   and `docs/WBES_IP_Whitelisting_Email_Draft.md`, both to Grid India.
3. **Run it properly** once they confirm. That run is the one that answers the
   four questions above.

## Run it

Copy the one file to the server the same way the deploy goes — Finder →
`Cmd+K` → `smb://192.168.0.2` as Administrator, drop it at
`D:\WebApplications\REIA Commercial\sjvn-deploy\`. Then RDP to
`192.168.0.2:9007` over the VPN and, in PowerShell:

```powershell
cd "D:\WebApplications\REIA Commercial\sjvn-deploy"
node noar-probe.mjs 2026-08-01 2026-08-31
```

- Run it from the deploy folder and it finds `backend\.env` by itself, so no
  credential is typed on the command line. **The deployed `.env` does not have
  the NOAR lines yet** — add them from `backend/.env.example`, or pass
  `--key=` and `--secret=` for the first run.
- Pick a range that contains **known applications**, otherwise every answer is
  an empty list and nothing is proved.
- Leave the outbound-IP echo on the first time: it prints the address NOAR
  actually sees, which is the thing Grid India whitelists. `--no-ip` skips it.
- `--host=production` or `--host=test` narrows it; the default tries both.
  `--base=<url>` points it somewhere else entirely (a mock).

It makes five requests per host — `isRejected` both ways, one over-long range,
one invalid-credential control — and writes
`noar-capture-<timestamp>.json` in the current directory. It opens no database,
runs no migration, and writes nothing else.

## WBES

The same tool probes WBES, but only when the three things the API key does not
carry are supplied:

```powershell
node noar-probe.mjs --wbes-base=<url> --wbes-user=<username> --wbes-util=<acronym>
```

Without them it says so and skips. The guide publishes no host, and states the
username must match the credential the key was issued against — so the key alone
cannot be tested. Those three are pending with O/o CGM
(`docs/WBES_IP_Whitelisting_Email_Draft.md`).

## What is safe to share

The **capture** carries no credential: the key rides in NOAR's query string, so
no URL is recorded at all — only the path, the non-secret body, and an 8-hex
SHA-256 fingerprint of each credential, which is enough to tell one key from
another. It does hold SJVN's real open-access applications and the server's
hostname, so it is internal: send it to the project, not onward to NOAR or PwC.

The tool also prints, without contacting anyone, whether the key and secret are
one pair — NOAR carries the API key inside the secret's `groupsid` claim, so a
mismatch means the two came from different generations of the key. That check is
worth reading before anything else, because a regenerated key is the one failure
that looks like a server problem.
