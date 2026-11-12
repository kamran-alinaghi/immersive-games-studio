import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, getDocs, orderBy, query, type DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, LogOut, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { auth, db, functions } from './firebase';
import './admin.css';
import AdminDashboardPanel from './AdminDashboardPanel';

type Status = 'new' | 'under_review' | 'approved' | 'rejected' | 'contacted';
type Applicant = DocumentData & { id: string; fullName?: string; email?: string; status?: Status; createdAt?: { toDate?: () => Date } };
const statuses: Status[] = ['new', 'under_review', 'approved', 'rejected', 'contacted'];
const labels: Record<Status, string> = { new: 'New', under_review: 'Under Review', approved: 'Approved', rejected: 'Rejected', contacted: 'Contacted' };
const updateApplicantStatus = httpsCallable<{ registrationId: string; status: Exclude<Status, 'approved'> }, { ok: boolean }>(functions, 'updateRegistrationStatus');
const approveApplicant = httpsCallable<{ registrationId: string }, { ok: boolean; playerId: string; alreadyApproved: boolean; emailSent: boolean; emailSkipped?: boolean }>(functions, 'approveRegistration');
const deletePlayerAccount = httpsCallable<{ registrationId: string }, { ok: boolean; playerId: string }>(functions, 'deletePlayerAccount');

