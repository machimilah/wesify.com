import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found.</h1>
      <p className="mt-2 text-sm text-muted">The link may be old, or the market may have been removed.</p>
      <Link href="/" className="btn btn-primary mt-6">
        Go to markets
      </Link>
    </div>
  );
}
