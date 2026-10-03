import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-xl font-semibold">Not found</h1>
      <Link href="/" className="text-sm underline">Back to the app</Link>
    </main>
  );
}
