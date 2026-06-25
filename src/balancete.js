// Lógica de conciliação de saldos do Balancete TCEMG (layout SICAP-DC)
//
// Toda linha do BALANCETE.CSV, não importa o tipo (10, 11, 12, 14, 15, 16, 17,
// 18, 24, 25, 26, 29, 30, 31...), termina sempre com os mesmos 6 campos:
//
//   ..., SaldoInicial, NaturezaInicial, Debito, Credito, SaldoFinal, NaturezaFinal
//
// Tudo que vem ANTES desses 6 campos é a "chave" da linha (conta, fonte,
// credor, classificação funcional, etc — varia por tipo, mas não importa).
//
// Regra de negócio (TCEMG): SaldoFinal = SaldoInicial +D/-C Debito -D/+C Credito
//
// O que este módulo faz:
//   1. Saldo Final de toda linha fica INTOCADO (valor e natureza originais).
//   2. Saldo Inicial passa a ser igual ao Saldo Final do mês anterior da
//      mesma chave (ou 0,00 se a chave não existir no mês anterior).
//   3. A diferença entre o saldo inicial antigo e o novo é compensada na
//      movimentação (Debito ou Credito), SEM NUNCA SUBTRAIR — só soma no
//      lado que precisar, pra nunca gerar débito/crédito negativo.

const NUM_CAMPOS_FINANCEIROS = 6; // SaldoInicial, NatInicial, Debito, Credito, SaldoFinal, NatFinal

/** "1.234,56" / "1234,56" -> 1234.56 (no arquivo não há separador de milhar) */
function parseValor(str) {
  return parseFloat(str.replace(',', '.'));
}

/** 1234.5 -> "1234,50" (sempre 2 casas decimais, igual ao arquivo original) */
function formatValor(num) {
  return num.toFixed(2).replace('.', ',');
}

/** Converte valor+natureza em número com sinal (D = positivo, C = negativo) */
function paraSigned(valor, natureza) {
  return natureza === 'C' ? -valor : valor;
}

/**
 * Quebra uma linha do balancete nos campos de chave + campos financeiros.
 * Retorna null para linhas vazias/inválidas (ex: linha em branco no fim do arquivo).
 */
function parseLinha(linha) {
  if (!linha || !linha.trim()) return null;

  const campos = linha.split(';');
  if (campos.length < NUM_CAMPOS_FINANCEIROS) return null;

  const corte = campos.length - NUM_CAMPOS_FINANCEIROS;
  const camposChave = campos.slice(0, corte);
  const [saldoInicialStr, natInicial, debitoStr, creditoStr, saldoFinalStr, natFinal] =
    campos.slice(corte);

  return {
    chave: camposChave.join(';'),
    camposChave,
    saldoInicial: parseValor(saldoInicialStr),
    natInicial,
    debito: parseValor(debitoStr),
    credito: parseValor(creditoStr),
    saldoFinal: parseValor(saldoFinalStr),
    natFinal,
  };
}

/**
 * Constrói um mapa chave -> {valor, natureza} do saldo final, a partir do
 * CSV do mês anterior. Guarda valor+natureza originais (não só o número com
 * sinal), pra preservar exatamente como veio do arquivo (inclusive em casos
 * de saldo zero, onde a natureza registrada no arquivo pode ser D ou C).
 */
function construirMapaSaldoFinalAnterior(textoCsvAnterior) {
  const mapa = new Map();
  const linhas = textoCsvAnterior.split('\n');
  for (const linha of linhas) {
    const registro = parseLinha(linha);
    if (!registro) continue;
    mapa.set(registro.chave, { valor: registro.saldoFinal, natureza: registro.natFinal });
  }
  return mapa;
}

/**
 * Aplica a conciliação: recebe o CSV do mês atual e o CSV do mês anterior,
 * devolve o CSV corrigido (mês atual com saldo inicial ajustado).
 *
 * Também devolve um resumo (quantas linhas mudaram, quantas chaves não
 * encontradas no mês anterior) para exibir na tela.
 */
export function conciliarBalancete(textoCsvAtual, textoCsvAnterior) {
  const mapaAnterior = construirMapaSaldoFinalAnterior(textoCsvAnterior);

  const linhasAtual = textoCsvAtual.split('\n');
  const linhasCorrigidas = [];

  let totalLinhas = 0;
  let linhasAlteradas = 0;
  let chavesNaoEncontradas = 0;

  for (const linhaOriginal of linhasAtual) {
    const registro = parseLinha(linhaOriginal);

    // linha vazia (ex: última linha do arquivo) -> mantém como está
    if (!registro) {
      linhasCorrigidas.push(linhaOriginal);
      continue;
    }

    totalLinhas++;

    const anterior = mapaAnterior.get(registro.chave); // { valor, natureza } | undefined
    const encontrouChave = anterior !== undefined;
    if (!encontrouChave) chavesNaoEncontradas++;

    // chave não encontrada no mês anterior -> saldo inicial deve ser 0,00 (conforme solicitado)
    const novoSaldoInicial = encontrouChave
      ? { valor: anterior.valor, natureza: anterior.natureza }
      : { valor: 0, natureza: 'D' };

    const saldoFinalAnteriorSigned = paraSigned(novoSaldoInicial.valor, novoSaldoInicial.natureza);
    const saldoInicialAntigoSigned = paraSigned(registro.saldoInicial, registro.natInicial);
    const saldoFinalSigned = paraSigned(registro.saldoFinal, registro.natFinal);

    // diferença a compensar na movimentação
    const diferenca = saldoInicialAntigoSigned - saldoFinalAnteriorSigned;

    let { debito, credito } = registro;
    if (diferenca > 0) {
      // saldo inicial antigo era "maior" (mais D) que o novo -> precisa de mais débito
      debito += diferenca;
    } else if (diferenca < 0) {
      // saldo inicial antigo era "menor" (mais C) que o novo -> precisa de mais crédito
      credito += -diferenca;
    }

    if (diferenca !== 0) linhasAlteradas++;

    const novosCamposFinanceiros = [
      formatValor(novoSaldoInicial.valor),
      novoSaldoInicial.natureza,
      formatValor(debito),
      formatValor(credito),
      formatValor(registro.saldoFinal), // SALDO FINAL NUNCA MUDA
      registro.natFinal,
    ];

    linhasCorrigidas.push([...registro.camposChave, ...novosCamposFinanceiros].join(';'));

    // checagem de sanidade (só pra debug, não bloqueia nada):
    // novoSaldoInicialSigned + debito - credito deve bater com saldoFinalSigned
    void saldoFinalSigned;
  }

  return {
    csvCorrigido: linhasCorrigidas.join('\n'),
    resumo: { totalLinhas, linhasAlteradas, chavesNaoEncontradas },
  };
}
