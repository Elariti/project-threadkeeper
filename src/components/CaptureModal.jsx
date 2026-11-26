import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, LoaderCircle, Mic, RotateCcw, ShieldCheck, Video, X } from 'lucide-react';
import CatMascot from './CatMascot';
import { blobToDataUrl, formatClock } from '../lib/capture';

const LABELS = {
  image: { title: 'Screenshot note', name: 'Screen capture', Icon: Camera },
  voice: { title: 'Voice note', name: 'Voice note', Icon: Mic },
  video: { title: 'Video note', name: 'Video note', Icon: Video },
};

/**
 * One dialog for screen, voice and video captures:
 *   capture/record  ->  review (preview, title, caption)  ->  Save note
 * "Save note" writes the media straight into a brand-new note, or into the note that is
 * open ("Add to this note"). Recordings also offer "Stop & save" for a one-tap save.
 */
export default function CaptureModal({ kind, shot, currentNote, defaultTarget = 'new', onSave, onRetake, onClose, notify }) {
  const { title: kindTitle, name: kindName, Icon } = LABELS[kind];
  const isImage = kind === 'image';
  const [phase, setPhase] = useState(isImage ? 'review' : 'ready'); // ready | recording | review | saving
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState(null); // { blob, url, mimeType, secs }
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [target, setTarget] = useState(currentNote && defaultTarget === currentNote.id ? currentNote.id : 'new');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const secsRef = useRef(0);
  const previewRef = useRef(null);
  const saveAfterStop = useRef(false);
  const urlRef = useRef(null);
  const mounted = useRef(true);

  const busy = phase === 'recording' || phase === 'saving';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); if (!busy) onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const started = Date.now();
    const timer = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); secsRef.current = s; setSecs(s); }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  const finalTitle = () => title.trim() || kindTitle;

  const save = async (override) => {
    const data = override || (isImage
      ? { dataUrl: shot.dataUrl, mimeType: 'image/png', name: `${kindName} ${new Date().toLocaleString()}.png`, durationSeconds: 0, capturedAt: shot.capturedAt, source: shot.displayName }
      : null);
    if (!data) return;
    setPhase('saving');
    try {
      await onSave({ kind, ...data, title: finalTitle(), caption: caption.trim(), target });
    } catch (error) {
      notify?.(`Could not save: ${error.message || 'unknown error'}`);
      if (mounted.current) setPhase('review');
    }
  };

  const saveRecording = async (rec) => {
    setPhase('saving');
    try {
      const dataUrl = await blobToDataUrl(rec.blob);
      const ext = rec.mimeType.includes('mp4') ? 'mp4' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';
      await save({ dataUrl, mimeType: rec.mimeType, name: `${kind}-note-${Date.now()}.${ext}`, durationSeconds: rec.secs });
    } catch (error) {
      notify?.(`Could not save the recording: ${error.message || 'unknown error'}`);
      if (mounted.current) setPhase('review');
    }
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      notify?.('Audio/video recording is not supported on this device.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'voice'
        ? { audio: true }
        : { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
      streamRef.current = stream;
      if (kind === 'video' && previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.muted = true;
        await previewRef.current.play().catch(() => {});
      }
      const candidates = kind === 'video'
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      recorder.onerror = (e) => notify?.(`Recording error: ${e.error?.message || 'please try again'}`);
      recorder.onstop = () => {
        const type = recorder.mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunksRef.current, { type });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (previewRef.current) previewRef.current.srcObject = null;
        if (!mounted.current) return;
        if (!blob.size) { setPhase('ready'); notify?.('The recording was empty. Please try again.'); return; }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const rec = { blob, url, mimeType: type, secs: secsRef.current };
        setResult(rec);
        if (saveAfterStop.current) { saveAfterStop.current = false; saveRecording(rec); } else setPhase('review');
      };
      secsRef.current = 0;
      setSecs(0);
      recorder.start(400);
      setPhase('recording');
    } catch (error) {
      notify?.(error.name === 'NotAllowedError' ? 'Microphone/camera access was denied. Allow access and try again.' : `Could not start recording: ${error.message || 'unknown error'}`);
    }
  };

  const stop = (andSave = false) => {
    saveAfterStop.current = andSave;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const rerecord = () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setResult(null);
    setSecs(0);
    setPhase('ready');
  };

  const canSave = isImage ? phase === 'review' : phase === 'review' && result;
  const showLive = !isImage && (phase === 'ready' || phase === 'recording' || (phase === 'saving' && !result));
  const showPlayback = !isImage && result && (phase === 'review' || phase === 'saving');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal capture-modal" role="dialog" aria-label={kindTitle}>
        <div className="modal-head">
          <div><div className="eyebrow">A LITTLE MOMENT, KEPT</div><h2>{isImage ? 'Review screenshot' : kind === 'voice' ? 'Record a voice note' : 'Record a video note'}</h2></div>
          <button className="icon-btn" disabled={busy} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {isImage && <img className="capture-shot" src={shot.dataUrl} alt="Screen capture preview" />}

        {showLive && (
          kind === 'video'
            ? <video className="recording-preview" ref={previewRef} autoPlay muted playsInline />
            : <div className="voice-stage"><CatMascot size={74} mood={phase === 'recording' ? 'alert' : 'happy'} wave={phase === 'ready'} /><div className={`sound-wave ${phase === 'recording' ? 'live' : ''}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
        )}

        {showPlayback && (
          kind === 'video'
            ? <video className="recording-preview" controls playsInline src={result.url} />
            : <div className="voice-stage"><CatMascot size={64} mood="happy" /><audio className="attachment-audio" controls src={result.url} /></div>
        )}

        {!isImage && (
          <div className="recording-status">
            <span className={phase === 'recording' ? 'recording-dot' : ''} />
            {phase === 'recording' ? 'Recording…' : phase === 'review' || (phase === 'saving' && result) ? 'Recorded. Listen back, then save.' : 'Ready when you are'}
            <strong>{formatClock(result && phase !== 'recording' ? result.secs : secs)}</strong>
          </div>
        )}

        {(isImage || phase === 'review' || phase === 'saving') && (result || isImage) && (
          <>
            <label>Title <span className="optional">(optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kindTitle} disabled={phase === 'saving'} />
            </label>
            <label>Caption <span className="optional">(optional)</span>
              <textarea className="caption-input" value={caption} onChange={(e) => setCaption(e.target.value)} disabled={phase === 'saving'} rows={2}
                placeholder={kind === 'image' ? 'What is this screenshot of?' : 'Add a few words about this recording…'} />
            </label>
            <div className="target-picker" role="radiogroup" aria-label="Where to save">
              <button role="radio" aria-checked={target === 'new'} className={target === 'new' ? 'is-chosen' : ''} onClick={() => setTarget('new')} disabled={phase === 'saving'}>New note</button>
              {currentNote && (
                <button role="radio" aria-checked={target === currentNote.id} className={target === currentNote.id ? 'is-chosen' : ''} onClick={() => setTarget(currentNote.id)} disabled={phase === 'saving'} title={currentNote.title || 'Untitled note'}>
                  Add to “{(currentNote.title || 'Untitled note').slice(0, 22)}{(currentNote.title || '').length > 22 ? '…' : ''}”
                </button>
              )}
            </div>
          </>
        )}

        <p className="modal-hint"><ShieldCheck size={13} /> {isImage ? 'Anything visible on that screen is in the picture. Nothing is saved until you press Save note.' : 'Saved as a file on this device. Threadkeeper does not upload it anywhere.'}</p>

        <div className="form-actions">
          {phase === 'saving' && <button className="primary-button" disabled><LoaderCircle size={14} className="spin" /> Saving…</button>}
          {phase === 'ready' && !isImage && <><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={start}><Icon size={14} /> Start recording</button></>}
          {phase === 'recording' && <><button className="secondary-button" onClick={() => stop(false)}>Stop</button><button className="primary-button stop-recording" onClick={() => stop(true)}>Stop &amp; save <Check size={14} /></button></>}
          {phase === 'review' && (
            <>
              {isImage ? <button className="secondary-button" onClick={onRetake}><RotateCcw size={13} /> Retake</button> : <button className="secondary-button" onClick={rerecord}><RotateCcw size={13} /> Re-record</button>}
              <button className="secondary-button" onClick={onClose}>Discard</button>
              <button className="primary-button" disabled={!canSave} onClick={() => (isImage ? save() : saveRecording(result))}>Save note <Check size={14} /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
