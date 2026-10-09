"""Coleta diária em lotes; nunca imprime a credencial nem corpos remotos."""
import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.error

base = 'https://painel-andamentos-backend.vercel.app'
token = os.environ.get('AUTH_AUTOMATION_TOKEN', '')
if not token:
    sys.exit('Configure o secret AUTH_AUTOMATION_TOKEN antes de ativar a coleta.')

def consultar(path, method='GET'):
    req = urllib.request.Request(base + path, method=method,
        data=b'{}' if method == 'POST' else None,
        headers={'x-automation-token': token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=65) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Backend HTTP {e.code}; consulta inconclusiva') from None
    except Exception:
        raise RuntimeError('Falha de conexão ou resposta inválida; consulta inconclusiva') from None

health = consultar('/api/auth/automation-health')
if health.get('ok') is not True or health.get('scope') != 'daily-monitoring':
    sys.exit('Autenticação da automação não confirmada.')
rodada = str(uuid.uuid4())
offset = processos = novidades = erros = 0
for lote in range(2000):
    data = consultar(f'/api/publicacoes/atualizar?limite=5&offset={offset}&dias=3&rodada={rodada}', 'POST')
    for key in ('processados', 'novasPublicacoes', 'erros', 'proximoOffset'):
        if type(data.get(key)) is not int or data[key] < 0:
            sys.exit('Resumo inválido; consulta inconclusiva.')
    if type(data.get('concluido')) is not bool:
        sys.exit('Estado de conclusão inválido.')
    processos += data['processados']
    novidades += data['novasPublicacoes']
    erros += data['erros']
    print(f'Lote {offset}: {data["processados"]} processos, {data["novasPublicacoes"]} novidades, {data["erros"]} erros', flush=True)
    if data['concluido']:
        print(f'Fim da sequência: {processos} processos, {novidades} novidades, {erros} erros. Ausência de erros não certifica cobertura integral.', flush=True)
        sys.exit(1 if erros else 0)
    if data['proximoOffset'] <= offset:
        sys.exit('Sem avanço; consulta inconclusiva.')
    offset = data['proximoOffset']
    time.sleep(10)
sys.exit('Limite de lotes alcançado; consulta inconclusiva.')
