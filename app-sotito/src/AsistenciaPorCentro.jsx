import React, { useEffect, useState } from "react";
import { fetchDetalleAsistenciaCentro } from "./data";

export default function AsistenciaPorCentro({ centroId }) {
  const [asistencia, setAsistencia] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!centroId) return;
    setCargando(true);
    fetchDetalleAsistenciaCentro(centroId)
      .then((data) => {
        setAsistencia(data);
        setCargando(false);
      })
      .catch((e) => {
        setError(e.message);
        setCargando(false);
      });
  }, [centroId]);

  if (cargando) {
    return <p className="text-xs text-[#1F3D26]/50 font-mono px-1">Cargando días trabajados…</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="px-4 py-2 bg-red-100 border-2 border-red-700 text-red-800 text-xs font-mono">{error}</div>
      )}

      {asistencia.map((dia) => (
        <section key={dia.fecha} className="bg-white border-2 border-[#1F3D26]">
          <div className="px-4 py-2.5 border-b-2 border-[#1F3D26] bg-[#EFF6EE] flex justify-between items-center">
            <span className="text-sm font-bold uppercase tracking-wide">
              {/* Le agregamos T12:00:00 para evitar problemas de zona horaria al formatear */}
              {new Date(dia.fecha + 'T12:00:00').toLocaleDateString("es-CL", { 
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' 
              })}
            </span>
            <span className="text-xs font-mono text-[#1F3D26]/70">{dia.trabajadores.length} personas</span>
          </div>
          <div className="divide-y divide-[#1F3D26]/10 px-4 py-2 text-sm">
            {dia.trabajadores.map((nombre, i) => (
              <div key={i} className="py-1.5 flex items-center before:content-['•'] before:mr-2 before:text-[#4C9A2A] font-medium">
                {nombre}
              </div>
            ))}
          </div>
        </section>
      ))}

      {!asistencia.length && !error && (
        <p className="text-xs text-[#1F3D26]/40 font-mono px-1">Sin asistencia registrada en este centro.</p>
      )}
    </div>
  );
}