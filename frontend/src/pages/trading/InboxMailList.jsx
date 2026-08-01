import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card } from '../../components/ui.jsx';
import { useNavigate } from 'react-router-dom';

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
          </button>
        )}
        {!node.children && <span style={{ width: 15 }}></span>}
        <input 
          type="checkbox" 
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

export default function InboxMailList() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => {
    fetchInbox();
  }, []);

  async function fetchInbox() {
    try {
      setMessages(await api.communications.inbox());
    } catch (err) {
      console.error('Failed to fetch inbox', err);
    }
  }

  function toggleGroup(id) {
    setSelectedGroups(prev => 
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  }

  function toggleMessageSelection(id) {
    setSelectedMessages(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  }

  async function handleDelete() {
    if (selectedMessages.length === 0) return;
    if (!window.confirm(`Delete ${selectedMessages.length} message(s)?`)) return;

    try {
      for (const msgId of selectedMessages) {
        await api.communications.hide(msgId);
      }
      setSelectedMessages([]);
      fetchInbox(); // Refresh
    } catch (error) {
      console.error('Delete error', error);
      alert('Error hiding messages');
    }
  }

  const filteredMessages = messages.filter(msg => {
    if (searchQuery && !msg.subject.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterDate && !msg.sent_at.startsWith(filterDate)) return false;
    
    // In a real scenario, this would filter based on actual user mapping.
    // Here we filter by selected target_groups locally for demo purposes.
    if (selectedGroups.length > 0) {
      let targets = [];
      try { targets = JSON.parse(msg.target_groups || '[]'); } catch(e){}
      const intersects = selectedGroups.some(g => targets.includes(g));
      if (!intersects) return false;
    }
    return true;
  });

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader title="INBOX MAIL LIST" />

      {/* Top Action Bar */}
      <Card style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => navigate('/trading/bulk-communications')}>[ New Mail ]</button>
          <button className="btn" style={{ background: '#fff', border: '1px solid #ccc' }} onClick={() => fetchInbox()}>[ Inbox ]</button>
          <button className="btn" style={{ background: '#fff', border: '1px solid #ccc' }} onClick={() => navigate('/trading/bulk-communications')}>[ Sent Mail ]</button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={selectedMessages.length === 0}>[ Delete ]</button>
        </div>
        
        <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <strong>Date:</strong>
            <input type="date" className="input" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          </div>
          <input 
            type="text" 
            className="input" 
            placeholder="Search Subject..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button className="btn" style={{ background: '#fff', border: '1px solid #ccc' }} onClick={() => {}}>[ Search ]</button>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        
        {/* Left Sidebar: Group Filter */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Group Filters</h3>
          </div>
          <div style={{ fontSize: 12, marginBottom: 10, color: '#666' }}>
            <span style={{ cursor: 'pointer', color: 'blue' }} onClick={() => { /* expand all */ }}>Open all</span> | <span style={{ cursor: 'pointer', color: 'blue' }} onClick={() => { /* collapse all */ }}>Close all</span>
          </div>
          <p style={{ fontSize: 13, color: '#555' }}>Groups are shown below:</p>
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {RECIPIENT_GROUPS.map(group => (
              <TreeCheckbox key={group.id} node={group} selected={selectedGroups} toggle={toggleGroup} />
            ))}
          </div>
        </Card>

        {/* Right Panel: Data Grid */}
        <Card>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: '#e9ecef' }}>
                <th scope="col" style={{ width: 40 }}><input type="checkbox" onChange={e => setSelectedMessages(e.target.checked ? filteredMessages.map(m=>m.id) : [])} checked={filteredMessages.length > 0 && selectedMessages.length === filteredMessages.length} /></th>
                <th scope="col">Subject</th>
                <th scope="col">Sender</th>
                <th scope="col">Date</th>
                <th scope="col" style={{ textAlign: 'center' }}>Attachments</th>
              </tr>
            </thead>
            <tbody>
              {filteredMessages.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                    Nothing found to display.
                  </td>
                </tr>
              ) : (
                filteredMessages.map(msg => {
                  let attachments = [];
                  try { attachments = JSON.parse(msg.attachment_paths || '[]'); } catch(e){}
                  const isExpanded = expandedRow === msg.id;

                  return (
                    <React.Fragment key={msg.id}>
                      <tr style={{ cursor: 'pointer', background: isExpanded ? '#f0f8ff' : '#fff' }}>
                        <td><input type="checkbox" checked={selectedMessages.includes(msg.id)} onChange={() => toggleMessageSelection(msg.id)} /></td>
                        <td onClick={() => setExpandedRow(isExpanded ? null : msg.id)} style={{ fontWeight: 500, color: '#0056b3' }}>
                          {msg.subject}
                        </td>
                        <td onClick={() => setExpandedRow(isExpanded ? null : msg.id)}>{msg.sender_name || msg.sender_id}</td>
                        <td onClick={() => setExpandedRow(isExpanded ? null : msg.id)}>{msg.sent_at.substring(0, 10)}</td>
                        <td style={{ textAlign: 'center' }} onClick={() => setExpandedRow(isExpanded ? null : msg.id)}>
                          {attachments.length > 0 ? '📎' : ''}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan="5" style={{ padding: 0 }}>
                            <div style={{ padding: '20px 40px', background: '#f8f9fa', borderBottom: '1px solid #ddd' }}>
                              <div dangerouslySetInnerHTML={{ __html: msg.body_html }} style={{ background: '#fff', padding: 15, borderRadius: 4, border: '1px solid #e0e0e0', minHeight: 100 }} />
                              {attachments.length > 0 && (
                                <div style={{ marginTop: 15 }}>
                                  <strong>Attachments:</strong>
                                  <ul style={{ paddingLeft: 20, marginTop: 5 }}>
                                    {attachments.map((path, idx) => (
                                      <li key={idx}>
                                        <a href={path} target="_blank" rel="noreferrer" style={{ color: '#0056b3' }}>Download File {idx + 1}</a>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
