"""Capture official DJERJ PDFs for assisted review; never approve a rule."""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

base = 'https://painel-andamentos-backend.vercel.app'
token = os.environ.get('AUTH_AUTOMATION_TOKEN', '')
if not token:
    sys.exit('Configure AUTH_AUTOMATION_TOKEN nos secrets do repositório.')
today = datetime.datetime.now(ZoneInfo('America/Sao_Paulo')).date()
# Overlapping window catches revised editions and retries source failures.
failures = 0
for back in range(5):
    day = today - datetime.timedelta(days=back)
    if day.weekday() >= 5:
        continue
    req = urllib.request.Request(base + '/api/calendario/coletar', method='POST',
        headers={'Content-Type': 'application/json', 'x-automation-token': token},
        data=json.dumps({'data': day.isoformat()}).encode())
    try:
        # On deploy-triggered runs the previous version may still reject this new route.
        # Capture is idempotent; retry only explicit temporary deployment responses.
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    result = json.load(response)
                break
            except urllib.error.HTTPError as error:
                if error.code not in (401, 404, 503) or attempt == 4:
                    raise
                time.sleep(20)
        if not isinstance(result.get('id'), str):
            raise ValueError('Resposta inválida')
        print(f'{day}: documento arquivado; repetido={result.get("repetido")}; candidatos={result.get("propostas")}')
    except Exception:
        # Do not log server payloads, HTTP headers or secrets.
        failures += 1
        print(f'{day}: captura não confirmada. Confira o histórico do calendário; pode não haver edição nesta data.')
if failures:
    sys.exit(f'{failures} captura(s) não confirmada(s). Não certificar o calendário como atualizado.')
