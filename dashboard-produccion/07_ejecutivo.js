// ═══════════════════════════════════════════════════════════════════════════
// NIVEL EJECUTIVO — KPIs consolidados con semáforo (Meta / Real / Desviación /
// Tendencia / Estado), separados del detalle operativo por prensa/OP.
// ═══════════════════════════════════════════════════════════════════════════

// Jornada de 9h, misma que usa PLAN_CONFIG.jornadaH en 05_plan.js.
const JORNADA_H_EJECUTIVO = 9;

// Mismo umbral que ya usa getRendimientoPrensas() (cumple: pct >= 90).
const META_PCT_EFICIENCIA = 90;

function getEficienciaEjecutiva() {
  try {
    const ss   = SpreadsheetApp.openById(ID_WIP);
    const hoja = ss.getSheetByName("M2 Producidos");
    if (!hoja) return { error: "No se encontró 'M2 Producidos'" };

    const data = hoja.getDataRange().getValues();

    // Meta diaria POR PRENSA = META_POR_HORA de esa prensa × jornada de 9h.
    // Con 25 m²/h: 25 × 9 = 225 m²/día por prensa.
    const metaDiariaPorPrensa = {};
    for (const k in META_POR_HORA) metaDiariaPorPrensa[k] = META_POR_HORA[k] * JORNADA_H_EJECUTIVO;

    // Acumular m² PA por (día, prensa). Mismo criterio de siempre: excluye
    // PC4/Bandejera (PSA). La columna "Prensa" trae texto tipo "Prensa 1",
    // se normaliza a la clave "P1" usada en META_POR_HORA.
    const porDiaYPrensa = {}; // { 'YYYY-M-D': { P1: m2, P2: m2, ... } }
    for (let i = 1; i < data.length; i++) {
      const marca       = data[i][0];
      const prensaTexto = (data[i][1] || '').toString().trim().toUpperCase();
      const m2          = parseFloat(data[i][2]) || 0;
      if (!marca || m2 <= 0) continue;

      const esPSA = prensaTexto.includes('PC4') || prensaTexto.includes('BANDEJERA') || prensaTexto.includes('BAND');
      if (esPSA) continue;

      const matchNum = prensaTexto.match(/(\d+)/);
      if (!matchNum) continue;
      const prensaKey = 'P' + matchNum[1];
      if (!META_POR_HORA.hasOwnProperty(prensaKey)) continue; // ignora prensas fuera de P1-P7

      const f = parseDateCustom(marca);
      if (!f) continue;

      const diaKey = f.getFullYear() + '-' + String(f.getMonth()).padStart(2,'0') + '-' + String(f.getDate()).padStart(2,'0');
      if (!porDiaYPrensa[diaKey]) porDiaYPrensa[diaKey] = {};
      porDiaYPrensa[diaKey][prensaKey] = (porDiaYPrensa[diaKey][prensaKey] || 0) + m2;
    }

    function keyDeFecha(d) {
      return d.getFullYear() + '-' + String(d.getMonth()).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function realDelDia(d, prensaKey) {
      const dia = porDiaYPrensa[keyDeFecha(d)];
      return dia ? (dia[prensaKey] || 0) : 0;
    }

    const hoy      = new Date(); hoy.setHours(0,0,0,0);
    const ayer     = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const anteayer = new Date(hoy); anteayer.setDate(hoy.getDate() - 2);

    const prensasKeys = Object.keys(META_POR_HORA).sort(); // P1..P7
    const prensas = [];

    let sumaMetaAyer = 0, sumaRealAyer = 0;

    prensasKeys.forEach(function (prensaKey) {
      const metaDia = metaDiariaPorPrensa[prensaKey];

      const realAyer     = realDelDia(ayer, prensaKey);
      const realAnteayer = realDelDia(anteayer, prensaKey);
      const realHoy       = realDelDia(hoy, prensaKey);

      const pctAyer     = metaDia > 0 ? (realAyer / metaDia) * 100 : 0;
      const pctAnteayer = metaDia > 0 ? (realAnteayer / metaDia) * 100 : 0;
      const pctHoy      = metaDia > 0 ? (realHoy / metaDia) * 100 : 0;

      const desviacionPp  = Math.round((pctAyer - META_PCT_EFICIENCIA) * 10) / 10;
      const diffTendencia = pctAyer - pctAnteayer;
      const tendencia     = diffTendencia > 2 ? 'subida' : diffTendencia < -2 ? 'bajada' : 'estable';
      const estado        = pctAyer >= META_PCT_EFICIENCIA ? 'verde' : pctAyer >= 75 ? 'amarillo' : 'rojo';

      // Serie de 14 días para el gráfico combinado.
      const serie14 = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(hoy); d.setDate(hoy.getDate() - i);
        const real = realDelDia(d, prensaKey);
        const pct  = metaDia > 0 ? (real / metaDia) * 100 : 0;
        serie14.push({
          fecha: String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'),
          pct: Math.round(pct * 10) / 10
        });
      }

      prensas.push({
        prensa:         prensaKey,
        meta_m2_hora:   META_POR_HORA[prensaKey],
        meta_m2_dia:    Math.round(metaDia),
        real_ayer_m2:   Math.round(realAyer),
        real_ayer_pct:  Math.round(pctAyer * 10) / 10,
        desviacion_pp:  desviacionPp,
        tendencia:      tendencia,
        estado:         estado,
        hoy_en_curso: {
          real_m2: Math.round(realHoy),
          pct:     Math.round(pctHoy * 10) / 10
        },
        serie_14_dias: serie14
      });

      sumaMetaAyer += metaDia;
      sumaRealAyer += realAyer;
    });

    // Resumen consolidado (para el encabezado de la vista): promedio
    // ponderado real, no promedio simple de porcentajes.
    const pctConsolidadoAyer = sumaMetaAyer > 0 ? (sumaRealAyer / sumaMetaAyer) * 100 : 0;
    const estadoConsolidado  = pctConsolidadoAyer >= META_PCT_EFICIENCIA ? 'verde'
                              : pctConsolidadoAyer >= 75 ? 'amarillo' : 'rojo';

    return {
      meta_pct: META_PCT_EFICIENCIA,
      fecha_ayer: String(ayer.getDate()).padStart(2,'0') + '/' + String(ayer.getMonth()+1).padStart(2,'0') + '/' + ayer.getFullYear(),
      consolidado: {
        real_ayer_pct: Math.round(pctConsolidadoAyer * 10) / 10,
        meta_m2_dia:   Math.round(sumaMetaAyer),
        real_ayer_m2:  Math.round(sumaRealAyer),
        estado:        estadoConsolidado
      },
      prensas: prensas
    };
  } catch(e) {
    return { error: "Error getEficienciaEjecutiva: " + e.toString() };
  }
}
