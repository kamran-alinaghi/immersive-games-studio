import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { ArrowLeft, FileText, LogOut, ShieldCheck, Upload, Users } from 'lucide-react';
import { auth, db, functions, storage } from './firebase';
import './admin.css';

type PlayerProfile = { fullName?: string; email?: string; playerId?: string; status?: string; teamId?: string; teamName?: string };
type Quest = { id: string; questId: string; questTitle?: string; questDescription?: string; status: string; files?: {name:string;path:string;contentType:string;size:number}[]; feedback?:string; };
type Team = { id:string; name:string; memberUids?:string[]; memberPlayerIds?:string[]; suggestionsOpen?:boolean };
type Suggestion = { id:string; teamName?:string; suggestedByPlayerId?:string; status:string };
const resolvePlayerLogin = httpsCallable<{playerId:string},{email:string}>(functions,'resolvePlayerLogin');
const recordSubmission = httpsCallable<{assignmentId:string;files:{name:string;path:string;contentType:string;size:number}[]}, {ok:boolean}>(functions,'recordQuestSubmission');
const suggestTeammate = httpsCallable<{teamId:string;playerId:string},{ok:boolean}>(functions,'suggestTeammate');
const respondSuggestion = httpsCallable<{suggestionId:string;decision:'accept'|'decline'},{ok:boolean}>(functions,'respondToTeamSuggestion');
const statusLabels:Record<string,string>={not_started:'Not started',submitted:'Submitted',under_review:'Under review',approved:'Approved',revision_required:'Revision required'};
const allowedExtensions = '.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx';
function PlayerPortal() {
  const [user,setUser]=useState<User|null>(null),[profile,setProfile]=useState<PlayerProfile|null>(null),[authReady,setAuthReady]=useState(false);
  const [playerId,setPlayerId]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [quests,setQuests]=useState<Quest[]>([]),[team,setTeam]=useState<Team|null>(null),[members,setMembers]=useState<PlayerProfile[]>([]),[suggestions,setSuggestions]=useState<Suggestion[]>([]);
  const [suggestedId,setSuggestedId]=useState(''),[uploading,setUploading]=useState(''),[files,setFiles]=useState<Record<string,File[]>>({});
  const [loading,setLoading]=useState(false);
  useEffect(()=>onAuthStateChanged(auth,current=>{setUser(current);setAuthReady(true);}),[]);
  const loadDashboard=async(uid:string)=>{
    setLoading(true);setError('');
    try{
      const p=await getDoc(doc(db,'players',uid)); if(!p.exists()) throw new Error('Player profile not found.');
      const data=p.data() as PlayerProfile;setProfile(data);
      const [assignments,pending]=await Promise.all([
        getDocs(query(collection(db,'questAssignments'),where('playerUid','==',uid))),
        getDocs(query(collection(db,'teamSuggestions'),where('suggestedPlayerUid','==',uid),where('status','==','awaiting_player')))
      ]);
      setQuests(assignments.docs.map(d=>({id:d.id,...d.data()} as Quest)));
      setSuggestions(pending.docs.map(d=>({id:d.id,...d.data()} as Suggestion)));
      if(data.teamId){
        const t=await getDoc(doc(db,'teams',data.teamId));
        if(t.exists()){
          const td={id:t.id,...t.data()} as Team;setTeam(td);
          const memberDocs=await Promise.all((td.memberUids??[]).map(id=>getDoc(doc(db,'players',id))));
          setMembers(memberDocs.filter(x=>x.exists()).map(x=>x.data() as PlayerProfile));
        }else{setTeam(null);setMembers([]);}
      }else{setTeam(null);setMembers([]);}
    }catch(e){setError(e instanceof Error?e.message:'Unable to load your dashboard.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{if(user) void loadDashboard(user.uid);else{setProfile(null);setQuests([]);setTeam(null);setMembers([]);setSuggestions([]);}},[user]);
  const login=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{const r=await resolvePlayerLogin({playerId:playerId.trim().toUpperCase()});const email=typeof r.data.email==='string'?r.data.email.trim():'';if(!email)throw new Error('Invalid player account.');await signInWithEmailAndPassword(auth,email,password);setPassword('');}catch{setError('Sign-in failed. Check your Player ID and password, or use password reset.');}finally{setBusy(false);}};
  const reset=async()=>{if(!playerId.trim()){setError('Enter your Player ID first.');return;}setBusy(true);setError('');try{const r=await resolvePlayerLogin({playerId:playerId.trim().toUpperCase()});if(!r.data.email)throw new Error();await sendPasswordResetEmail(auth,r.data.email,{url:'https://immersive-games.com/#/player'});setMessage('If the Player ID is valid, a password reset link will be sent to its registered email.');}catch{setError('We could not send a password reset email.');}finally{setBusy(false);}};
  const upload=async(quest:Quest)=>{
    const selected=files[quest.id]??[];if(!selected.length)return;
    setUploading(quest.id);setError('');setMessage('');
    try{
      const uploaded=[];
      for(const file of selected){
        const path='quest-submissions/'+user!.uid+'/'+quest.id+'/'+Date.now()+'-'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        await uploadBytes(ref(storage,path),file,{contentType:file.type});
        uploaded.push({name:file.name,path,contentType:file.type,size:file.size});
      }
      await recordSubmission({assignmentId:quest.id,files:uploaded});
      setFiles(current=>({...current,[quest.id]:[]}));setMessage('Your evidence has been submitted.');await loadDashboard(user!.uid);
    }catch(e){setError(e instanceof Error?e.message:'Upload failed. Please try again.');}
    finally{setUploading('');}
  };
  const sendSuggestion=async(e:FormEvent)=>{e.preventDefault();if(!team)return;setBusy(true);setError('');setMessage('');try{await suggestTeammate({teamId:team.id,playerId:suggestedId.trim().toUpperCase()});setSuggestedId('');setMessage('Your suggestion has been sent for administration review.');}catch(e){setError(e instanceof Error?e.message:'Could not submit suggestion.');}finally{setBusy(false);}};
  const respond=async(id:string,decision:'accept'|'decline')=>{setBusy(true);setError('');try{await respondSuggestion({suggestionId:id,decision});setMessage(decision==='accept'?'You have joined the team.':'You declined the team request.');await loadDashboard(user!.uid);}catch(e){setError(e instanceof Error?e.message:'Unable to respond.');}finally{setBusy(false);}};
  const counts=useMemo(()=>({total:quests.length,approved:quests.filter(q=>q.status==='approved').length}),[quests]);
  if(!authReady)return <main className="admin-page"><p>Checking session…</p></main>;
  if(!user)return <main className="admin-page"><section className="admin-login"><a className="admin-back" href="#top"><ArrowLeft size={15}/> Public website</a><div className="admin-mark"><ShieldCheck size={25}/></div><p className="admin-eyebrow">IMMERSIVE GAMES STUDIO</p><h1>Player portal</h1><p className="admin-muted">Sign in to access your personal player space.</p><form onSubmit={login}><label>Player ID<input required autoComplete="username" placeholder="IGS-XXXXXX" value={playerId} onChange={e=>setPlayerId(e.target.value.toUpperCase())}/></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="admin-error" role="alert">{error}</p>}{message&&<p className="admin-success" role="status">{message}</p>}<button className="admin-primary" disabled={busy}>{busy?'Please wait…':'Sign in'}</button></form><button className="admin-link" onClick={()=>void reset()} disabled={busy}>Forgot your password?</button></section></main>;
  return <main className="admin-page"><header className="admin-header"><a href="#top" className="admin-brand">IMMERSIVE GAMES <em>STUDIO</em></a><div><span>{user.email}</span><button className="admin-quiet" onClick={()=>void signOut(auth)}><LogOut size={15}/> Sign out</button></div></header>
    <section className="admin-content"><div className="admin-heading"><div><p className="admin-eyebrow">PLAYER PORTAL</p><h1>Welcome{profile?.fullName?' , '+profile.fullName.split(' ')[0]:''}</h1><p className="admin-muted">Your personal space for quests and team information.</p></div><button className="admin-quiet" onClick={()=>void loadDashboard(user.uid)}>Refresh</button></div>
      {error&&<p className="admin-error" role="alert">{error}</p>}{message&&<p className="admin-success" role="status">{message}</p>}
      {loading&&<p className="admin-muted">Loading your dashboard…</p>}
      {profile&&<div className="admin-player-id"><strong>Your Player ID</strong><p>{profile.playerId??'—'}</p><small>Keep this ID safe.</small></div>}
      {suggestions.length>0&&<section className="dashboard-panel"><h2>Team requests</h2>{suggestions.map(s=><article className="dashboard-card" key={s.id}><strong>Invitation to join {s.teamName??'a team'}</strong><p>Suggested by {s.suggestedByPlayerId??'a player'} and approved by administration.</p><div className="dashboard-actions"><button className="admin-primary" onClick={()=>void respond(s.id,'accept')} disabled={busy}>Accept</button><button className="admin-secondary" onClick={()=>void respond(s.id,'decline')} disabled={busy}>Decline</button></div></article>)}</section>}
      <div className="dashboard-grid"><section className="dashboard-panel"><div className="dashboard-section-head"><div><p className="admin-eyebrow">YOUR ASSIGNMENTS</p><h2>Quests</h2></div><span className="dashboard-count">{counts.approved}/{counts.total} approved</span></div>
        {quests.length===0&&<p className="admin-muted">No quests have been assigned to you yet.</p>}
        {quests.map(q=><article className="dashboard-card" key={q.id}><div className="dashboard-card-head"><h3>{q.questTitle??'Quest'}</h3><span className={'admin-badge '+(q.status==='approved'?'approved':q.status==='revision_required'?'rejected':'')}>{statusLabels[q.status]??q.status}</span></div><p className="dashboard-quest-description">{q.questDescription}</p><p className="admin-muted">{q.status==='approved'?'This quest has been approved.':q.status==='under_review'?'Your submission is being reviewed.':q.status==='revision_required'?'Please review the coordinator feedback and submit additional evidence.':q.status==='submitted'?'Your evidence has been submitted and is waiting for review.':'Upload your evidence to complete this quest.'}</p>
          {q.feedback&&<p className="dashboard-feedback"><strong>Coordinator feedback:</strong> {q.feedback}</p>}
          {q.files?.map((f,i)=><a className="dashboard-file" key={f.path+i} href="#" onClick={async e=>{e.preventDefault();try{window.open(await getDownloadURL(ref(storage,f.path)),'_blank','noopener');}catch{setError('Unable to open this file.');}}}><FileText size={15}/>{f.name}</a>)}
          {q.status!=='approved'&&<div className="dashboard-upload"><label>Evidence files<input type="file" multiple accept={allowedExtensions} onChange={e=>setFiles(current=>({...current,[q.id]:Array.from(e.target.files??[])}))}/></label>{files[q.id]?.length>0&&<small>{files[q.id].length} file(s) selected</small>}<button className="admin-primary" onClick={()=>void upload(q)} disabled={uploading===q.id||!(files[q.id]?.length)}><Upload size={15}/>{uploading===q.id?'Uploading…':'Upload evidence'}</button></div>}
        </article>)}
      </section><aside className="dashboard-panel"><div className="dashboard-section-head"><div><p className="admin-eyebrow">YOUR GROUP</p><h2><Users size={20}/> My Team</h2></div></div>
        {!team&&<p className="admin-muted">You have not been assigned to a team yet.</p>}
        {team&&<><p className="dashboard-team-name">{team.name}</p><ul className="dashboard-members">{members.map(m=><li key={m.playerId}>{m.fullName??m.playerId} {m.playerId===profile?.playerId&&<span>(You)</span>}</li>)}</ul>{team.suggestionsOpen?<form className="dashboard-suggest" onSubmit={sendSuggestion}><label>Suggest a teammate<p className="admin-muted">Enter the Player ID of someone you know and would like to join your team.</p><input placeholder="IGS-XXXXXX" required value={suggestedId} onChange={e=>setSuggestedId(e.target.value.toUpperCase())}/></label><button className="admin-primary" disabled={busy||!suggestedId.trim()}>Submit suggestion</button></form>:<p className="admin-note">Team suggestions are currently closed.</p>}</>}
      </aside></div>
    </section></main>;
}
export default PlayerPortal;
