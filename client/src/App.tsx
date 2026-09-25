import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import PublicacaoPublica from "@/pages/publicacao-publica";
import { InstalarPWA } from "@/components/InstalarPWA";
import AuthGate, { LegacyEntry } from "@/components/AuthGate";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/pub/:idToken" component={PublicacaoPublica} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const native = ["painel-andamentos-backend.vercel.app", "localhost", "127.0.0.1"].includes(location.hostname);
  if (!native) return <ThemeProvider><LegacyEntry /></ThemeProvider>;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AuthGate>
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
            <InstalarPWA />
          </AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
