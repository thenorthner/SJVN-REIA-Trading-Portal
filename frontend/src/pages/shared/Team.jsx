import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import client from '../../api/client';
import { PageHeader, Card, Table, Modal, Field, Badge } from '../../components/ui';
import { fmtDate } from '../../datetime.js';

const ROLE_LABELS = {
  SELLER: 'Company Admin',
  BUYER: 'Company Admin',
  SELLER_L1: 'Level 1 (Maker)',
  SELLER_L2: 'Level 2 (Checker)',
  SELLER_L3: 'Level 3 (Approver)',
  BUYER_L1: 'Level 1 (Maker)',
  BUYER_L2: 'Level 2 (Checker)',
  BUYER_L3: 'Level 3 (Approver)',
};

export default function Team() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: '' });

  const isSuperAdmin = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN'].includes(user.role);
  const isCompanyAdmin = ['SELLER', 'BUYER', 'SELLER_L3', 'BUYER_L3'].includes(user.role);
  const canAdd = isSuperAdmin || isCompanyAdmin;

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      setUsers(await client.users.list());
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await client.users.create(form);
      setShowAdd(false);
      setForm({ name: '', email: '', password: '', role: '' });
      loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (u) => {
    try {
      await client.users.updateStatus(u.id, u.is_active ? 0 : 1);
      loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const roleOptions = user.role.startsWith('SELLER')
    ? [
        { value: 'SELLER_L1', label: 'Level 1 (Maker) — prepares invoices' },
        { value: 'SELLER_L2', label: 'Level 2 (Checker) — approves and submits to SJVN' },
      ]
    : user.role.startsWith('BUYER')
      ? [
          { value: 'BUYER_L1', label: 'Level 1 (Maker) — prepares submissions' },
          { value: 'BUYER_L2', label: 'Level 2 (Checker) — approves and submits to SJVN' },
        ]
      : [
          { value: 'SELLER_L1', label: 'Seller Level 1 (Maker)' },
          { value: 'SELLER_L2', label: 'Seller Level 2 (Checker)' },
          { value: 'BUYER_L1', label: 'Buyer Level 1 (Maker)' },
          { value: 'BUYER_L2', label: 'Buyer Level 2 (Checker)' },
        ];

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600 }}>{u.name}</div>
          {u.id === user.id && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>You</div>}
        </div>
      ),
    },
    { key: 'email', header: 'Email' },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <div>
          <Badge status={u.role} />
          {ROLE_LABELS[u.role] && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{ROLE_LABELS[u.role]}</div>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (u) => <Badge status={u.is_active ? 'ACTIVE' : 'CANCELLED'} label={u.is_active ? 'Active' : 'Inactive'} /> },
    { key: 'created_at', header: 'Joined', render: (u) => fmtDate(u.created_at) },
    ...(canAdd
      ? [
          {
            key: 'actions',
            header: 'Actions',
            render: (u) => (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => toggleStatus(u)}
                disabled={u.id === user.id}
                title={u.id === user.id ? 'You cannot deactivate your own account' : undefined}
              >
                {u.is_active ? 'Deactivate' : 'Activate'}
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Team Management"
        subtitle="Manage the users in your organisation and their maker-checker access levels"
        actions={canAdd && (
          <button className="btn btn-primary" onClick={() => { setError(''); setShowAdd(true); }}>
            + Add Team Member
          </button>
        )}
      />

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : users}
          emptyMessage={loading ? 'Loading team...' : 'No team members found.'}
        />
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Team Member" width={460}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleAdd}>
          <Field label="Full Name">
            <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email Address">
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password">
            <input
              required
              type="password"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <p className="inline-note" style={{ marginTop: 4 }}>Minimum 6 characters. The user can change it after first login.</p>
          </Field>
          <Field label="Access Level">
            <select required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="">Select access level...</option>
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="inline-note" style={{ marginTop: 4 }}>
              Makers prepare and submit documents; Checkers review and forward them to SJVN.
            </p>
          </Field>
          <div className="form-actions mt-24">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
