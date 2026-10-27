// Sonido corto para notificaciones nuevas. Se genera con Web Audio para no
// depender de archivos de audio. Los navegadores bloquean el audio hasta que
// la persona interactúa con la página, por eso el contexto se "desbloquea" en
// el primer clic/tecla.

const STORAGE_KEY = 'hd_notification_sound';
let audioContext = null;
let unlocked = false;

function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) audioContext = new Ctx();
  return audioContext;
}

function unlock() {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  unlocked = true;
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
}

export function initNotificationSound() {
  if (typeof window === 'undefined' || unlocked) return;
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function isSoundEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Sin almacenamiento disponible: se queda con el valor por defecto.
  }
}

function tone(ctx, frequency, start, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// urgent = true para SLA vencido/en riesgo: tres tonos en lugar de dos.
export function playNotificationSound({ urgent = false, force = false } = {}) {
  if (!force && !isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime + 0.01;
  if (urgent) {
    tone(ctx, 880, now, 0.16, 0.22);
    tone(ctx, 880, now + 0.2, 0.16, 0.22);
    tone(ctx, 1175, now + 0.4, 0.3, 0.22);
  } else {
    tone(ctx, 784, now, 0.18, 0.18);
    tone(ctx, 1047, now + 0.14, 0.32, 0.18);
  }
}
