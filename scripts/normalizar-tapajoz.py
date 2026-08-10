"""
Normaliza números CNJ da lista TAPAJOZ-Flavia:
- Se está formatado: mantém.
- Se está sem hífen/pontos (20 dígitos): formata.
- Se está sem complemento (13 dígitos = NNNNNNNAAAA + 2 dígitos DV): adiciona 8.19.0061.
- Se está em formato antigo (2021.08819-1): marca como INVÁLIDO.
- Se tem dígitos suficientes só até o ano (e.g., 0016821272019): assume complemento 8.19.0061.

Formato CNJ padrão: NNNNNNN-DD.AAAA.J.TT.OOOO
  - N=7 dígitos sequencial
  - D=2 dígitos verificador
  - A=4 dígitos ano
  - J=1 dígito órgão (8=Justiça estadual, 5=Justiça do Trabalho, 4=Justiça Federal)
  - T=2 dígitos tribunal (19=TJRJ, 01=TRT1, 02=TRF2, 21=TJRS, 26=TJSP)
  - O=4 dígitos origem
"""
import re
import sys
import json

INPUT = "/home/user/workspace/uploaded_attachments/e9ee1fd81e2e486e86c75abdd063305f/2026-08-09-TAPAJOZ-Flavia-Processos_Acompanhamento.txt"


def normalizar(raw: str) -> tuple[str | None, str]:
    """Retorna (numero_normalizado_ou_None, motivo_se_invalido)."""
    s = raw.strip()
    if not s:
        return None, "vazio"

    # Já formatado CNJ completo?
    m = re.match(r"^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$", s)
    if m:
        return f"{m[1]}-{m[2]}.{m[3]}.{m[4]}.{m[5]}.{m[6]}", ""

    # Formato antigo tipo "2021.08819-1" ou "2025.15259-5" → inválido pro CNJ
    if re.match(r"^\d{4}\.\d{5}-\d$", s):
        return None, "formato antigo (não-CNJ)"

    # Tira tudo que não é dígito
    digits = re.sub(r"\D", "", s)

    if len(digits) == 20:
        # NNNNNNNDDAAAAJTTOOOO — 20 dígitos completos
        return f"{digits[:7]}-{digits[7:9]}.{digits[9:13]}.{digits[13]}.{digits[14:16]}.{digits[16:20]}", ""

    if len(digits) == 13:
        # NNNNNNNDDAAAA (sequencial + DV + ano) — precisa complemento 8.19.0061
        return f"{digits[:7]}-{digits[7:9]}.{digits[9:13]}.8.19.0061", "complemento adicionado"

    return None, f"dígitos={len(digits)} (esperado 13 ou 20)"


def main():
    entradas = []
    with open(INPUT, encoding="utf-8") as f:
        for line in f:
            s = line.strip().replace("\r", "")
            if not s:
                continue
            entradas.append(s)

    print(f"Total de entradas: {len(entradas)}\n")

    ok = []
    invalido = []
    com_complemento = []

    for i, raw in enumerate(entradas, 1):
        norm, motivo = normalizar(raw)
        if norm:
            if motivo == "complemento adicionado":
                com_complemento.append((i, raw, norm))
            else:
                ok.append((i, raw, norm))
        else:
            invalido.append((i, raw, motivo))

    print(f"✓ Formato já válido/normalizado: {len(ok)}")
    print(f"⚙ Complemento .8.19.0061 adicionado: {len(com_complemento)}")
    print(f"✗ Inválidos (formato antigo/estranho): {len(invalido)}")

    print("\n=== COM COMPLEMENTO ADICIONADO ===")
    for i, raw, norm in com_complemento:
        print(f"  {i:3d}: {raw:30s} → {norm}")

    print("\n=== INVÁLIDOS ===")
    for i, raw, motivo in invalido:
        print(f"  {i:3d}: {raw:30s} → {motivo}")

    # Detecta duplicados na própria lista
    todos_normalizados = [n for _, _, n in ok] + [n for _, _, n in com_complemento]
    seen = {}
    duplicados_internos = []
    for n in todos_normalizados:
        if n in seen:
            seen[n] += 1
            duplicados_internos.append(n)
        else:
            seen[n] = 1
    dupes = [k for k, v in seen.items() if v > 1]
    if dupes:
        print(f"\n=== DUPLICADOS DENTRO DA PRÓPRIA LISTA ({len(dupes)}) ===")
        for d in dupes:
            print(f"  {d} (x{seen[d]})")

    # Extrai tribunal (ex: 8.19, 5.01, 4.02) pra distribuição
    from collections import Counter
    trib = Counter()
    for n in todos_normalizados:
        m = re.match(r"^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$", n)
        if m:
            trib[f"{m[1]}.{m[2]}"] += 1
    print(f"\n=== DISTRIBUIÇÃO POR JUSTIÇA/TRIBUNAL ===")
    for k, v in trib.most_common():
        nome = {
            "8.19": "TJRJ", "8.21": "TJRS", "8.26": "TJSP", "8.05": "TJBA",
            "5.01": "TRT1", "4.02": "TRF2",
        }.get(k, "?")
        print(f"  {k} ({nome}): {v}")

    # Salvar lista final normalizada em JSON pra consumo
    resultado = {
        "normalizados": todos_normalizados,
        "invalidos": [{"linha": i, "original": raw, "motivo": m} for i, raw, m in invalido],
        "duplicados_internos_unicos": dupes,
    }
    with open("/home/user/workspace/painel-andamentos/scripts/tapajoz-normalizado.json", "w") as f:
        json.dump(resultado, f, indent=2, ensure_ascii=False)
    print(f"\nSalvo em scripts/tapajoz-normalizado.json ({len(todos_normalizados)} números válidos)")


if __name__ == "__main__":
    main()
