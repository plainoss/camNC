export function FullText({ name, text }: { name: string; text: string }) {
  return (
    <details className="mt-3 rounded-md border">
      <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
        Read {name}
      </summary>
      <div
        role="region"
        aria-label={name}
        tabIndex={0}
        className="max-h-80 overflow-auto border-t bg-muted/40 p-3 focus-visible:outline-2 focus-visible:outline-offset-2">
        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{text}</pre>
      </div>
    </details>
  );
}

export const linkClass = 'text-sm underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2';

export function LicenseCard({
  dependency,
}: {
  dependency: { id: string; name: string; license: string; description: string; text: string; url: string };
}) {
  return (
    <section aria-labelledby={`license-${dependency.id}`} className="rounded-lg border p-4">
      <h3 id={`license-${dependency.id}`} className="font-semibold">
        {dependency.name}
      </h3>
      <p className="mt-1 text-sm font-medium">{dependency.license}</p>
      <p className="mt-2 text-sm text-muted-foreground">{dependency.description}</p>
      <p className="mt-3">
        <a className={linkClass} href={dependency.url} download>
          Download {dependency.name} license
        </a>
      </p>
      <FullText name={`${dependency.name} license`} text={dependency.text} />
    </section>
  );
}
