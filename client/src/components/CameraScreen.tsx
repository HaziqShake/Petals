// Custom in-app camera, Instagram-like, mobile first.
// Full-screen black, live preview, big white capture button: tap for
// a photo, hold to record a video (up to 60 seconds, the same cap as
// chat clips). Gallery thumbnail bottom-left opens the media picker,
// flip camera bottom-right, close top-left, flash top-right.
// No filters, no effects, no text or drawing tools, no stories.
// After capture, a preview screen with Retake and Send; Send hands
// the File to the parent, which feeds the normal preview sheet with
// the view-once choice. If the camera is denied or unavailable, a
// clear message with System gallery and Close buttons instead.
// Video format: prefer video/mp4 when MediaRecorder supports it,
// otherwise the browser default (usually video/webm on Android). The
// upload flow threads the real mime type through, so both work.
import { useState, useEffect, useRef, useCallback } from 'react';
import { listRecentMedia, thumbSrc, isNativePickerAvailable, type PickerMediaItem } from '../utils/mediaPicker';
import { CameraIcon, CloseIcon, FlashIcon, FlipCameraIcon, ImageIcon } from './Icons';
import { VIDEO_MAX_SECONDS } from '../utils/imageCompressor';

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
  onOpenGallery: () => void;
}

type Phase = 'live' | 'preview' | 'denied';

function pickVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  if (MediaRecorder.isTypeSupported('video/mp4')) return 'video/mp4';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) return 'video/webm;codecs=vp9,opus';
  if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
  return '';
}

