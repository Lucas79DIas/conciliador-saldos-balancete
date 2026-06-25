# Conciliador de Saldos — Balancete TCEMG

Aplicação web simples para ajustar o **saldo inicial** do Balancete (layout
SICAP-DC) do mês atual, fazendo-o bater com o **saldo final** do mês
anterior — exigência comum do TCEMG.

## Como funciona

Você sobe dois arquivos `.zip` (o balancete do mês anterior e o do mês
atual). A aplicação:

1. Extrai o `BALANCETE.CSV` de dentro de cada zip.
2. Para cada linha do mês atual, identifica sua **chave** (todos os campos
   antes dos 6 últimos: Saldo Inicial, Natureza, Débito, Crédito, Saldo
   Final, Natureza).
3. Procura a mesma chave no mês anterior:
   - **Encontrou** → o novo Saldo Inicial passa a ser exatamente o Saldo
     Final (valor + natureza) daquela linha no mês anterior.
   - **Não encontrou** → o novo Saldo Inicial vira `0,00` (D).
4. A diferença entre o Saldo Inicial antigo e o novo é compensada na
   movimentação — **somando** no Débito (se o saldo antigo era maior) ou no
   Crédito (se era menor). Nunca subtrai, então débito/crédito nunca ficam
   negativos.
5. O **Saldo Final permanece sempre intacto**, igual ao arquivo original.
6. Devolve o `BALANCETE.CSV` corrigido pra download.

A lógica de conciliação está isolada em `src/balancete.js` (sem dependência
de React/DOM), o que facilita testar e dar manutenção.

## Rodando localmente

```bash
npm install
npm run dev
```

## Deploy

Projeto Vite + React puro — funciona direto na Vercel, sem configuração
extra (`npm run build` gera a pasta `dist`).
