/**
 * Flag de visor solo lectura (branch frontend / PoC viewer).
 * Client + server: `NEXT_PUBLIC_VIEW_ONLY=true`.
 */
export function isViewOnly(): boolean {
  return process.env.NEXT_PUBLIC_VIEW_ONLY === "true";
}

export const VIEWER_READONLY_MESSAGE =
  "Modo visor: solo lectura. No se permiten mutaciones.";

/** Respuesta JSON estándar para rutas de mutación en modo viewer. */
export function viewerReadonlyPayload() {
  return {
    error: VIEWER_READONLY_MESSAGE,
    viewOnly: true,
  };
}
