import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { PageHeader, Card, Tabs, Tab } from '../../components/ui.jsx';

const MODULES = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
    [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
    ['link', 'image'],
    ['clean']
  ],
};

const FORMATS = [
  'header',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'list', 'bullet', 'indent',
  'link', 'image'
];

// Stub hierarchical groups for Tree View selection
const RECIPIENT_GROUPS = [
  {
    id: 'portfolio',
    label: 'By Portfolio',
    children: [
      { id: 'client_sjvn', label: 'SJVN Limited (All Sites)' },
      { id: 'client_ntpc', label: 'NTPC (Selected Sites)' },
      { id: 'client_discom', label: 'State DISCOMs (Bulk)' }
    ]
  },
  {
    id: 'role',
    label: 'By Operational Role',
    children: [
      { id: 'role_trader', label: 'Trading Desk / Bidding Officers' },
      { id: 'role_plant', label: 'Plant Operators (Scheduling)' },
      { id: 'role_billing', label: 'Billing & Commercial' }
    ]
  },
  {
    id: 'region',
    label: 'By Regional Power Committee',
    children: [
      { id: 'reg_nrpc', label: 'NRPC (Northern)' },
      { id: 'reg_wrpc', label: 'WRPC (Western)' },
      { id: 'reg_srpc', label: 'SRPC (Southern)' }
    ]
  }
];

const TEMPLATES = [
  {
    id: 'format_d',
    label: 'Format-D Dispatch Notice',
    subject: 'Format-D Dispatch Instructions for {{delivery_date}}',
    body: '<p>Dear {{client_name}},</p><p>Please find attached the Format-D dispatch instructions for Delivery Date: <strong>{{delivery_date}}</strong>.</p><p>Ensure schedules are updated accordingly.</p><p>Regards,<br/>SJVN Trading Desk</p>'
  },
  {
    id: 'gate_closure',
    label: 'Gate Closure Reminder',
    subject: 'URGENT: Gate Closure Warning for RTM',
    body: '<p><strong>URGENT NOTIFICATION</strong></p><p>This is a reminder that the gate closure for the upcoming RTM session is approaching in 15 minutes.</p><p>Please finalize all bids for {{contract_id}} immediately.</p>'
  },
  {
    id: 'monthly_settlement',
    label: 'Monthly Settlement Summary',
    subject: 'Monthly Settlement Summary - {{month_year}}',
    body: '<p>Dear {{client_name}},</p><p>The provisional settlement statement for the month of {{month_year}} has been generated.</p><p>Please review the attached summaries and raise any disputes within 7 days.</p>'
  }
];

