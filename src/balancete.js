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
// O arquivo é organizado em BLOCOS: uma linha tipo "10" (totalizador de uma
// conta contábil) seguida por N linhas de detalhe (outros tipos), até a
// próxima linha "10". O campo 2 (conta) + campo 3 (subconta) identificam a
// qual bloco uma linha pertence — é igual na linha 10 e em todas as linhas
// de detalhe daquele bloco.
//
// O QUE ESTE MÓDULO FAZ (linhas de detalhe, tipo != 10):
//   1. Saldo Final de toda linha existente fica INTOCADO.
//   2. Saldo Inicial passa a ser igual ao Saldo Final do mês anterior da
//      mesma chave.
//   3. A diferença é compensada na movimentação (Debito OU Credito, nunca os
//      dois, nunca subtrai — só soma no lado que precisar).
//   4. Chave nova (não existia no mês anterior) -> Saldo Inicial = 0,00.
//   5. Chave que existia no mês anterior mas não existe mais no mês atual ->
//      a linha é RECRIADA no mês atual, com Saldo Final forçado em 0,00 e a
//      movimentação calculada para fechar a conta a partir do saldo inicial
//      (que vem do saldo final do mês anterior).
//
// LINHAS TOTALIZADORAS (tipo == 10):
//   Não usam a lógica acima. Depois que todas as linhas de detalhe de um
//   bloco já estão corrigidas (incluindo as recriadas), o totalizador do
//   bloco é recalculado como a SOMA dessas linhas de detalhe.

const NUM_CAMPOS_FINANCEIROS = 6; // SaldoInicial, NatInicial, Debito, Credito, SaldoFinal, NatFinal
const TIPO_TOTALIZADOR = '10';

/** "1234,56" -> 1234.56 (no arquivo não há separador de milhar) */
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

/** Converte número com sinal de volta em {valor, natureza}. Zero -> D (convenção). */
function deSigned(signed) {
  if (signed < 0) return { valor: -signed, natureza: 'C' };
  return { valor: signed, natureza: 'D' };
}

/**
 * Quebra uma linha do balancete nos campos de chave + campos financeiros.
 * Retorna null para linhas vazias/inválidas.
 */
