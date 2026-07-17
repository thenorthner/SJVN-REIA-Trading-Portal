import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import client from '../../api/client';
import { Modal, Field, Badge } from '../../components/ui';

export default function Team() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: '' });

  const isSuperAdmin = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN'].includes(user.role);
  const isCompanyAdmin = ['SELLER', 'BUYER', 'SELLER_L3', 'BUYER_L3'].includes(user.role);
  const canAdd = isSuperAdmin || isCompanyAdmin;

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const data = await client.users.list();
    setUsers(data);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await client.users.create(form);
      setShowAdd(false);
      setForm({ name: '', email: '', password: '', role: '' });
      loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create user');
    }
  };

  const toggleStatus = async (u) => {
    try {
      await client.users.updateStatus(u.id, u.is_active ? 0 : 1);
      loadUsers();
    } catch (err) {
      alert('Failed to update status');
    }
  };

  return (
    <div>
      <div className="flex-between align-center mb-24">
        <h1>Team Management</h1>
        {canAdd && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Add Team Member
          </button>
        )}
      </div>

      <div className="card table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined Date</th>
              {canAdd && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan="6" className="text-center text-light py-24">No team members found</td></tr>
            ) : users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td><Badge status={u.role} /></td>
                <td><Badge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                {canAdd && (
                  <td className="text-right">
                    <button 
                      className="btn btn-sm btn-outline" 
                      onClick={() => toggleStatus(u)}
                      disabled={u.id === user.id}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Team Member" width={400}>
        <form onSubmit={handleAdd}>
          <Field label="Full Name">
            <input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          </Field>
          <Field label="Email Address">
            <input required type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          </Field>
          <Field label="Password">
            <input required type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
          </Field>
          <Field label="Role">
            <select required value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
              <option value="">Select Role</option>
              {user.role.startsWith('SELLER') ? (
                <>
                  <option value="SELLER_L1">Level 1 (Maker)</option>
                  <option value="SELLER_L2">Level 2 (Checker)</option>
                </>
              ) : user.role.startsWith('BUYER') ? (
                <>
                  <option value="BUYER_L1">Level 1 (Maker)</option>
                  <option value="BUYER_L2">Level 2 (Checker)</option>
                </>
              ) : (
                <>
                  <option value="SELLER_L1">Seller Level 1</option>
                  <option value="SELLER_L2">Seller Level 2</option>
                  <option value="BUYER_L1">Buyer Level 1</option>
                  <option value="BUYER_L2">Buyer Level 2</option>
                </>
              )}
            </select>
          </Field>
          <div className="form-actions mt-24">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create User</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