function TreeCheckbox({ node, selected, toggle }) {
  const isChecked = selected.includes(node.id);
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginLeft: 20, marginTop: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {node.children && (
          <button 
            type="button" 
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: 15 }}
          >
            {expanded ? '[-]' : '[+]'}
            <span className="sr-only">{expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}</span>
          </button>
        )}
        {!node.children && <span style={{ width: 15 }}></span>}
        <input
          type="checkbox"
          aria-label={`Send to ${node.label}`}
          checked={isChecked}
          onChange={() => toggle(node.id)}
        />
        <span>{node.label}</span>
      </div>
      {expanded && node.children && (
        <div style={{ borderLeft: '1px dashed #ccc', marginLeft: 8 }}>
          {node.children.map(child => (
            <TreeCheckbox key={child.id} node={child} selected={selected} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BulkCommunications() {
  const [activeTab, setActiveTab] = useState('compose');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [files, setFiles] = useState([]);
  const [channels, setChannels] = useState({ email: true, inApp: true });
  const [isSending, setIsSending] = useState(false);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (activeTab === 'log') {
      fetchLogs();
    }
  }, [activeTab]);

  async function fetchLogs() {
    try {
      setLogs(await api.communications.logs());
    } catch (err) {
      console.error('Failed to fetch logs', err);
    }
  }

  function toggleGroup(id) {
    setSelectedGroups(prev => 
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  }

  function selectAllInCategory(categoryId) {
    const category = RECIPIENT_GROUPS.find(g => g.id === categoryId);
    if (!category) return;
    const allChildIds = category.children.map(c => c.id);
    setSelectedGroups(prev => {
      const set = new Set([...prev, ...allChildIds]);
      return Array.from(set);
    });
  }

  function handleTemplateSelect(e) {
    const tmplId = e.target.value;
    if (!tmplId) return;
    const tmpl = TEMPLATES.find(t => t.id === tmplId);
    if (tmpl) {
      setSubject(tmpl.subject);
      setBodyHtml(tmpl.body);
    }
  }

  function handleFileChange(e) {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!subject.trim() || !bodyHtml.trim() || selectedGroups.length === 0) {
      alert("Please fill in the subject, message body, and select at least one recipient group.");
      return;
    }
    if (!channels.email && !channels.inApp) {
      alert("Please select at least one dispatch channel (Email or In-App).");
      return;
    }

    const formData = new FormData();
    formData.append('subject', subject);
    formData.append('body_html', bodyHtml);
    formData.append('target_groups', JSON.stringify(selectedGroups));
    
    const activeChannels = [];
    if (channels.email) activeChannels.push('email');
    if (channels.inApp) activeChannels.push('in_app');
    formData.append('channels', JSON.stringify(activeChannels));
    
    files.forEach(file => {
      formData.append('files', file);
    });

    setIsSending(true);
    try {
      await api.communications.broadcast(formData);

      // The row is written to communication_logs and, for the in-app channel,
      // to broadcast_messages — but the API only logs the email step, it does not
      // call mailService yet. Saying "dispatched" would have finance believing
      // counterparties were mailed.
      alert(
        'Broadcast recorded.\n\n'
        + (channels.inApp ? 'In-app: posted to the notification board.\n' : '')
        + (channels.email ? 'Email: NOT sent — outbound mail is not wired to this screen yet; the message is logged only.\n' : '')
      );
      setSubject('');
      setBodyHtml('');
      setSelectedGroups([]);
      setFiles([]);
      setChannels({ email: true, inApp: true });
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Error sending broadcast');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader title="Client Bulk Communication Hub" />
      
      <Tabs style={{ marginTop: 20 }}>
        <Tab active={activeTab === 'compose'} onClick={() => setActiveTab('compose')}>Compose Broadcast</Tab>
        <Tab active={activeTab === 'log'} onClick={() => setActiveTab('log')}>Communication Log</Tab>
      </Tabs>

      {activeTab === 'compose' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, marginTop: 20 }}>
          
          {/* Left Sidebar: Recipient Group Selector */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Recipient Groups</h3>
            </div>
            
            <div style={{ marginBottom: 15, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => selectAllInCategory('portfolio')}>Select All Portfolios</button>
              <button className="btn btn-sm" onClick={() => selectAllInCategory('role')}>Select All Roles</button>
              <button className="btn btn-sm" onClick={() => selectAllInCategory('region')}>Select All Regions</button>
              <button className="btn btn-sm" style={{ background: '#f5f5f5', color: '#333' }} onClick={() => setSelectedGroups([])}>Clear All</button>
            </div>

            <div style={{ maxHeight: '500px', overflowY: 'auto', borderTop: '1px solid #eee', paddingTop: 10 }}>
              {RECIPIENT_GROUPS.map(group => (
                <TreeCheckbox key={group.id} node={group} selected={selectedGroups} toggle={toggleGroup} />
              ))}
            </div>
          </Card>

          {/* Right Panel: Composition */}
          <Card>
            <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              
              <div style={{ background: '#f9f9f9', padding: 15, borderRadius: 6, border: '1px solid #e0e0e0' }}>
                <label style={{ display: 'block', marginBottom: 5, fontWeight: 600 }} htmlFor="bulkcommunications-load-from-template">Load from Template:</label>
                <select id="bulkcommunications-load-from-template" className="input" onChange={handleTemplateSelect} defaultValue="">
                  <option value="" disabled>-- Select a Template --</option>
                  {TEMPLATES.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 5, fontWeight: 600 }} htmlFor="bulkcommunications-subject">Subject:</label>
                <input id="bulkcommunications-subject" 
                  type="text" 
                  className="input" 
                  style={{ width: '100%' }}
                  value={subject} 
                  onChange={e => setSubject(e.target.value)}
                  placeholder="e.g., URGENT: Gate Closure Warning for RTM - NRPC Region"
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: 5, fontWeight: 600 }} htmlFor="bulkcommunications-attachments">Attachments:</label>
                <input id="bulkcommunications-attachments" 
                  type="file" 
                  multiple
                  onChange={handleFileChange}
                  className="input"
                />
                {files.length > 0 && (
                  <div style={{ marginTop: 5, fontSize: 12, color: '#666' }}>
                    {files.length} file(s) selected
                  </div>
                )}
              </div>

              <div>
                <span id="broadcast-body-label" style={{ display: 'block', marginBottom: 5, fontWeight: 600 }}>Message Body:</span>
                {/* Quill renders a contenteditable, not a form control, so a
                    <label htmlFor> has nothing to bind to — the region carries
                    the name instead. */}
                <div role="group" aria-labelledby="broadcast-body-label" style={{ height: 300, marginBottom: 50 }}>
                  <ReactQuill 
                    theme="snow" 
                    value={bodyHtml} 
                    onChange={setBodyHtml}
                    modules={MODULES}
                    formats={FORMATS}
                    style={{ height: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 20, background: '#f5f5f5', padding: 15, borderRadius: 6 }}>
                <strong>Dispatch Channels:</strong>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={channels.email} onChange={e => setChannels(p => ({ ...p, email: e.target.checked }))} />
                  Send via Email
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={channels.inApp} onChange={e => setChannels(p => ({ ...p, inApp: e.target.checked }))} />
                  Send In-App Notification (Dashboard Alert)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 5 }}>
                <button type="submit" className="btn btn-primary" disabled={isSending}>
                  {isSending ? 'Sending...' : 'Send Broadcast'}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {activeTab === 'log' && (
        <Card style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 15 }}>Communication Audit Log</h3>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th scope="col">Sent At</th>
                <th scope="col">Subject</th>
                <th scope="col">Sender</th>
                <th scope="col">Channels</th>
                <th scope="col">Recipients (Groups)</th>
                <th scope="col">Attachments</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: 20 }}>No broadcasts found.</td>
                </tr>
              ) : (
                logs.map(log => {
                  let channels = [];
                  try { channels = JSON.parse(log.channels || '["email"]'); } catch(e){}
                  let targetGroups = [];
                  try { targetGroups = JSON.parse(log.target_groups || '[]'); } catch(e){}
                  let attachments = [];
                  try { attachments = JSON.parse(log.attachment_paths || '[]'); } catch(e){}

                  return (
                    <tr key={log.id}>
                      <td>{new Date(log.sent_at).toLocaleString()}</td>
                      <td style={{ fontWeight: 500 }}>{log.subject}</td>
                      <td>{log.sender_name || log.sender_id}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {channels.map(ch => (
                            <span key={ch} style={{ background: '#eee', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
                              {ch}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{targetGroups.length} group(s) selected</td>
                      <td>{attachments.length} file(s)</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
