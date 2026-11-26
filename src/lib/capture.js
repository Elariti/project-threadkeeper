export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

/**
 * Grab one frame of the screen. In the desktop app the main process hides the sidecar
 * and captures the display. In a plain browser (dev/testing) we fall back to the
 * browser's own screen-share picker. Nothing is saved here; the caller decides.
 */
export async function grabScreen() {
  if (window.threadkeeper?.captureScreen) return window.threadkeeper.captureScreen();
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is not supported here.');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 200));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), displayName: 'your screen', capturedAt: new Date().toISOString() };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export const formatClock = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
