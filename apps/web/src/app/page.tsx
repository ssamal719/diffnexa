import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Know what changed.</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        DiffNexa compares two versions of a document and explains the changes that matter. The
        first tool compares PDFs.
      </p>
      <Link
        href="/pdf-compare"
        className="mt-5 inline-flex items-center rounded-[3px] border border-signal bg-signal px-4 py-2 font-medium text-white hover:bg-[#0e4467]"
      >
        Open PDF Compare
      </Link>
    </div>
  );
}
