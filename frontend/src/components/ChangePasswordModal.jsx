import React, { useState } from 'react';
import { Modal, Field } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Self-service password change, reachable from the profile menu in every portal.
 *
 * The confirmation field is checked here so an obvious typo does not cost a
 * round trip; everything else — whether the current password is right, whether
 * the new one is strong enough — is the server's answer, shown as it came back.
 */
export default function ChangePasswordModal({ open, onClose, forced = false }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  function close() {
    setCurrent(''); setNext(''); setConfirm('');
    setError(null); setDone(false); setSaving(false);
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) { setError('The two new-password fields do not match.'); return; }
    setSaving(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not change the password. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={forced && !done ? () => {} : close} title={forced ? 'Choose your own password' : 'Change Password'} width={440}>
      {forced && !done && (
        <div className="alert alert-warning" role="alert" style={{ marginBottom: 12 }}>
          Your password was issued by your administrator. Choose one only you know before going further. The current password is the one you just signed in with.
        </div>
      )}
      {done ? (
        <div>
          <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}>
            Password changed. Use the new one the next time you sign in.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={close}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          {error && (
            <div className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}>{error}</div>
          )}
          <Field label="Current Password" required>
            <input
              type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus
            />
          </Field>
          <Field label="New Password" required>
            <input
              type="password" autoComplete="new-password"
              value={next} onChange={(e) => setNext(e.target.value)} required minLength={8}
            />
          </Field>
          <Field label="Confirm New Password" required>
            <input
              type="password" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8}
            />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>
            At least 8 characters, with a letter and a digit.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            {!forced && <button type="button" className="btn btn-outline" onClick={close} disabled={saving}>Cancel</button>}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Change Password'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
