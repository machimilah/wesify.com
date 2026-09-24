/** RFC 9116 security.txt (§43 security contact). */
export function GET() {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const email = process.env.SECURITY_EMAIL ?? process.env.SUPPORT_EMAIL ?? "security@wesify.app";
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const body = [`Contact: mailto:${email}`, `Contact: ${base}/security`, `Expires: ${expires}`, "Preferred-Languages: en, es", `Canonical: ${base}/.well-known/security.txt`, `Policy: ${base}/security`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}
