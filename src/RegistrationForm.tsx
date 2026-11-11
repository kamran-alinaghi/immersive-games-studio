import { useState } from 'react';
import type { FormEvent } from 'react';
import { createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { ArrowLeft, ArrowRight, Check, Compass, LoaderCircle } from 'lucide-react';
import { auth } from './firebase';

type RegistrationData = {
  ageConfirmed: string;
  fullName: string;
  email: string;
  travelMetroVancouver: string;
  area: string;
  commitToSessions: string;
  availability: string;
  motivation: string;
  puzzleApproaches: string[];
  uncertaintyReaction: string;
  comfortableRecording: string;
  comfortableExperience: string;
  website: string;
};

const apiUrl = import.meta.env.VITE_REGISTRATION_API_URL?.trim();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const areas = [
  'Anmore', 'Belcarra', 'Bowen Island', 'Burnaby', 'Coquitlam', 'Delta',
  'City of Langley', 'Township of Langley', 'Lions Bay', 'Maple Ridge',
  'Metro Vancouver A (Electoral Area A)', 'New Westminster', 'City of North Vancouver',
  'District of North Vancouver', 'Pitt Meadows', 'Port Coquitlam', 'Port Moody',
  'Richmond', 'Surrey', 'Tsawwassen', 'Vancouver', 'West Vancouver', 'White Rock'
];

const puzzleOptions = [
  'Try a different approach',
  'Look at the clues again to see if I missed anything',
  'Discuss it with the team',
  'Focus harder and keep trying',
  'Look for a hint'
];

const initialData: RegistrationData = {
  ageConfirmed: '', fullName: '', email: '', travelMetroVancouver: '', area: '',
  commitToSessions: '', availability: '', motivation: '', puzzleApproaches: [],
  uncertaintyReaction: '', comfortableRecording: '', comfortableExperience: '', website: ''
};

function ChoiceGroup({
  label, name, value, options, onChange, required = true
}: {
  label: string;
  name: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <fieldset className="registration-fieldset">
      <legend>{label}{required && <span className="required-mark"> *</span>}</legend>
      <div className="registration-options">
        {options.map(option => (
          <label className={value === option ? 'registration-option selected' : 'registration-option'} key={option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              required={required}
              onChange={event => onChange(event.target.value)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RegistrationForm() {
  const [data, setData] = useState<RegistrationData>(initialData);
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error' | 'unconfigured'>('idle');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [assignedPlayerId, setAssignedPlayerId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const emailHasFormatError = data.email.length > 0 && !emailPattern.test(data.email.trim());

  const update = <K extends keyof RegistrationData>(key: K, value: RegistrationData[K]) => {
    setData(current => ({ ...current, [key]: value }));
    if (status === 'error') setStatus('idle');
  };

  const togglePuzzleOption = (option: string, checked: boolean) => {
    setData(current => ({
      ...current,
      puzzleApproaches: checked
        ? [...current.puzzleApproaches, option]
        : current.puzzleApproaches.filter(item => item !== option)
    }));
    if (status === 'error') setStatus('idle');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    const normalizedEmail = data.email.trim().toLowerCase();
    if (!emailPattern.test(normalizedEmail)) {
      setStatus('error');
      setErrorMessage('Please enter a valid email address, such as name@example.com.');
      document.getElementById('email')?.focus();
      return;
    }
    if (password.length < 8) {
      setStatus('error');
      setErrorMessage('Your password must contain at least 8 characters.');
      document.getElementById('password')?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setStatus('error');
      setErrorMessage('Your passwords do not match.');
      document.getElementById('confirmPassword')?.focus();
      return;
    }
    if (auth.currentUser && auth.currentUser.email?.toLowerCase() !== normalizedEmail) {
      setStatus('error');
      setErrorMessage('Please sign out of the currently signed-in account before registering with a different email address.');
      return;
    }
    if (!apiUrl) {
      setStatus('unconfigured');
      return;
    }
    if (data.puzzleApproaches.length === 0) {
      setStatus('error');
      setErrorMessage('Please select at least one answer for Question 9.');
      return;
    }
    // Discard honeypot submissions before creating any Firebase Auth account.
    if (data.website.trim() !== '') return;

    setStatus('sending');
    try {
      const existingSession = auth.currentUser?.email?.toLowerCase() === normalizedEmail ?
        auth.currentUser : null;
      const credential = existingSession ?
        {user: existingSession} :
        await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      const idToken = await credential.user.getIdToken();

      let response: Response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            ageConfirmed: data.ageConfirmed,
            fullName: data.fullName.trim(),
            email: normalizedEmail,
            travelMetroVancouver: data.travelMetroVancouver,
            area: data.area,
            commitToSessions: data.commitToSessions,
            availability: data.availability,
            motivation: data.motivation.trim(),
            puzzleApproaches: data.puzzleApproaches,
            uncertaintyReaction: data.uncertaintyReaction,
            comfortableRecording: data.comfortableRecording,
            comfortableExperience: data.comfortableExperience,
            website: data.website
          })
        });
      } catch {
        throw new Error('We could not confirm your registration. Your account is still signed in; please try submitting again.');
      }

      if (!response.ok) {
        if (!existingSession) {
          await deleteUser(credential.user).catch(() => undefined);
        }
        throw new Error(response.status === 409
          ? 'This email address has already been used to submit an application.'
          : response.status === 401
            ? 'Your registration session expired. Please try again.'
            : response.status === 429
              ? 'Too many attempts. Please wait a moment and try again.'
              : 'We could not submit your registration. Please try again.');
      }

      const result = await response.json() as {playerId?: string};
      if (!result.playerId || !/^IGS-[A-Z0-9]{6}$/.test(result.playerId)) {
        throw new Error('Your application was submitted, but we could not retrieve your Player ID. Please contact us.');
      }
      setAssignedPlayerId(result.playerId);
      setStatus('success');
      setData(initialData);
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatus('error');
      const authCode = typeof error === 'object' && error !== null && 'code' in error ?
        String((error as {code?: unknown}).code) : '';
      setErrorMessage(authCode === 'auth/email-already-in-use'
        ? 'An account with this email already exists. Please use your Player ID to sign in to the portal.'
        : authCode === 'auth/weak-password'
          ? 'Please choose a stronger password with at least 8 characters.'
          : error instanceof Error
            ? error.message
            : 'We could not submit your registration. Please try again.');
    }
  };

  return (
    <main className="registration-page">
      <header className="registration-header">
        <a className="brand" href="#top" aria-label="Return to the Immersive Games Studio homepage">
          <span className="brand-mark"><Compass size={23} strokeWidth={1.4} /></span>
          <span className="brand-name">IMMERSIVE GAMES <em>STUDIO</em></span>
        </a>
        <a className="registration-back" href="#top"><ArrowLeft size={15} /> Back to the experience</a>
      </header>

      <section className="registration-intro">
        <p className="eyebrow"><span /> YOUR ADVENTURE STARTS HERE</p>
        <h1>Join the <i>hunt.</i></h1>
        <p>Tell us a little about yourself. Please answer the questions below to apply for the Immersive Games Studio treasure hunt.</p>
        <p className="registration-required-note"><span className="required-mark">*</span> Required questions</p>
      </section>

      <form className="registration-form" onSubmit={handleSubmit} noValidate={false}>
        <section className="registration-section">
          <p className="registration-section-number">01 — PERSONAL INFORMATION</p>
          <ChoiceGroup label="Are you 18 or older?" name="ageConfirmed" value={data.ageConfirmed} options={['Yes', 'No']} onChange={value => update('ageConfirmed', value)} />

          <div className="registration-field">
            <label htmlFor="fullName">Full name <span className="required-mark">*</span></label>
            <input id="fullName" name="fullName" type="text" autoComplete="name" required maxLength={120} value={data.fullName} onChange={event => update('fullName', event.target.value)} />
            <small>Maximum 120 characters.</small>
          </div>

          <div className="registration-field">
            <label htmlFor="email">Email <span className="required-mark">*</span></label>
            <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} pattern="[^\s@]+@[^\s@]+\.[^\s@]{2,}" title="Enter an email address in the format name@example.com." aria-invalid={emailHasFormatError} className={emailHasFormatError ? 'registration-email-invalid' : undefined} value={data.email} onChange={event => update('email', event.target.value)} />
            <small className={emailHasFormatError ? 'registration-email-hint-invalid' : undefined}>{emailHasFormatError ? 'Please enter a valid email address, such as name@example.com.' : 'Enter an address in the format name@example.com.'}</small>
          </div>

          <div className="registration-field">
            <label htmlFor="password">Create a password <span className="required-mark">*</span></label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} />
            <small>Use at least 8 characters. You'll use this password to access your player portal.</small>
          </div>
          <div className="registration-field">
            <label htmlFor="confirmPassword">Confirm password <span className="required-mark">*</span></label>
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
          </div>

          <ChoiceGroup label="Able to attend games and travel within Metro Vancouver when required?" name="travelMetroVancouver" value={data.travelMetroVancouver} options={['Yes', 'No']} onChange={value => update('travelMetroVancouver', value)} />

          <div className="registration-field">
            <label htmlFor="area">Area of Metro Vancouver <span className="required-mark">*</span></label>
            <select id="area" name="area" required value={data.area} onChange={event => update('area', event.target.value)}>
              <option value="">Select your area</option>
              {areas.map(area => <option value={area} key={area}>{area}</option>)}
            </select>
          </div>
        </section>

        <section className="registration-section">
          <p className="registration-section-number">02 — AVAILABILITY</p>
          <ChoiceGroup label="Can you commit to attending scheduled game sessions?" name="commitToSessions" value={data.commitToSessions} options={['Yes', 'No', 'Not sure']} onChange={value => update('commitToSessions', value)} />
          <ChoiceGroup label="Generally available on weekends and long weekends?" name="availability" value={data.availability} options={['Weekends', 'Long weekends', 'Both', 'Neither']} onChange={value => update('availability', value)} />
        </section>

        <section className="registration-section">
          <p className="registration-section-number">03 — COMPATIBILITY</p>
          <div className="registration-field">
            <label htmlFor="motivation">Why do you want to join this treasure hunt? <span className="required-mark">*</span></label>
            <textarea id="motivation" name="motivation" required maxLength={2000} rows={5} value={data.motivation} onChange={event => update('motivation', event.target.value)} />
            <small>Maximum 2,000 characters.</small>
          </div>

          <fieldset className="registration-fieldset">
            <legend>What would you most likely do if stuck on puzzle? <span className="required-mark">*</span></legend>
            <p className="field-hint">Select all that apply.</p>
            <div className="registration-options">
              {puzzleOptions.map(option => (
                <label className={data.puzzleApproaches.includes(option) ? 'registration-option selected' : 'registration-option'} key={option}>
                  <input type="checkbox" name="puzzleApproaches" value={option} checked={data.puzzleApproaches.includes(option)} onChange={event => togglePuzzleOption(option, event.target.checked)} />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <ChoiceGroup label="How do you feel when you don't know what you're supposed to do next?" name="uncertaintyReaction" value={data.uncertaintyReaction} options={[
            'I enjoy figuring it out',
            'I find it exciting, especially with a team',
            'I prefer having some direction',
            'I find it frustrating'
          ]} onChange={value => update('uncertaintyReaction', value)} />

          <ChoiceGroup label="Comfortable being recorded during treasure hunt with footage potentially shared on social media?" name="comfortableRecording" value={data.comfortableRecording} options={['Yes', 'No']} onChange={value => update('comfortableRecording', value)} />

          <ChoiceGroup label="Comfortable with activities possibly involving outdoors, interacting with strangers, unfamiliar places, unusual instructions, immersive story?" name="comfortableExperience" value={data.comfortableExperience} options={['Yes', 'No']} onChange={value => update('comfortableExperience', value)} />
        </section>

        <div className="registration-honeypot" aria-hidden="true">
          <label htmlFor="website">Leave this field empty</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" value={data.website} onChange={event => update('website', event.target.value)} />
        </div>

        <p className="registration-privacy-note">Please submit only information relevant to your application. Your answers will be handled according to the privacy information provided by Immersive Games Studio.</p>

        {status === 'success' && (
          <div className="registration-status success" role="status">
            <Check size={18} />
            <div>
              <strong>Your registration has been received!</strong>
              <p>Your Player ID is <strong>{assignedPlayerId}</strong>. Keep it safe; you'll use it with your password to sign in.</p>
              <p>We'll also send your Player ID to your email address.</p>
              <a href="#/player">Access your player portal <ArrowRight size={14} /></a>
            </div>
          </div>
        )}
        {status === 'unconfigured' && (
          <div className="registration-status error" role="status">
            Registration is not connected to the submission service yet. Your answers have not been sent or saved.
          </div>
        )}
        {status === 'error' && <div className="registration-status error" role="alert">{errorMessage}</div>}

        <button className="button button-dark registration-submit" type="submit" disabled={status === 'sending' || status === 'success'}>
          {status === 'sending' ? <><LoaderCircle className="registration-spinner" size={16} /> Submitting…</> : <>Submit registration <ArrowRight size={16} /></>}
        </button>
        <p className="registration-footnote">Submitting this form is an application, not confirmation of selection or formal recording consent.</p>
      </form>

      <footer className="registration-footer">© {new Date().getFullYear()} Immersive Games Studio. All rights reserved.</footer>
    </main>
  );
}

export default RegistrationForm;