function parseLinha(linha) {
  if (!linha || !linha.trim()) return null;

  const campos = linha.split(';');
  if (campos.length < NUM_CAMPOS_FINANCEIROS + 2) return null; // tipo + conta + subconta + financeiros

  const corte = campos.length - NUM_CAMPOS_FINANCEIROS;
  const camposChave = campos.slice(0, corte);
  const [saldoInicialStr, natInicial, debitoStr, creditoStr, saldoFinalStr, natFinal] =
    campos.slice(corte);

  return {
    tipo: camposChave[0],
    contaKey: `${camposChave[1]};${camposChave[2]}`, // liga a linha de detalhe ao seu totalizador
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

/** Agrupa os registros (já parseados, em ordem) em blocos por conta+subconta. */
function agruparEmBlocos(registros) {
  const ordem = []; // contaKeys na ordem em que aparecem
  const porContaKey = new Map(); // contaKey -> { tipo10, detalhes: [] }

  let blocoAtual = null;

  for (const registro of registros) {
    if (registro.tipo === TIPO_TOTALIZADOR) {
      blocoAtual = { tipo10: registro, detalhes: [] };
      porContaKey.set(registro.contaKey, blocoAtual);
      ordem.push(registro.contaKey);
    } else if (blocoAtual) {
      blocoAtual.detalhes.push(registro);
    }
    // detalhe sem bloco aberto ainda (não deveria acontecer no layout real) é ignorado
  }

  return { ordem, porContaKey };
}

/** Corrige uma linha de detalhe existente no mês atual, usando o mês anterior. */
function corrigirLinhaExistente(registroAtual, registroAnterior) {
  const encontrouChave = registroAnterior !== undefined;

  const novoSaldoInicial = encontrouChave
    ? { valor: registroAnterior.saldoFinal, natureza: registroAnterior.natFinal }
    : { valor: 0, natureza: 'D' };

  const saldoFinalAnteriorSigned = paraSigned(novoSaldoInicial.valor, novoSaldoInicial.natureza);
  const saldoInicialAntigoSigned = paraSigned(registroAtual.saldoInicial, registroAtual.natInicial);
  const diferenca = saldoInicialAntigoSigned - saldoFinalAnteriorSigned;

  let { debito, credito } = registroAtual;
  if (diferenca > 0) debito += diferenca;
  else if (diferenca < 0) credito += -diferenca;

  return {
    registro: {
      ...registroAtual,
      saldoInicial: novoSaldoInicial.valor,
      natInicial: novoSaldoInicial.natureza,
      debito,
      credito,
      // saldoFinal e natFinal permanecem os mesmos de registroAtual
    },
    encontrouChave,
    alterada: diferenca !== 0,
  };
}

/** Cria uma linha de detalhe nova (existia no mês anterior, não existe no atual), já zerada. */
function criarLinhaZerada(registroAnterior) {
  const saldoInicial = { valor: registroAnterior.saldoFinal, natureza: registroAnterior.natFinal };
  const saldoInicialSigned = paraSigned(saldoInicial.valor, saldoInicial.natureza);

  // parte de débito=0,00 / crédito=0,00 (linha nova) e precisa fechar em saldo final 0,00:
  // Debito - Credito = SaldoFinal(0) - SaldoInicial = -saldoInicialSigned
  const necessario = -saldoInicialSigned;
  const debito = necessario > 0 ? necessario : 0;
  const credito = necessario < 0 ? -necessario : 0;

  return {
    tipo: registroAnterior.tipo,
    contaKey: registroAnterior.contaKey,
    camposChave: registroAnterior.camposChave,
    saldoInicial: saldoInicial.valor,
    natInicial: saldoInicial.natureza,
    debito,
    credito,
    saldoFinal: 0,
    natFinal: 'D',
  };
}

/** Soma uma lista de registros de detalhe e devolve os valores do totalizador. */
function somarParaTotalizador(registrosDetalhe) {
  let somaInicial = 0;
  let somaDebito = 0;
  let somaCredito = 0;
  let somaFinal = 0;

  for (const r of registrosDetalhe) {
    somaInicial += paraSigned(r.saldoInicial, r.natInicial);
    somaDebito += r.debito;
    somaCredito += r.credito;
    somaFinal += paraSigned(r.saldoFinal, r.natFinal);
  }

  const inicial = deSigned(somaInicial);
  const final = deSigned(somaFinal);

  return {
    saldoInicial: inicial.valor,
    natInicial: inicial.natureza,
    debito: somaDebito,
    credito: somaCredito,
    saldoFinal: final.valor,
    natFinal: final.natureza,
  };
}

function registroParaLinha(registro) {
  return [
    ...registro.camposChave,
    formatValor(registro.saldoInicial),
    registro.natInicial,
    formatValor(registro.debito),
    formatValor(registro.credito),
    formatValor(registro.saldoFinal),
    registro.natFinal,
  ].join(';');
}

/**
 * Aplica a conciliação: recebe o CSV do mês atual e o CSV do mês anterior,
 * devolve o CSV corrigido (mês atual com saldo inicial ajustado, linhas
 * recriadas quando necessário e totalizadores recalculados).
 */
export function conciliarBalancete(textoCsvAtual, textoCsvAnterior) {
  const registrosAtual = textoCsvAtual.split('\n').map(parseLinha).filter(Boolean);
  const registrosAnterior = textoCsvAnterior.split('\n').map(parseLinha).filter(Boolean);

  const blocosAtual = agruparEmBlocos(registrosAtual);
  const blocosAnterior = agruparEmBlocos(registrosAnterior);

  // mapa chave completa (tipo+conta+...) -> registro do mês anterior, só de linhas de detalhe
  const mapaDetalheAnterior = new Map();
  for (const registro of registrosAnterior) {
    if (registro.tipo !== TIPO_TOTALIZADOR) mapaDetalheAnterior.set(registro.chave, registro);
  }

  const linhasSaida = [];
  const resumo = {
    totalLinhas: 0,
    linhasAlteradas: 0,
    chavesNaoEncontradas: 0,
    linhasCriadas: 0,
    totalizadores: 0,
  };

  function processarBloco(contaKey, blocoAtual, blocoAnterior) {
    const detalhesCorrigidos = [];

    // 1) corrige cada linha de detalhe que já existe no mês atual
    for (const registroAtual of blocoAtual ? blocoAtual.detalhes : []) {
      resumo.totalLinhas++;
      const registroAnteriorCorrespondente = mapaDetalheAnterior.get(registroAtual.chave);
      const { registro, encontrouChave, alterada } = corrigirLinhaExistente(
        registroAtual,
        registroAnteriorCorrespondente
      );
      detalhesCorrigidos.push(registro);
      if (!encontrouChave) resumo.chavesNaoEncontradas++;
      if (alterada) resumo.linhasAlteradas++;
    }

    // 2) recria linhas que existiam no mês anterior (mesma conta) e desapareceram do atual
    const chavesJaPresentes = new Set(detalhesCorrigidos.map((r) => r.chave));
    for (const registroAnterior of blocoAnterior ? blocoAnterior.detalhes : []) {
      if (chavesJaPresentes.has(registroAnterior.chave)) continue;
      const novaLinha = criarLinhaZerada(registroAnterior);
      detalhesCorrigidos.push(novaLinha);
      resumo.linhasCriadas++;
    }

    resumo.totalLinhas++; // a linha do totalizador em si
    resumo.totalizadores++;

    // CASO ESPECIAL: bloco sem nenhuma linha de detalhe (nem original, nem recriada) — algumas
    // contas no layout não têm breakdown, só a linha "10" sozinha. Nesse caso o totalizador
    // não tem nada pra somar, então segue a MESMA regra das linhas de detalhe (match direto
    // por chave / recriação), em vez da soma.
    if (detalhesCorrigidos.length === 0) {
      let linhaTotalizador;
      if (blocoAtual) {
        const anteriorTotalizador = blocoAnterior ? blocoAnterior.tipo10 : undefined;
        const { registro, encontrouChave, alterada } = corrigirLinhaExistente(
          blocoAtual.tipo10,
          anteriorTotalizador
        );
        linhaTotalizador = registro;
        if (!encontrouChave) resumo.chavesNaoEncontradas++;
        if (alterada) resumo.linhasAlteradas++;
      } else {
        linhaTotalizador = criarLinhaZerada(blocoAnterior.tipo10);
        resumo.linhasCriadas++;
      }
      linhasSaida.push(registroParaLinha(linhaTotalizador));
      return;
    }

    // 3) recalcula o totalizador (10) do bloco como soma das linhas de detalhe já corrigidas
    const totalizadorSomado = somarParaTotalizador(detalhesCorrigidos);
    const camposChaveTotalizador = blocoAtual
      ? blocoAtual.tipo10.camposChave
      : blocoAnterior.tipo10.camposChave; // bloco inteiro novo, recriado a partir do mês anterior

    linhasSaida.push(
      registroParaLinha({ camposChave: camposChaveTotalizador, ...totalizadorSomado })
    );
    for (const detalhe of detalhesCorrigidos) {
      linhasSaida.push(registroParaLinha(detalhe));
    }
  }

  // processa primeiro os blocos na ordem em que aparecem no mês atual
  for (const contaKey of blocosAtual.ordem) {
    const blocoAtual = blocosAtual.porContaKey.get(contaKey);
    const blocoAnterior = blocosAnterior.porContaKey.get(contaKey);
    processarBloco(contaKey, blocoAtual, blocoAnterior);
  }

  // depois, blocos que só existem no mês anterior (conta inteira desapareceu do atual)
  for (const contaKey of blocosAnterior.ordem) {
    if (blocosAtual.porContaKey.has(contaKey)) continue; // já processado acima
    const blocoAnterior = blocosAnterior.porContaKey.get(contaKey);
    processarBloco(contaKey, null, blocoAnterior);
  }

  return {
    csvCorrigido: linhasSaida.join('\n'),
    resumo,
  };
}
