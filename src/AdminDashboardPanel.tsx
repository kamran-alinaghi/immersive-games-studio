import { useEffect, useState, type FormEvent } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref } from 'firebase/storage';
import { ArrowLeft, Pencil, Users } from 'lucide-react';
import { db, functions, storage } from './firebase';

type Row = { id: string; [key: string]: any };
type AssignedPlayer = { id: string; playerId: string; playerName: string; status: string };
const call = <I, O,>(name: string) => httpsCallable<I, O>(functions, name);
const createQuest = call<any, any>('createQuest');
const assignQuest = call<any, any>('assignQuest');
const updateQuest = call<any, any>('updateQuest');
const reviewQuest = call<any, any>('reviewQuestSubmission');
const getQuestAssignments = call<{ questId: string }, { ok: boolean; players: AssignedPlayer[] }>('getQuestAssignmentsForAdmin');
const createTeam = call<any, any>('createTeam');
const assignPlayer = call<any, any>('assignPlayerToTeam');
const toggleTeam = call<any, any>('setTeamSuggestionsOpen');
const reviewSuggestion = call<any, any>('reviewTeamSuggestion');

function AdminDashboardPanel() {
  const [tab, setTab] = useState<'quests' | 'submissions' | 'teams' | 'suggestions'>('quests');
  const [quests, setQuests] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [teams, setTeams] = useState<Row[]>([]);
  const [suggestions, setSuggestions] = useState<Row[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questId, setQuestId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [selectedQuest, setSelectedQuest] = useState<Row | null>(null);
  const [assignedPlayers, setAssignedPlayers] = useState<AssignedPlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [editingQuest, setEditingQuest] = useState<Row | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');
    try {
      const [q, a, t, s] = await Promise.all([
        getDocs(query(collection(db, 'quests'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'questAssignments'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'teams')),
        getDocs(query(collection(db, 'teamSuggestions'), orderBy('createdAt', 'desc'))),
      ]);
      setQuests(q.docs.map(d => ({ id: d.id, ...d.data() })));
      setAssignments(a.docs.map(d => ({ id: d.id, ...d.data() })));
      setTeams(t.docs.map(d => ({ id: d.id, ...d.data() })));
      setSuggestions(s.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load dashboard management data.');
    }
  };

  useEffect(() => { void load(); }, []);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const onCreateQuest = async (e: FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const result = await createQuest({
        title,
        description,
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        maxFiles: 5,
        maxFileSizeBytes: 50 * 1024 * 1024,
      });
      setTitle('');
      setDescription('');
      return result;
    }, 'Quest created.');
  };

  const onAssign = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => assignQuest({ questId, playerId }), 'Quest assigned.');
  };

  const onCreateTeam = async (e: FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const result = await createTeam({ name: teamName });
      setTeamName('');
      return result;
    }, 'Team created.');
  };

  const onAssignPlayer = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => assignPlayer({ teamId, playerId }), 'Player assigned to team.');
  };

  const fileLink = async (path: string) => {
    try {
      window.location.assign(await getDownloadURL(ref(storage, path)));
    } catch {
      setError('Could not open evidence file.');
    }
  };

  const openQuestDetails = async (quest: Row) => {
    setSelectedQuest(quest);
    setAssignedPlayers([]);
    setLoadingPlayers(true);
    setError('');
    try {
      const result = await getQuestAssignments({ questId: quest.id });
      setAssignedPlayers(result.data.players ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load players assigned to this quest.');
    } finally {
      setLoadingPlayers(false);
    }
  };

  const openQuestEditor = (quest: Row) => {
    setEditingQuest(quest);
    setEditTitle(String(quest.title ?? ''));
    setEditDescription(String(quest.description ?? ''));
    setError('');
  };

  const saveQuest = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingQuest) return;
    if (!editTitle.trim() || !editDescription.trim()) {
      setError('Enter both a quest title and description.');
      return;
    }
    await run(async () => {
      await updateQuest({
        questId: editingQuest.id,
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setEditingQuest(null);
    }, 'Quest updated successfully.');
  };

  return <section className="admin-content dashboard-admin">
    {editingQuest ? <>
      <div className="quest-editor-heading">
        <button className="admin-quiet" type="button" onClick={() => setEditingQuest(null)}><ArrowLeft size={15} /> Back to quests</button>
        <p className="admin-eyebrow">QUEST MANAGEMENT · EDITING</p>
        <h1>Edit quest</h1>
        <p className="admin-muted">Update the information players see when this quest is assigned to them.</p>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <form className="quest-editor-card" onSubmit={saveQuest}>
        <label>Quest title<input required maxLength={120} value={editTitle} onChange={e => setEditTitle(e.target.value)} /></label>
        <label>Quest description<textarea required rows={12} maxLength={4000} value={editDescription} onChange={e => setEditDescription(e.target.value)} /></label>
        <div className="quest-editor-meta">
          <span>Quest ID: <strong>{editingQuest.id}</strong></span>
          <span className={editingQuest.active ? 'quest-active' : 'quest-inactive'}>{editingQuest.active ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="dashboard-actions">
          <button className="admin-secondary" type="button" onClick={() => setEditingQuest(null)} disabled={busy}>Cancel</button>
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </> : <>
      <div className="admin-heading">
        <div><p className="admin-eyebrow">PLAYER MANAGEMENT</p><h1>Quests &amp; Teams</h1><p className="admin-muted">Create individual quests, review evidence, and manage team membership.</p></div>
        <button className="admin-quiet" onClick={() => void load()}>Refresh</button>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <nav className="dashboard-tabs">{(['quests', 'submissions', 'teams', 'suggestions'] as const).map(x => <button key={x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{x === 'quests' ? 'Quests' : x === 'submissions' ? 'Submissions' : x === 'teams' ? 'Teams' : 'Team suggestions'}</button>)}</nav>
      {tab === 'quests' && <div className="dashboard-admin-grid">
        <form className="dashboard-admin-card" onSubmit={onCreateQuest}>
          <h2>Create a quest</h2>
          <label>Quest title<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Description<textarea required rows={5} value={description} onChange={e => setDescription(e.target.value)} /></label>
          <p className="admin-note">V1 accepts images, videos, PDF and Word documents. Maximum 5 files, 50 MB each.</p>
          <button className="admin-primary" disabled={busy}>Create quest</button>
        </form>
        <div className="dashboard-admin-card">
          <h2>Assign a quest</h2>
          <form onSubmit={onAssign}>
            <label>Quest<select required value={questId} onChange={e => setQuestId(e.target.value)}><option value="">Select quest</option>{quests.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}</select></label>
            <label>Player ID<input required placeholder="IGS-XXXXXX" value={playerId} onChange={e => setPlayerId(e.target.value.toUpperCase())} /></label>
            <button className="admin-primary" disabled={busy || !questId}>Assign quest</button>
          </form>
          <h3>Existing quests</h3>
          {quests.map(q => <article className="dashboard-admin-row quest-list-row" key={q.id}>
            <button type="button" className="quest-open-button" onClick={() => void openQuestDetails(q)}><strong>{q.title}</strong><small>{q.active ? 'Active' : 'Inactive'} · {q.id}</small></button>
            <div className="dashboard-actions">
              <button className="admin-link" type="button" onClick={() => openQuestEditor(q)}><Pencil size={13} /> Edit</button>
              <button className="admin-link" type="button" disabled={busy} onClick={() => void run(() => updateQuest({ questId: q.id, active: !q.active }), q.active ? 'Quest deactivated.' : 'Quest activated.')}>{q.active ? 'Deactivate' : 'Activate'}</button>
            </div>
          </article>)}
          {quests.length === 0 && <p className="admin-muted">No quests have been created yet.</p>}
        </div>
      </div>}
      {tab === 'submissions' && <div className="dashboard-admin-card">
        <h2>Quest submissions</h2>
        {assignments.length === 0 && <p className="admin-muted">No assignments yet.</p>}
        {assignments.map(a => <article className="dashboard-admin-row vertical" key={a.id}>
          <div><strong>{a.questTitle ?? 'Quest'} · {a.playerId ?? a.playerUid}</strong><small>Status: {a.status}</small>{a.feedback && <p>{a.feedback}</p>}</div>
          <div className="dashboard-file-list">{(a.files ?? []).map((f: any) => <button className="admin-link" key={f.path} onClick={() => void fileLink(f.path)}>{f.name}</button>)}</div>
          {['submitted', 'under_review', 'revision_required'].includes(a.status) && <div className="dashboard-actions">
            <button className="admin-primary" disabled={busy} onClick={() => void run(() => reviewQuest({ assignmentId: a.id, decision: 'under_review' }), 'Submission marked under review.')}>Under review</button>
            <button className="admin-primary" disabled={busy} onClick={() => { const feedback = window.prompt('Feedback for the player (required):'); if (feedback?.trim()) void run(() => reviewQuest({ assignmentId: a.id, decision: 'revision_required', feedback }), 'Revision requested.'); }}>Request revision</button>
            <button className="admin-primary" disabled={busy} onClick={() => void run(() => reviewQuest({ assignmentId: a.id, decision: 'approved' }), 'Quest approved.')}>Approve</button>
          </div>}
        </article>)}
      </div>}
      {tab === 'teams' && <div className="dashboard-admin-grid">
        <form className="dashboard-admin-card" onSubmit={onCreateTeam}><h2>Create a team</h2><label>Team name<input required value={teamName} onChange={e => setTeamName(e.target.value)} /></label><button className="admin-primary" disabled={busy}>Create team</button></form>
        <div className="dashboard-admin-card">
          <h2>Assign a player</h2>
          <form onSubmit={onAssignPlayer}><label>Team<select required value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">Select team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Player ID<input required placeholder="IGS-XXXXXX" value={playerId} onChange={e => setPlayerId(e.target.value.toUpperCase())} /></label><button className="admin-primary" disabled={busy || !teamId}>Add player to team</button></form>
          <h3>Teams</h3>
          {teams.map(t => <div className="dashboard-admin-row" key={t.id}><div><strong>{t.name}</strong><small>{(t.memberPlayerIds ?? []).length} members · suggestions {t.suggestionsOpen ? 'open' : 'closed'}</small><small>{(t.memberPlayerIds ?? []).join(', ')}</small></div><button className="admin-link" onClick={() => void run(() => toggleTeam({ teamId: t.id, open: !t.suggestionsOpen }), 'Team settings updated.')}>{t.suggestionsOpen ? 'Close suggestions' : 'Open suggestions'}</button></div>)}
        </div>
      </div>}
      {tab === 'suggestions' && <div className="dashboard-admin-card">
        <h2>Team suggestions</h2>
        {suggestions.length === 0 && <p className="admin-muted">No team suggestions.</p>}
        {suggestions.map(s => <article className="dashboard-admin-row vertical" key={s.id}>
          <div><strong>{s.suggestedByPlayerId} suggested {s.suggestedPlayerId} for {s.teamName}</strong><small>Status: {s.status}</small></div>
          {s.status === 'pending_admin' && <div className="dashboard-actions"><button className="admin-primary" disabled={busy} onClick={() => void run(() => reviewSuggestion({ suggestionId: s.id, decision: 'approve' }), 'Approved. Player B will receive the request in their portal.')}>Approve and send request</button><button className="admin-secondary" disabled={busy} onClick={() => void run(() => reviewSuggestion({ suggestionId: s.id, decision: 'reject' }), 'Suggestion rejected.')}>Reject</button></div>}
        </article>)}
      </div>}
    </>}
    {selectedQuest && !editingQuest && <div className="quest-details-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedQuest(null); }}>
      <section className="quest-details-dialog" role="dialog" aria-modal="true" aria-labelledby="quest-details-title">
        <div className="quest-details-header"><div><p className="admin-eyebrow">QUEST DETAILS</p><h2 id="quest-details-title">{selectedQuest.title}</h2></div><button className="admin-quiet" onClick={() => setSelectedQuest(null)}>Close</button></div>
        <p className="quest-details-description">{selectedQuest.description || 'No description provided.'}</p>
        <div className="quest-details-meta"><span>{selectedQuest.active ? 'Active' : 'Inactive'}</span><span>Quest ID: {selectedQuest.id}</span></div>
        <div className="quest-assignees-heading"><h3><Users size={17} /> Assigned players</h3><span>{assignedPlayers.length}</span></div>
        {loadingPlayers ? <p className="admin-muted">Loading assigned players…</p> : assignedPlayers.length === 0 ? <p className="admin-muted">No players are currently assigned to this quest.</p> : <div className="quest-assignees-list">
          {assignedPlayers.map(player => <div className="quest-assignee" key={player.id}><div><strong>{player.playerName}</strong><small>{player.playerId || 'Player ID unavailable'}</small></div><span className={'admin-badge ' + (player.status === 'approved' ? 'approved' : '')}>{player.status.replace(/_/g, ' ')}</span></div>)}
        </div>}
        <div className="dashboard-actions"><button className="admin-secondary" onClick={() => setSelectedQuest(null)}>Close</button><button className="admin-primary" onClick={() => { setSelectedQuest(null); openQuestEditor(selectedQuest); }}>Edit quest</button></div>
      </section>
    </div>}
  </section>;
}

export default AdminDashboardPanel;
