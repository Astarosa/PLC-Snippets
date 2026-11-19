/** « v0.3.4 (build 12) », ou « v0.3.4 (dev) » hors CI. */
export function formatAppVersion(version: string, build: string): string {
  return `v${version} (${/^\d+$/.test(build) ? `build ${build}` : build})`;
}

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? formatAppVersion(__APP_VERSION__, __APP_BUILD__) : "";
