/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/quick-unlock.js
   P0-2 — "PIN rápido" para volver a entrar SIN INTERNET después de un
   login real de Supabase Auth. Módulo separado a propósito: NO reutiliza
   ni toca la lógica del login PIN legacy (app.js renderLogin()/doLogin(),
   comparación en texto plano) — mientras AUTH_MODE sea 'legacy' (default),
   nada de este archivo se usa.

   Principio de seguridad, sin excepción: Supabase Auth sigue siendo la
   ÚNICA identidad real. Este PIN:
     - NO autentica contra Supabase (nunca llama a /auth/v1/*).
     - NO da permisos de servidor (nunca lo ve la Edge Function ni RLS).
     - NO define el rol (eso sigue viniendo siempre de app_profiles, vía
       Auth.getProfile()/Auth.isAuthenticated()).
     - Solo decide si ESTE dispositivo vuelve a mostrar la UI de una
       identidad que YA se validó antes con una sesión Auth real — nunca
       sustituye ni adelanta esa validación (ver app.js
       renderAuthGateSupabase(): el gate de sync de sync.js/auth.js sigue
       siendo el único que decide si se sincroniza, exactamente igual que
       antes de que existiera este archivo).

   Nunca se guarda el PIN en texto plano: PBKDF2-SHA256 con salt aleatorio
   por dispositivo, guardado únicamente en `auth_quick_unlock`
   (app_config, LOCAL_STORES — nunca sincroniza, ver db.js). Namespace
   separado de auth_tokens/auth_profile_snapshot: borrar uno nunca borra
   los otros por accidente (ver disable() / app.js logout()).
   ============================================================ */

const QUICK_UNLOCK_SALT_BYTES = 16;
// 100k iteraciones: bastante para hacer inviable un ataque de fuerza bruta
// offline contra el hash guardado en este dispositivo, sin volver
// perceptible el desbloqueo en un teléfono de gama media (objetivo:
// "razonable", no el máximo posible — ver pedido del cierre P0-2).
const QUICK_UNLOCK_ITERATIONS = 100000;
const QUICK_UNLOCK_MAX_ATTEMPTS = 5;
const QUICK_UNLOCK_LOCKOUT_MS = 5 * 60 * 1000;

// 4 o 6 dígitos exactos, nada más — el mismo formato para configurar y
// para desbloquear.
function isValidPinFormat(pin) {
  return typeof pin === 'string' && /^(\d{4}|\d{6})$/.test(pin);
}

// Rechaza los patrones más obvios (mismo criterio para 4 y 6 dígitos):
// todos los dígitos iguales (0000, 1111, 111111…) y las secuencias
// consecutivas ascendentes/descendentes más conocidas (1234, 4321,
// 123456, 654321…). No pretende ser un detector exhaustivo de "PIN
// débil" — bloquea los casos que cualquier persona probaría primero.
// Asume formato ya válido (isValidPinFormat) — no lo vuelve a comprobar.
function isTrivialPin(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const ascA = '0123456789'.slice(0, pin.length);
  const ascB = '1234567890'.slice(0, pin.length);
  const descA = [...ascA].reverse().join('');
  const descB = [...ascB].reverse().join('');
  return pin === ascA || pin === ascB || pin === descA || pin === descB;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function randomSaltHex(byteLen) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// PBKDF2-SHA256 puro (Web Crypto — disponible en cualquier navegador
// moderno y en Node vía globalThis.crypto, sin librería externa). Nunca
// recibe ni devuelve el PIN en ningún otro lado del código.
async function pbkdf2HashHex(pin, saltHex, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

const QuickUnlock = {
  // ¿Hay un PIN configurado para ESTA identidad en ESTE dispositivo? El
  // caller (app.js) decide con esto qué pantalla mostrar — nunca se ofrece
  // el PIN de una identidad distinta a la del snapshot local.
  async isConfigured(appUserId) {
    const rec = await DB.getQuickUnlock();
    return !!(rec && rec.appUserId === appUserId);
  },

  // El caller DEBE haber confirmado ya un login Auth real y vigente
  // (Auth.isAuthenticated() true, perfil activo) ANTES de llamar esto —
  // este módulo no repite esa validación (una sola fuente de verdad: Auth,
  // ver principio de seguridad arriba). Solo valida el PIN en sí.
  async configure(appUserId, pin) {
    if (typeof appUserId !== 'string' || !appUserId) {
      throw new Error('Falta identidad del usuario.');
    }
    if (!isValidPinFormat(pin)) {
      throw new Error('El PIN debe tener exactamente 4 o 6 dígitos.');
    }
    if (isTrivialPin(pin)) {
      throw new Error('Ese PIN es demasiado fácil de adivinar — elige otro.');
    }
    const salt = randomSaltHex(QUICK_UNLOCK_SALT_BYTES);
    const hash = await pbkdf2HashHex(pin, salt, QUICK_UNLOCK_ITERATIONS);
    await DB.setQuickUnlock({
      appUserId, salt, hash, iterations: QUICK_UNLOCK_ITERATIONS,
      createdAt: nowISO(), failedAttempts: 0, lockedUntil: null
    });
    return true;
  },

  // Cambiar PIN es exactamente configurar de nuevo (mismas reglas,
  // reinicia intentos fallidos/bloqueo) — nunca hace falta lógica aparte.
  async changePin(appUserId, newPin) {
    return this.configure(appUserId, newPin);
  },

  // Desactivar PIN rápido — SOLO borra `auth_quick_unlock`. Nunca toca
  // auth_tokens ni auth_profile_snapshot (eso es CERRAR SESIÓN, ver
  // app.js logout()) ni ningún store operativo (engrases, anomalías,
  // catálogos siguen intactos).
  async disable() {
    await DB.setQuickUnlock(null);
  },

  async isLockedOut(appUserId) {
    const rec = await DB.getQuickUnlock();
    return !!(rec && rec.appUserId === appUserId && rec.lockedUntil && Date.now() < rec.lockedUntil);
  },

  async getLockRemainingMs(appUserId) {
    const rec = await DB.getQuickUnlock();
    if (!rec || rec.appUserId !== appUserId || !rec.lockedUntil) return 0;
    return Math.max(0, rec.lockedUntil - Date.now());
  },

  // Compara el PIN escrito contra el hash guardado. El contador de
  // intentos fallidos y el bloqueo viven en DB (nunca en memoria), así que
  // sobreviven cerrar y volver a abrir la app — pedido explícito del
  // cierre P0-2. Nunca borra datos ni tokens al bloquear, nunca resetea el
  // PIN automáticamente.
  async attemptUnlock(appUserId, pin) {
    const rec = await DB.getQuickUnlock();
    if (!rec || rec.appUserId !== appUserId) return { ok: false, reason: 'NOT_CONFIGURED' };
    if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
      return { ok: false, reason: 'LOCKED', remainingMs: rec.lockedUntil - Date.now() };
    }
    const candidateHash = await pbkdf2HashHex(pin, rec.salt, rec.iterations);
    if (candidateHash === rec.hash) {
      if (rec.failedAttempts || rec.lockedUntil) {
        await DB.setQuickUnlock({ ...rec, failedAttempts: 0, lockedUntil: null });
      }
      return { ok: true };
    }
    const failedAttempts = (rec.failedAttempts || 0) + 1;
    const lockedUntil = failedAttempts >= QUICK_UNLOCK_MAX_ATTEMPTS ? Date.now() + QUICK_UNLOCK_LOCKOUT_MS : null;
    await DB.setQuickUnlock({ ...rec, failedAttempts, lockedUntil });
    if (lockedUntil) return { ok: false, reason: 'LOCKED', remainingMs: QUICK_UNLOCK_LOCKOUT_MS };
    return { ok: false, reason: 'WRONG_PIN', attemptsLeft: QUICK_UNLOCK_MAX_ATTEMPTS - failedAttempts };
  }
};
