import sqlite3,sys,collections
APPLY='--apply' in sys.argv
c=sqlite3.connect('src/db/platform.db',timeout=60); c.execute('pragma foreign_keys=OFF')
tabs=[r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
cols={t:[x[1] for x in c.execute(f"pragma table_info('{t}')")] for t in tabs}
pk={t:('id' if 'id' in cols[t] else None) for t in tabs}
KEEP_ENT={'SEL-6ae584d5','ENT-EX-PSPCL','SEL-NJHPS','SEL-RHPS'}
# edges: child table, child col -> parent table
edges=collections.defaultdict(list)   # parent -> [(child,col)]
for t in tabs:
    for fk in c.execute(f"pragma foreign_key_list('{t}')"):
        if fk[2] in cols: edges[fk[2]].append((t,fk[3]))
HEUR={'entity_id':'entities','linked_entity_id':'entities','seller_id':'entities','buyer_id':'entities','counterparty_id':'entities',
 'contract_id':'contracts','ppa_id':'contracts','psa_id':'contracts','source_ppa_id':'contracts','invoice_id':'invoices','parent_invoice_id':'invoices',
 'payment_id':'payments','energy_data_id':'energy_data','energy_id':'energy_data','reconciliation_id':'reconciliations','recon_id':'reconciliations',
 'statement_id':'recon_statements','security_id':'payment_security','instrument_id':'payment_security','hydro_bill_id':'hydro_station_bills'}
for t in tabs:
    for col in cols[t]:
        p=HEUR.get(col)
        if p and p in cols and (t,col) not in edges[p] and t!=p: edges[p].append((t,col))
# never cascade into these
SETNULL={('trading_clients','entity_id')}
NOCASCADE={'users'}
deleted=collections.Counter(); seen=collections.defaultdict(set)
def q(ids): return ','.join('?'*len(ids))
def delete_rows(t,ids):
    """ids = list of pk values (id col) ; cascades to children"""
    ids=[i for i in ids if i not in seen[t]]
    if not ids: return
    seen[t].update(ids)
    for (ch,col) in edges.get(t,[]):
        if ch in NOCASCADE: continue
        if (ch,col) in SETNULL:
            n=c.execute(f"select count(*) from {ch} where {col} in ({q(ids)})",ids).fetchone()[0]
            if n: deleted[f'{ch}.{col}=NULL']+=n
            if APPLY: c.execute(f"update {ch} set {col}=NULL where {col} in ({q(ids)})",ids)
            continue
        if pk[ch]:
            kids=[r[0] for r in c.execute(f"select id from {ch} where {col} in ({q(ids)})",ids)]
            delete_rows(ch,kids)
        else:
            n=c.execute(f"select count(*) from {ch} where {col} in ({q(ids)})",ids).fetchone()[0]
            if n:
                deleted[ch]+=n
                if APPLY: c.execute(f"delete from {ch} where {col} in ({q(ids)})",ids)
    n=c.execute(f"select count(*) from {t} where id in ({q(ids)})",ids).fetchone()[0]
    deleted[t]+=n
    if APPLY: c.execute(f"delete from {t} where id in ({q(ids)})",ids)
# roots
ents=[r[0] for r in c.execute("select id from entities") if r[0] not in KEEP_ENT]
print('entities to delete',len(ents))
qa_contracts=[r[0] for r in c.execute("select id from contracts where contract_no like 'QA-%' or id in ('CON-f03715e7ab2445c5','CON-PSA-PSPCL-100MW')")]
print('extra contracts',len(qa_contracts))
delete_rows('entities',ents)
delete_rows('contracts',qa_contracts)
users=[r[0] for r in c.execute("select id from users where email like '%@datafix.invalid' or email in ('qa.member@sunrise-solar.in','qa.officer@sjvn.in')")]
delete_rows('users',users)
# test mails typed by hand during QA
roots=[r[0] for r in c.execute("select id from mail_messages where subject like 'Test%'")]
if roots:
    th=[r[0] for r in c.execute(f"select id from mail_messages where thread_id in ({q(roots)})",roots)]
    delete_rows('mail_messages',th)
# paths of uploaded files that go with removed document versions
import json
paths=[]
if 'file_path' in cols['document_versions']:
    ids=list(seen['document_versions'])
    for i in range(0,len(ids),500):
        b=ids[i:i+500]; paths+= [r[0] for r in c.execute(f"select file_path from document_versions where id in ({q(b)})",b)]
json.dump(paths,open('../tools/data-fixes/2026-10-18-removed-files.json','w'))
n=c.execute('select count(*) from notifications').fetchone()[0]; deleted['notifications(all, ephemeral)']+=n
n=c.execute('select count(*) from notification_deliveries').fetchone()[0]; deleted['notification_deliveries']+=n
if APPLY:
    c.execute('delete from notification_deliveries'); c.execute('delete from notifications')
print('--- ',('APPLIED' if APPLY else 'DRY RUN'))
for k,v in sorted(deleted.items(), key=lambda x:-x[1]): print(f'{k}: {v}')
if APPLY: c.commit()
else: c.rollback()
