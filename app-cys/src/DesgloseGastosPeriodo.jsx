import React, { useEffect, useState } from "react";
import { fetchGastosPorCategoriaPeriodo } from "./data";

const clp = (n) => (n ?? 0).toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

// Desglose Materiales / Petróleo / Otros para UN período exacto de un CD.
// Vive dentro del bloque de facturación, justo debajo de "Gastos netos".
export default function DesgloseGastosPeriodo({ centroId, fechaInicio, fechaFin }) {
  const [totales, setTotales] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!centroId || !fechaInicio || !fechaFin) return;
    fetchGastosPorCategoriaPeriodo(centroId, fechaInicio, fechaFin)
      .then(setTotales)
      .catch((e) => setError(e.message));
  }, [centroId, fechaInicio, fechaFin]);

  if (error) return <p className="text-[11px] text-red-700 font-mono">{error}</p>;
  if (!totales) return null;

  const hayGastos = totales.Materiales + totales.Petroleo + totales.Otros > 0;
  if (!hayGastos) return null;

  return (
    <div className="pl-3 space-y-0.5 text-[11px] font-mono text-[#1F3D26]/70">
      {totales.Materiales > 0 && (
        <div className="flex justify-between"><span>— Materiales</span><span>{clp(totales.Materiales)}</span></div>
      )}
      {totales.Petroleo > 0 && (
        <div className="flex justify-between"><span>— Petróleo</span><span>{clp(totales.Petroleo)}</span></div>
      )}
      {totales.Otros > 0 && (
        <div className="flex justify-between"><span>— Otros</span><span>{clp(totales.Otros)}</span></div>
      )}
    </div>
  );
}
