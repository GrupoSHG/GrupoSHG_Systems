// ═══════════════════════════════════════════════════════════════════════════
// NIVEL EJECUTIVO — KPIs consolidados con semáforo (Meta / Real / Desviación /
// Tendencia / Estado), separados del detalle operativo por prensa/OP.
//
// 3 dimensiones (según el documento de KPIs):
//   - Rendimiento: real vs. meta de producción — ÚNICA con datos reales hoy.
//   - Disponibilidad y Calidad: sin registro de paradas/scrap todavía —
//     se devuelven marcadas como "no disponibles", el frontend las muestra
//     como pestañas con mensaje "Sin datos — próximamente".
//
// 3 períodos por dimensión: diario (ayer), semanal (semana calendario a la
// fecha) y mensual (mes calendario a la fecha) — cada uno con su resumen
// consolidado y su desglose por prensa (P1-P7).
// ═══════════════════════════════════════════════════════════════════════════

const JORNADA_H_EJECUTIVO   = 9;
const META_PCT_EFICIENCIA   = 90;

function esDiaHabilEjecutivo_(d) {
  const dow = d.getDay(); // 0=Domingo, 6=Sábado
  return dow >= 1 && dow <= 5;
}

function keyDeFechaEjecutivo_(d) {
  return d.getFullYear() + '-' + String(d.getMonth()).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Suma el real de una prensa entre [inicio, fin] (inclusive), contando
// además cuántos días hábiles hay en ese rango (para escalar la meta).
function sumarPeriodo_(inicio, fin, prensaKey, porDiaYPrensa) {
  let real = 0, diasHabiles = 0;
  const cur = new Date(inicio);
  while (cur <= fin) {
    if (esDiaHabilEjecutivo_(cur)) {
      diasHabiles++;
      const dia = porDiaYPrensa[keyDeFechaEjecutivo_(cur)];
      if (dia && dia[prensaKey]) real += dia[prensaKey];
    }
    cur.setDate(cur.getDate() + 1);
  }
  return { real: real, diasHabiles: diasHabiles };
}

function calcularBloquePeriodo_(inicio, fin, inicioAnterior, finAnterior, porDiaYPrensa, metaDiariaPorPrensa, prensasKeys, etiquetaPeriodo) {
  const prensas = [];
  let sumaMeta = 0, sumaReal = 0;

  prensasKeys.forEach(function (prensaKey) {
    const metaDia = metaDiariaPorPrensa[prensaKey];

    const actual   = sumarPeriodo_(inicio, fin, prensaKey, porDiaYPrensa);
    const anterior = sumarPeriodo_(inicioAnterior, finAnterior, prensaKey, porDiaYPrensa);

    const metaPeriodo = metaDia * actual.diasHabiles;
    const pct          = metaPeriodo > 0 ? (actual.real / metaPeriodo) * 100 : 0;

    const metaPeriodoAnt = metaDia * anterior.diasHabiles;
    const pctAnterior     = metaPeriodoAnt > 0 ? (anterior.real / metaPeriodoAnt) * 100 : 0;

    const desviacionPp  = Math.round((pct - META_PCT_EFICIENCIA) * 10) / 10;
    const diffTendencia = pct - pctAnterior;
    const tendencia     = diffTendencia > 2 ? 'subida' : diffTendencia < -2 ? 'bajada' : 'estable';
    const estado        = pct >= META_PCT_EFICIENCIA ? 'verde' : pct >= 75 ? 'amarillo' : 'rojo';

    prensas.push({
      prensa:        prensaKey,
      meta_m2:       Math.round(metaPeriodo),
      real_m2:       Math.round(actual.real),
      pct:           Math.round(pct * 10) / 10,
      desviacion_pp: desviacionPp,
      tendencia:     tendencia,
      estado:        estado,
    });

    sumaMeta += metaPeriodo;
    sumaReal += actual.real;
  });

  const pctConsolidado = sumaMeta > 0 ? (sumaReal / sumaMeta) * 100 : 0;
  const estadoConsolidado = pctConsolidado >= META_PCT_EFICIENCIA ? 'verde' : pctConsolidado >= 75 ? 'amarillo' : 'rojo';

  return {
    periodo_label: etiquetaPeriodo,
    consolidado: {
      pct:      Math.round(pctConsolidado * 10) / 10,
      meta_m2:  Math.round(sumaMeta),
      real_m2:  Math.round(sumaReal),
      estado:   estadoConsolidado,
    },
    prensas: prensas,
  };
}

function getEficienciaEjecutiva() {
  try {
    const ss   = SpreadsheetApp.openById(ID_WIP);
    const hoja = ss.getSheetByName("M2 Producidos");
    if (!hoja) return { error: "No se encontró 'M2 Producidos'" };

    const data = hoja.getDataRange().getValues();

    const metaDiariaPorPrensa = {};
    for (const k in META_POR_HORA) metaDiariaPorPrensa[k] = META_POR_HORA[k] * JORNADA_H_EJECUTIVO;

    // Acumular m² PA por (día, prensa). Excluye PC4/Bandejera (PSA).
    const porDiaYPrensa = {};
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
      if (!META_POR_HORA.hasOwnProperty(prensaKey)) continue;

      const f = parseDateCustom(marca);
      if (!f) continue;

      const diaKey = keyDeFechaEjecutivo_(f);
      if (!porDiaYPrensa[diaKey]) porDiaYPrensa[diaKey] = {};
      porDiaYPrensa[diaKey][prensaKey] = (porDiaYPrensa[diaKey][prensaKey] || 0) + m2;
    }

    const prensasKeys = Object.keys(META_POR_HORA).sort();

    const hoy  = new Date(); hoy.setHours(0,0,0,0);
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);

    const NOMBRES_MES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    function fmtFecha(d) { return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); }

    // ── DIARIO: ayer vs. anteayer ──────────────────────────────────
    const anteayer = new Date(hoy); anteayer.setDate(hoy.getDate() - 2);
    const bloqueDiario = calcularBloquePeriodo_(
      ayer, ayer, anteayer, anteayer,
      porDiaYPrensa, metaDiariaPorPrensa, prensasKeys,
      'Ayer, ' + fmtFecha(ayer)
    );

    // ── SEMANAL: lunes de esta semana → ayer, vs. mismo tramo semana pasada ──
    const diaSemanaHoy = hoy.getDay(); // 0=Dom..6=Sab
    const diasDesdeLunes = diaSemanaHoy === 0 ? 6 : diaSemanaHoy - 1;
    const lunesEstaSemana = new Date(hoy); lunesEstaSemana.setDate(hoy.getDate() - diasDesdeLunes);
    const finSemanal = ayer < lunesEstaSemana ? lunesEstaSemana : ayer; // por si hoy es lunes, ayer sería domingo (fuera de la semana actual)
    const inicioSemanaAnt = new Date(lunesEstaSemana); inicioSemanaAnt.setDate(lunesEstaSemana.getDate() - 7);
    const finSemanaAnt    = new Date(finSemanal);       finSemanaAnt.setDate(finSemanal.getDate() - 7);
    const bloqueSemanal = calcularBloquePeriodo_(
      lunesEstaSemana, finSemanal, inicioSemanaAnt, finSemanaAnt,
      porDiaYPrensa, metaDiariaPorPrensa, prensasKeys,
      'Semana del ' + fmtFecha(lunesEstaSemana) + ' al ' + fmtFecha(finSemanal)
    );

    // ── MENSUAL: día 1 del mes → ayer, vs. mismo tramo mes anterior ──
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const finMensual = ayer < inicioMes ? inicioMes : ayer; // por si hoy es día 1
    const inicioMesAnt = new Date(inicioMes.getFullYear(), inicioMes.getMonth() - 1, 1);
    const finMesAnt     = new Date(inicioMesAnt.getFullYear(), inicioMesAnt.getMonth(), finMensual.getDate());
    const bloqueMensual = calcularBloquePeriodo_(
      inicioMes, finMensual, inicioMesAnt, finMesAnt,
      porDiaYPrensa, metaDiariaPorPrensa, prensasKeys,
      NOMBRES_MES[hoy.getMonth()].charAt(0).toUpperCase() + NOMBRES_MES[hoy.getMonth()].slice(1) + ' ' + hoy.getFullYear() + ' (al ' + fmtFecha(finMensual) + ')'
    );

    return {
      meta_pct: META_PCT_EFICIENCIA,
      disponibilidad: { disponible: false, mensaje: 'Sin datos — próximamente (falta registrar paradas de prensa con causa y duración)' },
      calidad:        { disponible: false, mensaje: 'Sin datos — próximamente (falta registrar scrap/rechazo por prensa)' },
      rendimiento: {
        disponible: true,
        diario:   bloqueDiario,
        semanal:  bloqueSemanal,
        mensual:  bloqueMensual,
      },
    };
  } catch(e) {
    return { error: "Error getEficienciaEjecutiva: " + e.toString() };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINADA — Eficiencia + Backlog en una sola llamada.
// Lee "M2 Producidos" UNA sola vez y reutiliza esa lectura para ambos
// cálculos (antes eran 2 funciones separadas, cada una releyendo la hoja
// completa desde cero — con la hoja cada vez más grande, eso empezó a
// causar timeouts en el frontend). Reutiliza calcularBloquePeriodo_(),
// extraerTipoProductoBacklog_(), esDiaHabilEjecutivo_() y
// keyDeFechaEjecutivo_() ya definidas en este mismo proyecto.
// ═══════════════════════════════════════════════════════════════════════════
function getDatosEjecutivo() {
  try {
    const ss   = SpreadsheetApp.openById(ID_WIP);
    const hoja = ss.getSheetByName("M2 Producidos");
    if (!hoja) return { error: "No se encontró 'M2 Producidos'" };

    const data = hoja.getDataRange().getValues();

    // ── Lectura única: m² PA por (día, prensa) ──────────────────────
    const porDiaYPrensa = {};
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
      if (!META_POR_HORA.hasOwnProperty(prensaKey)) continue;
      const f = parseDateCustom(marca);
      if (!f) continue;
      const diaKey = keyDeFechaEjecutivo_(f);
      if (!porDiaYPrensa[diaKey]) porDiaYPrensa[diaKey] = {};
      porDiaYPrensa[diaKey][prensaKey] = (porDiaYPrensa[diaKey][prensaKey] || 0) + m2;
    }

    // ── Parte 1: Eficiencia (mismo cálculo que getEficienciaEjecutiva) ──
    const metaDiariaPorPrensa = {};
    for (const k in META_POR_HORA) metaDiariaPorPrensa[k] = META_POR_HORA[k] * JORNADA_H_EJECUTIVO;
    const prensasKeys = Object.keys(META_POR_HORA).sort();

    const hoy      = new Date(); hoy.setHours(0,0,0,0);
    const ayer     = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const anteayer = new Date(hoy); anteayer.setDate(hoy.getDate() - 2);

    const NOMBRES_MES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    function fmtFecha(d) { return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); }

    const diaSemanaHoy   = hoy.getDay();
    const diasDesdeLunes = diaSemanaHoy === 0 ? 6 : diaSemanaHoy - 1;
    const lunesEstaSemana = new Date(hoy); lunesEstaSemana.setDate(hoy.getDate() - diasDesdeLunes);
    const finSemanal      = ayer < lunesEstaSemana ? lunesEstaSemana : ayer;
    const inicioSemanaAnt = new Date(lunesEstaSemana); inicioSemanaAnt.setDate(lunesEstaSemana.getDate() - 7);
    const finSemanaAnt    = new Date(finSemanal);       finSemanaAnt.setDate(finSemanal.getDate() - 7);

    const inicioMes    = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const finMensual    = ayer < inicioMes ? inicioMes : ayer;
    const inicioMesAnt  = new Date(inicioMes.getFullYear(), inicioMes.getMonth() - 1, 1);
    const finMesAnt      = new Date(inicioMesAnt.getFullYear(), inicioMesAnt.getMonth(), finMensual.getDate());

    const bloqueDiario  = calcularBloquePeriodo_(ayer, ayer, anteayer, anteayer, porDiaYPrensa, metaDiariaPorPrensa, prensasKeys, 'Ayer, ' + fmtFecha(ayer));
    const bloqueSemanal = calcularBloquePeriodo_(lunesEstaSemana, finSemanal, inicioSemanaAnt, finSemanaAnt, porDiaYPrensa, metaDiariaPorPrensa, prensasKeys, 'Semana del ' + fmtFecha(lunesEstaSemana) + ' al ' + fmtFecha(finSemanal));
    const bloqueMensual = calcularBloquePeriodo_(inicioMes, finMensual, inicioMesAnt, finMesAnt, porDiaYPrensa, metaDiariaPorPrensa, prensasKeys, NOMBRES_MES[hoy.getMonth()].charAt(0).toUpperCase() + NOMBRES_MES[hoy.getMonth()].slice(1) + ' ' + hoy.getFullYear() + ' (al ' + fmtFecha(finMensual) + ')');

    const eficiencia = {
      meta_pct: META_PCT_EFICIENCIA,
      disponibilidad: { disponible: false, mensaje: 'Sin datos — próximamente (falta registrar paradas de prensa con causa y duración)' },
      calidad:        { disponible: false, mensaje: 'Sin datos — próximamente (falta registrar scrap/rechazo por prensa)' },
      rendimiento: { disponible: true, diario: bloqueDiario, semanal: bloqueSemanal, mensual: bloqueMensual },
    };

    // ── Parte 2: Backlog por producto (reutiliza porDiaYPrensa para el ritmo) ──
    const filasOP = supabaseSelect_('ordenes_de_produccion');
    const pendientePorTipo = {};
    filasOP.forEach(function (row) {
      const pend = parseFloat(row.cantidad_pendiente) || 0;
      if (pend <= 0) return;
      const codigo = row.codigo_producto ? row.codigo_producto.toString().toUpperCase() : '';
      if (codigo.indexOf('PSA') > -1) return;
      if (codigo.indexOf('PA') === -1) return;
      const tipo = extraerTipoProductoBacklog_(row.nombre_producto);
      pendientePorTipo[tipo] = (pendientePorTipo[tipo] || 0) + pend;
    });

    let sumaUltimos30 = 0, diasConDatos = 0;
    for (let i = 1; i <= 30; i++) {
      const d = new Date(hoy); d.setDate(hoy.getDate() - i);
      if (!esDiaHabilEjecutivo_(d)) continue;
      const dia = porDiaYPrensa[keyDeFechaEjecutivo_(d)];
      if (dia) {
        let totalDia = 0;
        for (const k in dia) totalDia += dia[k];
        if (totalDia > 0) { sumaUltimos30 += totalDia; diasConDatos++; }
      }
    }
    const ritmoDiarioGeneral = diasConDatos > 0 ? sumaUltimos30 / diasConDatos : 0;

    const backlogList = Object.keys(pendientePorTipo).map(function (tipo) {
      const pend = pendientePorTipo[tipo];
      const dias = ritmoDiarioGeneral > 0 ? pend / ritmoDiarioGeneral : null;
      const estado = dias === null ? 'sin_dato'
                   : dias <= BACKLOG_DIAS_VERDE    ? 'verde'
                   : dias <= BACKLOG_DIAS_AMARILLO ? 'amarillo'
                   : 'rojo';
      return { producto: tipo, pendiente_m2: Math.round(pend), dias: dias === null ? null : Math.round(dias*10)/10, estado: estado };
    }).sort(function (a, b) { return (b.dias || 0) - (a.dias || 0); });

    const backlog = {
      ritmo_diario_general_m2: Math.round(ritmoDiarioGeneral),
      dias_con_datos_considerados: diasConDatos,
      backlog: backlogList,
    };

    return { eficiencia: eficiencia, backlog: backlog };
  } catch (e) {
    return { error: "Error getDatosEjecutivo: " + e.toString() };
  }
}
