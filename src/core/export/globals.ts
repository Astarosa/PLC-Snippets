/**
 * Noms globaux (variables API, DB, blocs appelés) utilisés dans un corps SCL ou LIST :
 * tout identifiant entre guillemets, hors commentaires et chaînes. Pour « "DB".champ »
 * on garde « DB ». Sert à prévenir : ils doivent exister dans le projet TIA avant l'import.
 */
export function globalNames(body: string, exclude: string[] = []): string[] {
  const code = body
    .replace(/\(\*[\s\S]*?\*\)/g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:[^'$]|\$.)*'/g, " ");
  const names = new Set<string>();
  for (const m of code.matchAll(/(^|[^\w."])"([^"\n]+)"/g)) {
    if (!exclude.includes(m[2])) names.add(m[2]);
  }
  return [...names];
}