export default function CameraScreen({ onCapture, onClose, onOpenGallery }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('live');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [flashOn, setFlashOn] = useState(false);
  const [flashSupported, setFlashSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [captured, setCaptured] = useState<{ file: File; previewUrl: string; isVideo: boolean } | null>(null);
  const [galleryThumb, setGalleryThumb] = useState<PickerMediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const facingRef = useRef(facing);
  facingRef.current = facing;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async (mode: 'environment' | 'user') => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPhase('denied');
      setError('This device cannot open the camera here.');
      return;
    }
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setFlashSupported(Boolean(caps?.torch));
      setFlashOn(false);
      setPhase('live');
      setError(null);
    } catch {
      setPhase('denied');
      setError('Petals needs camera access to take photos here. Allow it, or use the gallery instead.');
    }
  }, [stopStream]);

  useEffect(() => {
    void startStream(facingRef.current);
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Most recent gallery item for the thumbnail button.
  useEffect(() => {
    if (!isNativePickerAvailable()) return;
    void listRecentMedia(1).then((items) => {
      if (items.length > 0) setGalleryThumb(items[0]);
    }).catch(() => undefined);
  }, []);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecording(false);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recordingRef.current) return;
    const mimeType = pickVideoMimeType();
    let rec: MediaRecorder;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/mp4' });
      const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
      const file = new File([blob], `petals-video-${Date.now()}.${ext}`, { type: blob.type || 'video/mp4' });
      setCaptured({ file, previewUrl: URL.createObjectURL(file), isVideo: true });
      setPhase('preview');
    };
    recorderRef.current = rec;
    recordingRef.current = true;
    setRecordSecs(0);
    setRecording(true);
    rec.start(250);
    recordTimerRef.current = setInterval(() => {
      setRecordSecs((s) => {
        if (s + 1 >= VIDEO_MAX_SECONDS) { stopRecording(); return s; }
        return s + 1;
      });
    }, 1000);
  }, [stopRecording]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Front camera preview is mirrored; mirror the capture too so the
    // photo matches what was on screen.
    if (facingRef.current === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `petals-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCaptured({ file, previewUrl: URL.createObjectURL(file), isVideo: false });
      setPhase('preview');
    }, 'image/jpeg', 0.92);
  }, []);

  const handleCaptureDown = () => {
    if (phase !== 'live') return;
    holdTimerRef.current = setTimeout(() => { startRecording(); }, 500);
  };

  const handleCaptureUp = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (recordingRef.current) { stopRecording(); return; }
    if (phase === 'live') takePhoto();
  };

  const handleCaptureLeave = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  };

  const flipCamera = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void startStream(next);
  };

  const toggleFlash = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !flashOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setFlashOn(next);
    } catch { /* torch not actually available on this device */ }
  };

  const retake = () => {
    if (captured) URL.revokeObjectURL(captured.previewUrl);
    setCaptured(null);
    setPhase('live');
  };

  const sendCaptured = () => {
    if (!captured) return;
    const { file } = captured;
    URL.revokeObjectURL(captured.previewUrl);
    setCaptured(null);
    onCapture(file);
  };

  const closeAll = () => {
    if (captured) URL.revokeObjectURL(captured.previewUrl);
    stopStream();
    onClose();
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 300, display: 'flex', flexDirection: 'column', color: '#fff' }} role="dialog" aria-label="Camera">
      {phase === 'denied' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <CameraIcon size={40} color="#fff" />
          <div style={{ fontSize: 17, fontWeight: 700 }}>Camera is not available</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{error ?? 'Petals could not open the camera.'}</div>
          <button onClick={onOpenGallery} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 24, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>System gallery</button>
          <button onClick={closeAll} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 15, cursor: 'pointer', padding: 12 }}>Close</button>
        </div>
      ) : phase === 'preview' && captured ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 8px' }}>
            <button onClick={closeAll} aria-label="Close camera" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 44, height: 44, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CloseIcon size={20} color="#fff" /></button>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{captured.isVideo ? 'Video preview' : 'Photo preview'}</span>
            <span style={{ width: 44 }} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
            {captured.isVideo ? (
              <video src={captured.previewUrl} controls playsInline autoPlay loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
              <img src={captured.previewUrl} alt="Captured photo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, padding: '16px 20px calc(16px + env(safe-area-inset-bottom))' }}>
            <button onClick={retake} style={{ flex: 1, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 24, padding: '14px 0', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Retake</button>
            <button onClick={sendCaptured} style={{ flex: 1, background: '#fff', color: '#000', border: 'none', borderRadius: 24, padding: '14px 0', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Send</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
            <video ref={videoRef} playsInline muted autoPlay style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 8px' }}>
              <button onClick={closeAll} aria-label="Close camera" style={{ background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: '50%', width: 44, height: 44, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CloseIcon size={20} color="#fff" /></button>
              {recording && (
                <span style={{ background: 'rgba(0,0,0,0.5)', borderRadius: 16, padding: '6px 12px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF3B30', display: 'inline-block' }} />
                  {fmt(recordSecs)} / {fmt(VIDEO_MAX_SECONDS)}
                </span>
              )}
              {flashSupported ? (
                <button onClick={() => void toggleFlash()} aria-label={flashOn ? 'Turn flash off' : 'Turn flash on'} style={{ background: flashOn ? '#fff' : 'rgba(0,0,0,0.35)', border: 'none', borderRadius: '50%', width: 44, height: 44, color: flashOn ? '#000' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FlashIcon size={20} color={flashOn ? '#000' : '#fff'} /></button>
              ) : <span style={{ width: 44 }} />}
            </div>
            {!recording && (
              <div style={{ position: 'absolute', bottom: 108, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.75)', pointerEvents: 'none' }}>Tap for a photo, hold for a video</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px calc(20px + env(safe-area-inset-bottom))', background: '#000' }}>
            <button
              onClick={onOpenGallery}
              aria-label="Open gallery"
              style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.8)', background: 'rgba(255,255,255,0.15)', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {galleryThumb && thumbSrc(galleryThumb) ? (
                <img src={thumbSrc(galleryThumb) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <ImageIcon size={22} color="#fff" />
              )}
            </button>
            <button
              onPointerDown={handleCaptureDown}
              onPointerUp={handleCaptureUp}
              onPointerLeave={handleCaptureLeave}
              onPointerCancel={handleCaptureLeave}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={recording ? 'Stop recording' : 'Take a photo or hold to record video'}
              style={{
                width: 76, height: 76, borderRadius: '50%', border: recording ? '4px solid #FF3B30' : '4px solid #fff',
                background: recording ? '#FF3B30' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', padding: 0,
              }}
            >
              <span style={{ width: 60, height: 60, borderRadius: '50%', background: recording ? '#FF3B30' : '#fff', display: 'block', transition: 'transform 120ms ease-out', transform: recording ? 'scale(0.6)' : 'scale(1)' }} />
            </button>
            <button
              onClick={flipCamera}
              aria-label="Switch camera"
              style={{ width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            ><FlipCameraIcon size={24} color="#fff" /></button>
          </div>
        </>
      )}
    </div>
  );
}
