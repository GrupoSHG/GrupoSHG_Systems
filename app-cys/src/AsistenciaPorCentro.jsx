import React, { useEffect, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fetchDetalleAsistenciaCentro } from "./data";

const DIAS_SEMANA = ["L", "M", "M", "J", "V", "S", "D"];

function primerYUltimoDiaMes(year, month) {
  // month: 0-based (0 = enero)
  const inicio = new Date(year, month, 1);
  const fin = new Date(year, month + 1, 0);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { inicio: fmt(inicio), fin: fmt(fin) };
}

export default function AsistenciaPorCentro({ centroId, fechaInicio, fechaFin, compacto = false }) {
  const [asistencia, setAsistencia] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth()); // 0-based

  // Modo compacto (respaldo dentro de un período de facturación): usa el
  // rango exacto que le pasen, sin calendario.
  useEffect(() => {
    if (!centroId) return;
    if (!compacto) return;
    setCargando(true);
    fetchDetalleAsistenciaCentro(centroId, fechaInicio, fechaFin)
      .then((data) => { setAsistencia(data); setCargando(false); })
      .catch((e) => { setError(e.message); setCargando(false); });
  }, [centroId, fechaInicio, fechaFin, compacto]);

  // Modo calendario: trae todo el mes que se está viendo.
  useEffect(() => {
    if (!centroId) return;
    if (compacto) return;
    const { inicio, fin } = primerYUltimoDiaMes(year, month);
    setCargando(true);
    fetchDetalleAsistenciaCentro(centroId, inicio, fin)
      .then((data) => { setAsistencia(data); setCargando(false); })
      .catch((e) => { setError(e.message); setCargando(false); });
  }, [centroId, year, month, compacto]);

  const porFecha = useMemo(() => {
    const m = {};
    asistencia.forEach((d) => { m[d.fecha] = d.trabajadores; });
    return m;
  }, [asistencia]);

  const celdas = useMemo(() => {
    if (compacto) return [];
    const primerDia = new Date(year, month, 1);
    // getDay(): 0=domingo..6=sábado -> lo convertimos a que la semana empiece en lunes
    const offset = (primerDia.getDay() + 6) % 7;
    const totalDias = new Date(year, month + 1, 0).getDate();

    const lista = [];
    for (let i = 0; i < offset; i++) lista.push(null);
    for (let dia = 1; dia <= totalDias; dia++) {
      const fecha = `${year}-${String(month + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      lista.push({ dia, fecha, trabajadores: porFecha[fecha] || [] });
    }
    return lista;
  }, [year, month, porFecha, compacto]);

  const cambiarMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };

  if (cargando) {
    return <p className="text-xs text-[#1F3D26]/50 font-mono px-1">Cargando días trabajados…</p>;
  }

  // ---- Modo compacto: lista chica, respaldo de un período de facturación ----
  if (compacto) {
    return (
      <div className="space-y-1.5">
        {error && <p className="text-xs text-red-700 font-mono">{error}</p>}
        {asistencia.map((dia) => (
          <div key={dia.fecha} className="flex items-start gap-2 text-xs font-mono">
            <span className="text-[#1F3D26]/50 shrink-0 w-16">
              {new Date(dia.fecha + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
            </span>
            <span className="text-[#1F3D26]">{dia.trabajadores.join(", ")}</span>
          </div>
        ))}
        {!asistencia.length && !error && (
          <p className="text-xs text-[#1F3D26]/40 font-mono">Sin asistencia registrada en este período.</p>
        )}
      </div>
    );
  }

  // ---- Modo calendario: mes completo, un día por celda ----
  return (
    <div className="space-y-3">
      {error && (
        <div className="px-4 py-2 bg-red-100 border-2 border-red-700 text-red-800 text-xs font-mono">{error}</div>
      )}

      <div className="flex items-center justify-between bg-white border-2 border-[#1F3D26] px-3 py-2">
        <button onClick={() => cambiarMes(-1)} className="p-1 hover:bg-[#EFF6EE]">
          <ChevronLeft size={16} className="text-[#1F3D26]" />
        </button>
        <span className="text-sm font-bold uppercase tracking-wide">
          {new Date(year, month, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => cambiarMes(1)} className="p-1 hover:bg-[#EFF6EE]">
          <ChevronRight size={16} className="text-[#1F3D26]" />
        </button>
      </div>

      <div className="bg-white border-2 border-[#1F3D26] p-2">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DIAS_SEMANA.map((d, i) => (
            <div key={i} className="text-center text-[10px] font-bold text-[#1F3D26]/50 uppercase">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {celdas.map((c, i) => {
            if (!c) return <div key={i} />;
            const trabajaron = c.trabajadores.length > 0;
            return (
              <div
                key={c.fecha}
                className={`min-h-[54px] border p-1 text-[10px] font-mono ${
                  trabajaron ? "bg-[#EFF6EE] border-[#4C9A2A]" : "border-[#1F3D26]/10"
                }`}
                title={c.trabajadores.join(", ")}
              >
                <div className={`text-right font-bold ${trabajaron ? "text-[#1F3D26]" : "text-[#1F3D26]/40"}`}>
                  {c.dia}
                </div>
                {trabajaron && (
                  <div className="mt-0.5 space-y-0.5 leading-tight">
                    {c.trabajadores.slice(0, 3).map((nombre, j) => (
                      <div key={j} className="truncate text-[#2C5233]">{nombre.split(" ")[0]}</div>
                    ))}
                    {c.trabajadores.length > 3 && (
                      <div className="text-[#1F3D26]/50">+{c.trabajadores.length - 3} más</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!asistencia.length && !error && (
        <p className="text-xs text-[#1F3D26]/40 font-mono px-1">Sin asistencia registrada este mes.</p>
      )}
    </div>
  );
}
