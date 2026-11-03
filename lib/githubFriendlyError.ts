/** Mensajes legibles para errores crudos de GitHub GraphQL. */
export function friendlyGitHubError(raw: string): string {
  const msg = raw.trim();
  if (/name has already been taken/i.test(msg)) {
    return (
      "GitHub rechazó crear una columna porque el nombre ya existe en el project. " +
      "En tu JSON suele quedar un stub local del campo «Task» u otra columna estándar: al publicar ahora se alinea solo con GitHub. " +
      "Si persiste, usá «Traer y sobrescribir» una vez y volvé a publicar."
    );
  }
  if (/doesn't exist on type/i.test(msg)) {
    return (
      "La consulta a GitHub pidió un campo que no existe en su API (bug del cliente). " +
      "Actualizá la app y volvé a publicar; no es un tema de permisos del token."
    );
  }
  if (/no such type/i.test(msg)) {
    return (
      "GitHub rechazó la consulta (tipo GraphQL inválido en el cliente). " +
      "Eso impide traer o publicar hasta corregir la app; el JSON local no se pierde."
    );
  }
  if (/GH_ISSUE_REPOSITORY|repo para issues|Repo de issues/i.test(msg)) {
    return (
      "Falta definir en qué repo crear issues/sub-issues. " +
      "Elegí «Repo de issues» en la barra del project (se guarda en el JSON). " +
      "Como fallback podés setear GH_ISSUE_REPOSITORY=owner/repo en .env.local, " +
      "o vinculá un repositorio al Project en GitHub."
    );
  }
  if (/could not resolve to a node/i.test(msg)) {
    return (
      "GitHub no reconoció un ítem o columna (id viejo o fila solo local). " +
      "Probá «Publicar» de nuevo: la app realinea ids antes de enviar. " +
      "Si creaste tareas nuevas acá, todavía no existen en el project de GitHub hasta que las agregues allá o saques esas filas del JSON. " +
      "Como último recurso, «Traer y sobrescribir»."
    );
  }
  return msg;
}
