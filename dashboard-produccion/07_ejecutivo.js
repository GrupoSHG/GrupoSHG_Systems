// ═══════════════════════════════════════════════════════════════════════════
// NIVEL EJECUTIVO — KPIs consolidados con semáforo (Meta / Real / Desviación /
// Tendencia / Estado), separados del detalle operativo por prensa/OP.
// ═══════════════════════════════════════════════════════════════════════════

// Jornada de 9h, misma que usa PLAN_CONFIG.jornadaH en 05_plan.js y el
// cálculo de META_POR_HORA en 00_config.js (170 m²/jornada por prensa).
const JORNADA_H_EJECUTIVO = 9;

// Mismo umbral que ya usa getRendimientoPrensas() (cumple: pct >= 90).
const META_PCT_EFICIENCIA = 90;

function getEficienciaEjecutiva() {
  try {
    const ss   = SpreadsheetApp.openById(ID_WIP);
    const hoja = ss.getSheetByName("M2 Producidos");
    if (!hoja) return { error: "No se encontró 'M2 Producidos'" };

    const data = hoja.getDataRange().getValues();

    // Meta diaria total = suma de META_POR_HORA de las 7 prensas × jornada.
    // Con los valores actuales: 18.89 × 7 × 9 ≈ 1190 m²/día.
    let metaDiariaTotal = 0;
    for (const k in META_POR_HORA) metaDiariaTotal += META_POR_HORA[k];
    metaDiariaTotal *= JORNADA_H_EJECUTIVO;

    // Acumular m² PA por día (mismo criterio que el resto de 01_produccion.js:
    // excluye PC4/Bandejera, que son PSA).
    const porDia = {};
    for (let i = 1; i < data.length; i++) {
      const marca  = data[i][0];
      const prensa = (data[i][1] || '').toString().trim().toUpperCase();
      const m2     = parseFloat(data[i][2]) || 0;
      if (!marca || m2 <= 0) continue;
      const esPSA = prensa.includes('PC4') || prensa.includes('BANDEJERA') || prensa.includes('BAND');
      if (esPSA) continue;
      const f = parseDateCustom(marca);
      if (!f) continue;
      const key = f.getFullYear() + '-' + String(f.getMonth()).padStart(2,'0') + '-' + String(f.getDate()).padStart(2,'0');
      porDia[key] = (porDia[key] || 0) + m2;
    }

    function keyDeFecha(d) {
      return d.getFullYear() + '-' + String(d.getMonth()).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function datoDelDia(d) {
      const real = porDia[keyDeFecha(d)] || 0;
      const pct  = metaDiariaTotal > 0 ? (real / metaDiariaTotal) * 100 : 0;
      return { real: Math.round(real), pct: pct };
    }

    const hoy      = new Date(); hoy.setHours(0,0,0,0);
    const ayer     = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const anteayer = new Date(hoy); anteayer.setDate(hoy.getDate() - 2);

    // El dato "oficial" del semáforo es AYER (día cerrado y comparable) —
    // no hoy, que todavía está en curso y no es un número final.
    const datoAyer     = datoDelDia(ayer);
    const datoAnteayer = datoDelDia(anteayer);
    const datoHoy      = datoDelDia(hoy); // se muestra aparte, como referencia "en curso"

    // Serie de los últimos 14 días, para graficar tendencia.
    const serie = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(hoy); d.setDate(hoy.getDate() - i);
      const dato = datoDelDia(d);
      serie.push({
        fecha: String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'),
        real:  dato.real,
        pct:   Math.round(dato.pct * 10) / 10
      });
    }

    const desviacionPp   = Math.round((datoAyer.pct - META_PCT_EFICIENCIA) * 10) / 10;
    const diffTendencia  = datoAyer.pct - datoAnteayer.pct;
    const tendencia      = diffTendencia > 2 ? 'subida' : diffTendencia < -2 ? 'bajada' : 'estable';
    const estado         = datoAyer.pct >= META_PCT_EFICIENCIA ? 'verde'
                          : datoAyer.pct >= 75 ? 'amarillo' : 'rojo';

    return {
      meta_pct:       META_PCT_EFICIENCIA,
      meta_m2_dia:    Math.round(metaDiariaTotal),
      real_ayer_m2:   datoAyer.real,
      real_ayer_pct:  Math.round(datoAyer.pct * 10) / 10,
      desviacion_pp:  desviacionPp,
      tendencia:      tendencia,
      estado:         estado,
      fecha_ayer:     String(ayer.getDate()).padStart(2,'0') + '/' + String(ayer.getMonth()+1).padStart(2,'0') + '/' + ayer.getFullYear(),
      hoy_en_curso: {
        real_m2: datoHoy.real,
        pct:     Math.round(datoHoy.pct * 10) / 10
      },
      serie_14_dias: serie
    };
  } catch(e) {
    return { error: "Error getEficienciaEjecutiva: " + e.toString() };
  }
}
