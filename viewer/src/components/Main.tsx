interface MainProps {
  children: React.ReactNode;
}

export function Main({ children }: MainProps) {
  return (
    <main className="flex-1 bg-neutral-50">
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </main>
  );
}
