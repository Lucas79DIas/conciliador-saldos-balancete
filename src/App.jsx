import { useState } from 'react';
import JSZip from 'jszip';
import { conciliarBalancete } from './balancete.js';

/** Acha o BALANCETE.CSV dentro do zip, sem importar de caixa ou de pasta */
async function extrairBalanceteDoZip(arquivoZip) {
  const zip = await JSZip.loadAsync(arquivoZip);
  const entrada = Object.values(zip.files).find(
    (f) => !f.dir && /(^|\/)balancete\.csv$/i.test(f.name)
  );
  if (!entrada) {
    throw new Error(`Não encontrei um arquivo "BALANCETE.CSV" dentro de ${arquivoZip.name}.`);
  }
  // o arquivo usa codificação latin1 (acentos/cedilha em campos de texto)
  const buffer = await entrada.async('arraybuffer');
  return new TextDecoder('iso-8859-1').decode(buffer);
}

function FileDropInput({ label, file, onChange }) {
  return (
    <label className="campo-arquivo">
      <span className="campo-arquivo-label">{label}</span>
      <input
        type="file"
        accept=".zip"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file && <span className="campo-arquivo-nome">{file.name}</span>}
    </label>
  );
}

export default function App() {
  const [zipAnterior, setZipAnterior] = useState(null);
  const [zipAtual, setZipAtual] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null); // { csvCorrigido, resumo }

  const podeConciliar = zipAnterior && zipAtual && !processando;

  async function handleConciliar() {
    setErro(null);
    setResultado(null);
    setProcessando(true);
    try {
      const [csvAnterior, csvAtual] = await Promise.all([
        extrairBalanceteDoZip(zipAnterior),
        extrairBalanceteDoZip(zipAtual),
      ]);
      const { csvCorrigido, resumo } = conciliarBalancete(csvAtual, csvAnterior);
      setResultado({ csvCorrigido, resumo });
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProcessando(false);
    }
  }

  function handleBaixar() {
    if (!resultado) return;
    // de volta pra latin1, igual ao arquivo original
    const bytes = new Uint8Array(
      [...resultado.csvCorrigido].map((c) => c.charCodeAt(0) & 0xff)
    );
    const blob = new Blob([bytes], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BALANCETE.CSV';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pagina">
      <main className="cartao">
        <h1>Conciliador de Saldos — Balancete</h1>
        <p className="subtitulo">
          Ajusta o saldo inicial do balancete do mês atual para bater com o saldo
          final do mês anterior, compensando a diferença em débito/crédito.
        </p>

        <div className="campos">
          <FileDropInput
            label="Balancete do mês anterior (.zip)"
            file={zipAnterior}
            onChange={setZipAnterior}
          />
          <FileDropInput
            label="Balancete do mês atual (.zip)"
            file={zipAtual}
            onChange={setZipAtual}
          />
        </div>

        <button className="botao-principal" disabled={!podeConciliar} onClick={handleConciliar}>
          {processando ? 'Conciliando...' : 'Conciliar'}
        </button>

        {erro && <p className="mensagem-erro">{erro}</p>}

        {resultado && (
          <div className="resultado">
            <ul className="resumo">
              <li>
                <strong>{resultado.resumo.totalLinhas}</strong> linhas no balancete corrigido
              </li>
              <li>
                <strong>{resultado.resumo.linhasAlteradas}</strong> linhas com saldo inicial
                corrigido
              </li>
              <li>
                <strong>{resultado.resumo.chavesNaoEncontradas}</strong> chaves sem
                correspondência no mês anterior (saldo inicial zerado)
              </li>
              <li>
                <strong>{resultado.resumo.linhasCriadas}</strong> linhas recriadas (existiam no
                mês anterior e não existem mais no atual)
              </li>
            </ul>
            <button className="botao-secundario" onClick={handleBaixar}>
              Baixar BALANCETE.CSV corrigido
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
