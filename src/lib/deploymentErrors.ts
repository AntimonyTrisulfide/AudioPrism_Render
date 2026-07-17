export function isLikelyCorsOrNetworkError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /failed to fetch|network error|networkerror|load failed/i.test(error.message);
}

export function backendConnectionMessage(apiBase: string, action: string) {
  const frontendOrigin = window.location.origin;
  const apiHint = apiBase || "(empty, using the frontend origin)";
  return `Cannot reach the backend while ${action}. Check VITE_API_ROOT (${apiHint}) and make sure backend ALLOWED_ORIGINS includes ${frontendOrigin}.`;
}
