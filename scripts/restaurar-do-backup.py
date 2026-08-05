"""
Restaura os 47 processos + vistoAte + snapshots do backup do cron.
Executa contra a API do backend (POST /api/processos + PATCH /visto).
Rodar DEPOIS de aplicar o SQL fix-rls-e-restaurar.sql no Supabase.
"""
import http.client
import json
import time

BACKUP = "/home/user/workspace/cron_tracking/39870a45/antes.json"
HOST = "painel-andamentos-backend.vercel.app"


def http(method, path, body=None):
    c = http.client.HTTPSConnection(HOST, timeout=60) if False else __import__("http.client", fromlist=["HTTPSConnection"]).HTTPSConnection(HOST, timeout=60)
    headers = {"Content-Type": "application/json"} if body else {}
    c.request(method, path, body=json.dumps(body) if body else None, headers=headers)
    r = c.getresponse()
    return r.status, r.read().decode()


def main():
    with open(BACKUP) as f:
        processos = json.load(f)
    print(f"Restaurando {len(processos)} processos...")

    ok = 0
    erro = 0
    for i, p in enumerate(processos, 1):
        # 1) Cadastra o processo (só numero/tribunal/apelido/observacoes)
        entrada = {
            "numero": p["numero"],
            "tribunal": p["tribunal"],
            "apelido": p.get("apelido"),
            "observacoes": p.get("observacoes"),
        }
        s, resp = http("POST", "/api/processos", entrada)
        if s != 201:
            print(f"  [{i}/{len(processos)}] ERRO ao criar id_old={p['id']}: HTTP {s} - {resp[:200]}")
            erro += 1
            continue
        criado = json.loads(resp)
        novo_id = criado["id"]

        # 2) Restaura vistoAte se havia
        if p.get("vistoAte"):
            s, resp = http("PATCH", f"/api/processos/{novo_id}/visto", {"vistoAte": p["vistoAte"]})
            if s != 200:
                print(f"  [{i}] aviso: vistoAte não restaurado: HTTP {s}")

        print(f"  [{i}/{len(processos)}] {p.get('apelido') or p['numero']}: id_novo={novo_id}")
        ok += 1
        time.sleep(0.1)  # gentil com a API

    print(f"\nOK: {ok}   ERRO: {erro}")
    print("Agora rode uma atualização completa pra popular os snapshots do Datajud:")
    print("  Botão 'Atualizar tudo' no painel, ou aguarde o cron das 3h.")


if __name__ == "__main__":
    main()
