import Link from "next/link";

export const metadata = { title: "Email preferences updated", robots: { index: false } };

export default async function UnsubscribedPage({ searchParams }: PageProps<"/unsubscribed">) {
  const q = await searchParams;
  const error = q.error === "1";
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{error ? "That link didn't work." : "You're unsubscribed."}</h1>
      <p className="mt-2 text-sm text-muted">
        {error
          ? "It may have been copied incompletely. You can change every email setting in Settings."
          : q.g === "marketing"
            ? "You won't get product news from us. Account emails like password resets still arrive."
            : "You won't get notification emails. Account emails like password resets still arrive."}
      </p>
      <Link href="/settings" className="btn btn-secondary mt-6">
        Email settings
      </Link>
    </div>
  );
}
