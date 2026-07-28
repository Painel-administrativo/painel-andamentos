import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

// Tipo do evento nativo de instalação do PWA
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CHAVE_DISMISS = "pwa-install-dismissed-v1";

export function InstalarPWA() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dispensado, setDispensado] = useState(false);

  useEffect(() => {
    // Não usa localStorage (bloqueado em iframe do preview) — só no site publicado
    let jaDispensou = false;
    try {
      jaDispensou = sessionStorage.getItem(CHAVE_DISMISS) === "1";
    } catch {
      // ignore
    }
    if (jaDispensou) setDispensado(true);

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Se já está instalado, some com o banner
    const jaInstalado = window.matchMedia("(display-mode: standalone)").matches;
    if (jaInstalado) setDispensado(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!promptEvent || dispensado) return null;

  async function instalar() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  }

  function dispensar() {
    try {
      sessionStorage.setItem(CHAVE_DISMISS, "1");
    } catch {
      // ignore
    }
    setDispensado(true);
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-lg"
      data-testid="banner-pwa-install"
    >
      <Download className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm">Instalar como app</span>
      <Button size="sm" onClick={instalar} data-testid="button-pwa-instalar">
        Instalar
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={dispensar}
        aria-label="Dispensar"
        data-testid="button-pwa-dispensar"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