function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'applications' | 'dashboard'>('applications');
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [selected, setSelected] = useState<Applicant | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');
  const [approvingId, setApprovingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [deleteConfirmationStep, setDeleteConfirmationStep] = useState<0 | 1 | 2>(0);
  const [approvalMessage, setApprovalMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, current => { setUser(current); setAuthReady(true); }), []);
  const loadApplicants = async () => {
    setLoading(true); setError('');
    try {
      const snapshot = await getDocs(query(collection(db, 'registrations'), orderBy('createdAt', 'desc')));
      setApplicants(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Applicant)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load applications. Check administrator access and Firestore rules.');
    } finally { setLoading(false); }
  };
  useEffect(() => { if (user) void loadApplicants(); }, [user]);

  const visible = useMemo(() => applicants.filter(item => {
    const matchesStatus = filter === 'all' || (item.status ?? 'new') === filter;
    const needle = search.trim().toLowerCase();
    return matchesStatus && (!needle || (item.fullName ?? '').toLowerCase().includes(needle) || (item.email ?? '').toLowerCase().includes(needle));
  }), [applicants, filter, search]);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setLoginError('');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); setPassword(''); }
    catch { setLoginError('Sign-in failed. Check your email and password, and confirm this account is enabled in Firebase Authentication.'); }
  };
  const changeStatus = async (applicant: Applicant, status: Exclude<Status, 'approved'>) => {
    setSavingId(applicant.id); setError('');
    try {
      await updateApplicantStatus({ registrationId: applicant.id, status });
      setApplicants(current => current.map(item => item.id === applicant.id ? { ...item, status } : item));
      setSelected(current => current?.id === applicant.id ? { ...current, status } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed. Verify administrator permissions.');
    } finally { setSavingId(''); }
  };

  const deleteSelectedApplicant = async () => {
    if (!selected || deletingId || deleteConfirmationStep !== 2) return;

    setDeletingId(selected.id);
    setError('');
    setApprovalMessage('');
    try {
      await deletePlayerAccount({ registrationId: selected.id });
      setApplicants(current => current.filter(item => item.id !== selected.id));
      setSelected(null);
      setDeleteConfirmationStep(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account deletion failed. You can safely retry this operation.');
    } finally {
      setDeletingId('');
    }
  };

  const approveSelectedApplicant = async () => {
    if (!selected || approvingId) return;
    const isResend = selected.status === 'approved';
    const confirmed = window.confirm(isResend
      ? `Retry the approval email for ${selected.email || 'this player'}? The existing Player ID will be kept.`
      : `Approve ${selected.fullName || 'this applicant'} and assign a permanent Player ID? This action cannot be undone.`);
    if (!confirmed) return;

    setApprovingId(selected.id);
    setError('');
    setApprovalMessage('');
    try {
      const result = await approveApplicant({ registrationId: selected.id });
      const { playerId, emailSent, emailSkipped } = result.data;
      const updated = { ...selected, status: 'approved' as Status, playerId };
      setApplicants(current => current.map(item => item.id === selected.id ? updated : item));
      setSelected(updated);
      setApprovalMessage(emailSent
        ? `Approval email sent. Player ID: ${playerId}`
        : emailSkipped
          ? `Player ID ${playerId} is saved. The local player account was created. The emulator skipped real email delivery; use the player portal's password reset option to test password setup locally.`
          : `Player ID ${playerId} is saved, but account setup or email delivery failed. You can retry this action.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed. Verify administrator permissions.');
    } finally {
      setApprovingId('');
    }
  };

  if (!authReady) return <main className="admin-page"><p>Checking session…</p></main>;
  if (!user) return <main className="admin-page"><section className="admin-login">
    <a className="admin-back" href="#top"><ArrowLeft size={15}/> Public website</a>
    <div className="admin-mark"><ShieldCheck size={25}/></div><p className="admin-eyebrow">IMMERSIVE GAMES STUDIO</p>
    <h1>Administrator sign in</h1><p className="admin-muted">This area is restricted to authorized administrators.</p>
    <form onSubmit={login}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label>
      {loginError && <p className="admin-error" role="alert">{loginError}</p>}
      <button className="admin-primary" type="submit">Sign in</button>
    </form>
  </section></main>;

  if (view === 'dashboard') return <main className="admin-page">
    <header className="admin-header"><a href="#top" className="admin-brand">IMMERSIVE GAMES <em>STUDIO</em></a><div><button className="admin-quiet" onClick={() => setView('applications')}>Applications</button><span>{user.email}</span><button className="admin-quiet" onClick={() => void signOut(auth)}><LogOut size={15}/> Sign out</button></div></header>
    <AdminDashboardPanel />
  </main>;

  const counts = statuses.reduce((acc, status) => ({ ...acc, [status]: applicants.filter(item => (item.status ?? 'new') === status).length }), {} as Record<Status, number>);
  const formatDate = (value: Applicant['createdAt']) => value?.toDate ? value.toDate().toLocaleString() : '—';
  return <main className="admin-page">
    <header className="admin-header"><a href="#top" className="admin-brand">IMMERSIVE GAMES <em>STUDIO</em></a><div><button className="admin-quiet" onClick={() => setView("dashboard")}>Quests &amp; Teams</button><span>{user.email}</span><button className="admin-quiet" onClick={() => signOut(auth)}><LogOut size={15}/> Sign out</button></div></header>
    <section className="admin-content">
      <div className="admin-heading"><div><p className="admin-eyebrow">ADMINISTRATION</p><h1>Applications</h1><p className="admin-muted">Review and manage registration submissions.</p></div><button className="admin-quiet" onClick={() => void loadApplicants()} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
      <div className="admin-stats">{statuses.map(status => <button key={status} className={filter === status ? 'admin-stat active' : 'admin-stat'} onClick={() => setFilter(filter === status ? 'all' : status)}><strong>{counts[status]}</strong><span>{labels[status]}</span></button>)}</div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-toolbar"><label className="admin-search"><Search size={16}/><input placeholder="Search name or email" value={search} onChange={e => setSearch(e.target.value)}/></label><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option>{statuses.filter(s => s !== 'approved').map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Applicant</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>
        {visible.map(item => <tr key={item.id}><td><strong>{item.fullName || 'Unnamed applicant'}</strong><small>{item.email || 'No email'}</small></td><td>{formatDate(item.createdAt)}</td><td><span className={`admin-badge ${item.status ?? 'new'}`}>{labels[item.status ?? 'new']}</span></td><td><button className="admin-link" onClick={() => setSelected(item)}>Review</button></td></tr>)}
        {!loading && visible.length === 0 && <tr><td colSpan={4} className="admin-empty">No applications match your search.</td></tr>}
      </tbody></table>{loading && <p className="admin-muted admin-loading">Loading applications…</p>}</div>
    </section>
    {selected && <div className="admin-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="admin-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="admin-detail-head"><div><p className="admin-eyebrow">APPLICATION REVIEW</p><h2 id="detail-title">{selected.fullName || 'Applicant details'}</h2></div><button className="admin-quiet" onClick={() => setSelected(null)}>Close</button></div>
      <div className="admin-status-control"><label htmlFor="app-status">Application status</label><select id="app-status" value={selected.status ?? 'new'} disabled={savingId === selected.id} onChange={e => void changeStatus(selected, e.target.value as Exclude<Status, 'approved'>)}>{statuses.map(s => <option key={s} value={s} disabled={s === 'approved'}>{labels[s]}</option>)}</select>{savingId === selected.id && <small>Saving…</small>}</div>
      <div className="admin-answers">{Object.entries(selected).filter(([key]) => key !== 'id' && key !== 'createdAt' && key !== 'status' && key !== 'reviewedAt' && key !== 'reviewedBy').map(([key, value]) => <div key={key}><strong>{key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</strong><p>{Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</p></div>)}<div><strong>Submitted</strong><p>{formatDate(selected.createdAt)}</p></div></div>
      {approvalMessage && <p className="admin-success" role="status">{approvalMessage}</p>}
      {selected.status === 'approved' && <div className="admin-player-id"><strong>Player ID</strong><p>{selected.playerId || 'No Player ID recorded'}</p></div>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="admin-danger" type="button" onClick={() => setDeleteConfirmationStep(1)} disabled={deletingId === selected.id || approvingId === selected.id || savingId === selected.id}><Trash2 size={15}/>Delete player account</button>
      {selected.status === 'approved' ? <button className="admin-primary" type="button" onClick={() => void approveSelectedApplicant()} disabled={approvingId === selected.id || savingId === selected.id}>{approvingId === selected.id ? 'Sending…' : 'Retry Approval Email'}</button> : <button className="admin-primary" type="button" onClick={() => void approveSelectedApplicant()} disabled={approvingId === selected.id || savingId === selected.id || selected.status === 'rejected'}>{approvingId === selected.id ? 'Approving…' : 'Approve Applicant'}</button>}
    </section></div>}
    {deleteConfirmationStep > 0 && selected && <div className="delete-confirm-overlay" role="presentation">
      <section className="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-description">
        <div className="delete-confirm-icon"><Trash2 size={25}/></div>
        <p className="delete-confirm-eyebrow">PERMANENT ACCOUNT DELETION · STEP {deleteConfirmationStep} OF 2</p>
        <h2 id="delete-confirm-title">{deleteConfirmationStep === 1 ? 'Are you sure?' : 'This is your final confirmation.'}</h2>
        <p id="delete-confirm-description">{deleteConfirmationStep === 1
          ? `You are about to permanently delete ${selected.fullName || selected.email || 'this player'}'s account and associated data, including their login, Player ID, team membership, quest submissions, and uploaded files.`
          : `You are about to permanently erase ${selected.fullName || selected.email || 'this player'}'s account. This cannot be undone. Their email and Player ID will become available for a new registration.`}</p>
        <div className="delete-confirm-warning">This action is permanent. Please make sure you have selected the correct player.</div>
        {error && <p className="delete-confirm-error" role="alert">{error}</p>}
        <div className="delete-confirm-actions">
          <button type="button" className="delete-confirm-cancel" onClick={() => setDeleteConfirmationStep(0)} disabled={!!deletingId}>Cancel</button>
          {deleteConfirmationStep === 1
            ? <button type="button" className="delete-confirm-continue" onClick={() => setDeleteConfirmationStep(2)}>Continue to final confirmation</button>
            : <button type="button" className="delete-confirm-final" onClick={() => void deleteSelectedApplicant()} disabled={!!deletingId}>{deletingId ? 'Deleting account…' : 'Yes, permanently delete'}</button>}
        </div>
      </section>
    </div>}
  </main>;
}
export default AdminApp;
