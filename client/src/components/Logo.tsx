export function Logo({ className = "" }: { className?: string }) {
  // Marca geométrica: coluna de "andamentos" empilhados com um marcador de destaque.
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      aria-label="Painel de Andamentos"
      role="img"
    >
      <rect x="4" y="4" width="24" height="24" rx="5" strokeWidth="2" />
      <line x1="10" y1="11" x2="22" y2="11" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="16" x2="22" y2="16" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="21" x2="17" y2="21" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
