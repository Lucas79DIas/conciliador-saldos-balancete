# Conciliador de Saldos — Balancete TCEMG

Aplicação web simples para ajustar o **saldo inicial** do Balancete (layout
SICAP-DC) do mês atual, fazendo-o bater com o **saldo final** do mês
anterior — exigência comum do TCEMG.

## Como funciona

Você sobe dois arquivos `.zip` (o balancete do mês anterior e o do mês
atual). A aplicação extrai o `BALANCETE.CSV` de dentro de cada zip e aplica
as regras abaixo.

O arquivo é organizado em **blocos**: uma linha tipo `10` (totalizador de
uma conta contábil) seguida por N linhas de detalhe, até a próxima linha
`10`. Algumas contas não têm nenhuma linha de detalhe — só a própria `10`.

### Linhas de detalhe (tipo != 10)

1. **Saldo Final** de toda linha existente fica **intocado**.
2. **Saldo Inicial** passa a ser igual ao **Saldo Final do mês anterior**
   da mesma chave (chave = tudo antes dos 6 últimos campos: Saldo Inicial,
   Natureza, Débito, Crédito, Saldo Final, Natureza).
3. A diferença é compensada na movimentação — **somando** no Débito (se o
   saldo antigo era maior) ou no Crédito (se era menor). Nunca subtrai,
   então débito/crédito nunca ficam negativos.
4. Chave nova (não existia no mês anterior) → Saldo Inicial = `0,00`.
5. Chave que existia no mês anterior mas **não existe mais no atual** → a
   linha é **recriada** no mês atual, com Saldo Final forçado em `0,00` e a
   movimentação calculada para fechar a conta a partir do saldo inicial
   (que vem do saldo final do mês anterior).

### Linhas totalizadoras (tipo == 10)

Depois que todas as linhas de detalhe de um bloco já estão corrigidas
(incluindo as recriadas pela regra 5), o totalizador do bloco é
**recalculado como a soma** dessas linhas de detalhe — não usa mais a
lógica de match por chave do mês anterior.

**Exceção:** se um bloco não tiver nenhuma linha de detalhe (nem original,
nem recriada), não há nada pra somar — nesse caso o próprio totalizador
segue a mesma regra das linhas de detalhe (1 a 5).

**Conta que desapareceu inteira** (totalizador + todas as linhas de
detalhe) também é recriada automaticamente: cada linha de detalhe é
recriada zerada (regra 5) e o totalizador some essas linhas — resultando
num bloco com Saldo Final `0,00`, como esperado.

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
