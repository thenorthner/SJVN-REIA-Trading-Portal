# Message draft — ask the ISET side for the WBES/NOAR credentials they already hold

**Internal** — to whoever administers the existing ISET application's logins
(fill in the name below). Not to Grid India / NOAR / WBES.

> **Fill before sending:**
> - `<NAME>` — whoever holds/administers ISET's WBES and NOAR logins
> - This is the same NOAR login the guide's "Create API Key" screen warns about:
>   one login = one active key, and generating a fresh one deactivates ISET's.
>   See [`docs/NOAR_Trader_API_Clarifications_Email_Draft.md`](NOAR_Trader_API_Clarifications_Email_Draft.md)
>   point 7 — that mail asks Grid India to confirm the same key can be used from
>   two servers once both IPs are whitelisted, but only once we actually have
>   the key to reuse.
> - Confirm whether ISET's WBES access is a portal login only, an API
>   credential, or both — the ask below covers whichever it turns out to be.

---

Namaste `<NAME>` ji,

Naye trading platform ke liye NOAR aur WBES se data lena hai — dono jagah
credentials chahiye, aur dono jagah SJVN ka existing access already hai (ISET
application ke through), to naya banwane se pehle wahi maangna better hai.

**NOAR:** Trader API key ek login pe ek hi active rehta hai — naya generate
karne se ISET ka wala deactivate ho jayega. To naya banane ke bajaye, jo
key+secret ISET already use kar raha hai NOAR ke liye, wahi bhej dijiye. Dono
servers (ISET ka aur naya platform) alag-alag IP se whitelist ho sakte hain,
same key ke saath — bas key milna chahiye.

**WBES:** ISET jo bhi login/credential WBES ke liye use karta hai (portal
login ho ya API access, jo bhi hai), uski details bhej dijiye — username,
aur jo bhi registration/acronym details WBES portal pe SJVN ke naam se dikhti
hain (open-access schedule data ke liye chahiye).

Dono ke liye humara server IP whitelist ke liye hai: **49.50.97.173**.

Jo bhi mile turant bata dijiyega, dono jagah blocked hai abhi.

Thanks,
Kshitij
