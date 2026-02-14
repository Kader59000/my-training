export function maskToken(token) {
  if (!token) return null;
  const s = String(token);
  if (s.length <= 10) return "********";
  return s.slice(0, 6) + "..." + s.slice(-4);
}
