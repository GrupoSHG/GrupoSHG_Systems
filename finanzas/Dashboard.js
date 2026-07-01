// ============================================================
// CASH POSITION REPORT — Dashboard Web App v6.1
// Cambios v6: agrega sección Cumplimiento SSC (Camila/Ana/Karen)
// % cumplimiento ayer / semana / mes / acumulado
// Criterio: tarea cumplida = todas las respuestas ✅ Completo
// ============================================================

var SHEET_ID = '17u9LzXhRkLMVQ-EK1M1KP-uQH6clVTVON_VqK1nmT58';
var CHECKLIST_ID = '1xc3m0L24Bbp0-7Fk-yCToWH1DjsDf0h3RkW5gQ059Io';

function doGet(e) {
  var datos = getDatos();
  var cumplimiento = getCumplimiento();
  var output = HtmlService.createHtmlOutput(getDashboardHtml(datos, cumplimiento));
  output.setTitle('Cash Position Report — SSC');
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  var n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ============================================================
// getCumplimiento — lee pestañas Camila, Ana, Karen y calcula %
// ============================================================
function getCumplimiento() {
  try {
    var ss = SpreadsheetApp.openById(CHECKLIST_ID);
    var personas = ['Camila', 'Ana', 'Karen'];

    // Usar zona horaria de Chile (America/Santiago, UTC-4)
    var ahoraChile = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Santiago'}));
    var hoy = new Date(ahoraChile.getFullYear(), ahoraChile.getMonth(), ahoraChile.getDate());

    // Inicio de semana (lunes)
    var diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
    var inicioSemana = new Date(hoy); inicioSemana.setDate(hoy.getDate() - diaSemana);

    // Inicio de mes
    var inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

    var resultado = {};

    personas.forEach(function(nombre) {
      var hoja = ss.getSheetByName(nombre);
      if (!hoja) { resultado[nombre] = null; return; }

      var data = hoja.getDataRange().getValues();
      if (data.length < 2) { resultado[nombre] = { ayer: null, semana: null, mes: null, acumulado: null }; return; }

      var headers = data[0];

      // Índice de columna "Marca temporal" = 0, "Fecha de hoy" buscar
      // Columnas de respuestas: desde col 3 en adelante (después de Marca temporal, Correo, Fecha, Momento)
      var colInicio = 4; // primera columna de respuestas reales

      var stats = {
        ayer:      { completas: 0, total: 0, dias: 0 },
        semana:    { completas: 0, total: 0, dias: 0 },
        mes:       { completas: 0, total: 0, dias: 0 },
        acumulado: { completas: 0, total: 0, dias: 0 }
      };

      var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);

      for (var i = 1; i < data.length; i++) {
        var fila = data[i];
        var marcaTemporal = fila[0];
        if (!marcaTemporal || !(marcaTemporal instanceof Date)) continue;

        var marcaChile = new Date(marcaTemporal.toLocaleString('en-US', {timeZone: 'America/Santiago'}));
        var fechaFila = new Date(marcaChile.getFullYear(), marcaChile.getMonth(), marcaChile.getDate());

        // Contar respuestas completas vs total en esta fila
        var totalRespuestas = 0;
        var completas = 0;

        for (var c = colInicio; c < fila.length; c++) {
          var val = String(fila[c] || '').trim();
          if (val === '' || val === 'No aplica hoy' || val === 'No aplica — hoy no es lunes' ||
              val === 'No aplica — hoy no es jueves' || val === 'No aplica — hoy no es viernes' ||
              val === 'No aplica — no estamos en D+1' || val === 'No aplica — no estamos en D-5' ||
              val === 'No aplica — no estamos en D-4' || val === 'No aplica — no estamos en D+3' ||
              val === 'No aplica — no estamos en D+6' || val === 'No aplica esta semana' ||
              val === 'N/A') continue; // ignorar N/A y no aplica

          totalRespuestas++;

          // Cuenta como completo si contiene ✅ o "Completo" y NO contiene ⚠️ ni ❌
          if ((val.indexOf('Completo') >= 0 || val.indexOf('✅') >= 0) &&
               val.indexOf('⚠️') < 0 && val.indexOf('❌') < 0 &&
               val.indexOf('Parcial') < 0 && val.indexOf('No realizado') < 0) {
            completas++;
          }
        }

        if (totalRespuestas === 0) continue;

        // Clasificar en períodos
        var esAyer = (fechaFila.getTime() === ayer.getTime());
        var esHoy  = (fechaFila.getTime() === hoy.getTime());
        var esSemana = (fechaFila >= inicioSemana && fechaFila <= hoy);
        var esMes    = (fechaFila >= inicioMes && fechaFila <= hoy);

        if (esAyer || esHoy) {
          stats.ayer.completas += completas;
          stats.ayer.total     += totalRespuestas;
          stats.ayer.dias++;
        }
        if (esSemana) {
          stats.semana.completas += completas;
          stats.semana.total     += totalRespuestas;
          stats.semana.dias++;
        }
        if (esMes) {
          stats.mes.completas += completas;
          stats.mes.total     += totalRespuestas;
          stats.mes.dias++;
        }
        stats.acumulado.completas += completas;
        stats.acumulado.total     += totalRespuestas;
        stats.acumulado.dias++;
      }

      function pct(s) {
        if (s.total === 0) return null;
        return Math.round((s.completas / s.total) * 100);
      }

      resultado[nombre] = {
        ayer:      pct(stats.ayer),
        semana:    pct(stats.semana),
        mes:       pct(stats.mes),
        acumulado: pct(stats.acumulado),
        diasAyer:  stats.ayer.dias,
        diasSemana: stats.semana.dias
      };
    });

    return resultado;
  } catch(e) {
    return { error: e.message };
  }
}

function getDatos() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName('Registro Diario');
    if (!hoja) return { error: 'No se encontró la hoja Registro Diario' };
    var data = hoja.getDataRange().getValues();
    if (data.length < 4) return { error: 'Sin datos aún' };
    var lastRow = null;
    for (var i = data.length - 1; i >= 3; i--) {
      if (data[i][0] && data[i][0] !== '') { lastRow = data[i]; break; }
    }
    if (!lastRow) return { error: 'Sin datos ingresados aún' };
    var fecha = lastRow[0];
    var fechaStr = '';
    if (fecha instanceof Date) {
      var dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
      var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      fechaStr = dias[fecha.getDay()] + ' ' + fecha.getDate() + ' ' + meses[fecha.getMonth()] + ' ' + fecha.getFullYear();
    } else { fechaStr = String(fecha); }
    var hojaParam = ss.getSheetByName('Parametros');
    var gfPol = 40000000, gfM5 = 25000000, gfCys = 7500000;
    if (hojaParam) {
      var paramData = hojaParam.getRange('C44:E44').getValues();
      gfPol = parseNum(paramData[0][0]) || 40000000;
      gfM5  = parseNum(paramData[0][1]) || 25000000;
      gfCys = parseNum(paramData[0][2]) || 7500000;
    }
    return {
      ok: true,
      fecha: fechaStr,
      ingresadoPor: lastRow[1] || 'Camila',
      gf: { pol: gfPol, m5: gfM5, cys: gfCys, cons: gfPol + gfM5 + gfCys },
      pol: {
        santander:    parseNum(lastRow[2]),
        itau:         parseNum(lastRow[3]),
        security:     parseNum(lastRow[4]),
        bci:          parseNum(lastRow[5]),
        bcoChile:     parseNum(lastRow[6]),
        usdSantander: parseNum(lastRow[7]),
        usdItau:      parseNum(lastRow[8]),
        usdSecurity:  parseNum(lastRow[9]),
        usdBci:       parseNum(lastRow[10]),
        usdTotal:     parseNum(lastRow[11])
      },
      m5: {
        bci1:     parseNum(lastRow[12]),
        bci2:     parseNum(lastRow[13]),
        bcoChile: parseNum(lastRow[14]),
        itau:     parseNum(lastRow[15]),
        usd:      parseNum(lastRow[16])
      },
      cys: { bcoChile: parseNum(lastRow[17]) },
      comp: {
        pol: parseNum(lastRow[18]),
        m5:  parseNum(lastRow[19]),
        cys: parseNum(lastRow[20])
      },
      obs: lastRow[21] || 'Sin observaciones'
    };
  } catch(e) { return { error: 'Error: ' + e.message }; }
}

function fmt(n) {
  if (isNaN(n) || n === null) return '$0';
  var abs = Math.abs(Math.round(n));
  var s = '$' + abs.toLocaleString('es-CL');
  return n < 0 ? '-' + s : s;
}
function fmtM(n) { return '$' + (Math.round(n / 100000) / 10).toFixed(1) + 'M'; }
function fmtU(n) { return 'USD ' + parseFloat(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function getSem(libre, gf) {
  var s = libre / gf;
  if (s >= 3) return 'VERDE';
  if (s >= 2) return 'AMARILLO';
  return 'ROJO';
}
function semColor(s) {
  if (s === 'VERDE') return '#059669';
  if (s === 'AMARILLO') return '#d97706';
  return '#dc2626';
}
function semBg(s) {
  if (s === 'VERDE') return '#ecfdf5';
  if (s === 'AMARILLO') return '#fffbeb';
  return '#fef2f2';
}
function semBorder(s) {
  if (s === 'VERDE') return '#6ee7b7';
  if (s === 'AMARILLO') return '#fcd34d';
  return '#fca5a5';
}

// ============================================================
// Color según % cumplimiento
// ============================================================
function pctColor(p) {
  if (p === null) return '#94a3b8';
  if (p >= 90) return '#059669';
  if (p >= 70) return '#d97706';
  return '#dc2626';
}
function pctBg(p) {
  if (p === null) return '#f8fafc';
  if (p >= 90) return '#ecfdf5';
  if (p >= 70) return '#fffbeb';
  return '#fef2f2';
}
function pctBorder(p) {
  if (p === null) return '#e2e8f0';
  if (p >= 90) return '#6ee7b7';
  if (p >= 70) return '#fcd34d';
  return '#fca5a5';
}
function pctStr(p) {
  if (p === null) return 'Sin datos';
  return p + '%';
}

function getDashboardHtml(d, c) {
  if (d.error) {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#f8fafc;color:#dc2626;font-family:sans-serif;padding:40px;text-align:center"><h2>' + d.error + '</h2></body></html>';
  }

  var GF = d.gf || { pol: 75000000, m5: 25000000, cys: 7500000, cons: 107500000 };
  var totPol  = d.pol.santander + d.pol.itau + d.pol.security + d.pol.bci + d.pol.bcoChile;
  var totM5   = d.m5.bci1 + d.m5.bci2 + d.m5.bcoChile + d.m5.itau;
  var totCys  = d.cys.bcoChile;
  var totCons = totPol + totM5 + totCys;
  var usdPol  = d.pol.usdTotal || (d.pol.usdSantander + d.pol.usdItau + d.pol.usdSecurity + d.pol.usdBci);
  var totUsd  = usdPol + d.m5.usd;
  var compCons = d.comp.pol + d.comp.m5 + d.comp.cys;
  var libPol  = totPol  - d.comp.pol;
  var libM5   = totM5   - d.comp.m5;
  var libCys  = totCys  - d.comp.cys;
  var libCons = totCons - compCons;
  var sem = { pol: getSem(libPol,GF.pol), m5: getSem(libM5,GF.m5), cys: getSem(libCys,GF.cys), cons: getSem(libCons,GF.cons) };
  var run = { pol: (libPol/GF.pol).toFixed(1), m5: (libM5/GF.m5).toFixed(1), cys: (libCys/GF.cys).toFixed(1), cons: (libCons/GF.cons).toFixed(1) };

  var now = new Date();
  var diasN = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  var mesesN = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  var fechaChip = diasN[now.getDay()] + ' ' + now.getDate() + ' ' + mesesN[now.getMonth()] + ' ' + now.getFullYear();
  var hora = now.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});

  var css = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f1f5f9;color:#1e293b;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;padding:24px;min-height:100vh}
.wrap{max-width:1280px;margin:0 auto}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:16px;flex-wrap:wrap;gap:10px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.logo{display:flex;align-items:center;gap:12px}
.logo-box{width:36px;height:36px;border-radius:8px;background:#0f172a;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#38bdf8;flex-shrink:0}
.logo-text .t1{font-size:15px;font-weight:700;color:#0f172a;letter-spacing:-.3px}
.logo-text .t2{font-size:10px;color:#94a3b8;margin-top:1px}
.hdr-right{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:500}
.chip-live{background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a}
.chip-date{background:#f8fafc;border:1px solid #e2e8f0;color:#64748b}
.btn-ref{padding:4px 12px;border-radius:6px;font-size:10px;font-weight:500;color:#0284c7;background:#f0f9ff;border:1px solid #bae6fd;cursor:pointer;text-decoration:none}
.dot{width:6px;height:6px;border-radius:50%;background:#16a34a}
.meta{font-size:10px;color:#94a3b8;margin-bottom:14px;padding:0 2px}
.meta strong{color:#475569;font-weight:500}
.kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px}
@media(max-width:900px){.kpi-row{grid-template-columns:repeat(3,1fr)}}
.kcard{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.kcard-lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;margin-bottom:8px}
.kcard-val{font-size:18px;font-weight:700;letter-spacing:-.5px;line-height:1;font-variant-numeric:tabular-nums}
.kcard-sub{font-size:9px;color:#94a3b8;margin-top:5px;font-variant-numeric:tabular-nums}
.slbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;margin-bottom:10px;margin-top:20px;display:flex;align-items:center;gap:8px}
.slbl::after{content:'';flex:1;height:1px;background:#e2e8f0}
.egrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;align-items:stretch}
@media(max-width:750px){.egrid{grid-template-columns:1fr}}
.ecard{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ehead{padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.ename{font-size:12px;font-weight:700;color:#0f172a}
.ebadge{font-size:9px;font-weight:600;padding:2px 8px;border-radius:5px;font-variant-numeric:tabular-nums}
.ebody{padding:10px 14px 0}
.pesos-section{display:flex;flex-direction:column}
.arow{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #f8fafc;font-size:10px}
.arow:last-of-type{border-bottom:none}
.aname{color:#94a3b8}.aval{color:#475569;font-weight:500;font-variant-numeric:tabular-nums}
.arow-empty{height:22px;border-bottom:1px solid #f8fafc}
.atotal{display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-top:1px solid #e0f2fe}
.atlbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8}
.atval{font-size:14px;font-weight:700;color:#0284c7;font-variant-numeric:tabular-nums}
.usd-section{padding:8px 14px 10px;border-top:1px solid #f0fdf4;background:#fafffe;margin-top:0}
.usd-title{font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:4px}
.urow{display:flex;justify-content:space-between;padding:2px 0;font-size:9px}
.uname{color:#94a3b8}.uval{color:#059669;font-weight:500;font-variant-numeric:tabular-nums}
.utotal{display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #d1fae5;font-size:9px;font-weight:600}
.utlbl{color:#6b7280}.utval{color:#059669;font-variant-numeric:tabular-nums}
.urow-empty{height:20px;border-bottom:none}
.sem-table{width:100%;border-collapse:collapse;margin-bottom:16px;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.sem-table th{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;padding:10px 16px;text-align:center;border-bottom:1px solid #f1f5f9;background:#f8fafc}
.sem-table th:first-child{text-align:left;width:180px}
.sem-table td{padding:11px 16px;text-align:center;border-bottom:1px solid #f8fafc;font-size:11px;font-variant-numeric:tabular-nums;font-weight:500;color:#475569;vertical-align:middle}
.sem-table td:first-child{text-align:left;font-size:10px;color:#94a3b8;font-weight:500}
.sem-table tr:last-child td{border-bottom:none}
.sem-table tr.hl td{background:#fafafa}
.sem-chip{display:inline-block;font-size:11px;font-weight:700;padding:4px 14px;border-radius:6px;letter-spacing:.3px;border:1px solid}
.run-val{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.bgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
@media(max-width:650px){.bgrid{grid-template-columns:1fr}}
.bcard{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.btitle{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;margin-bottom:12px}
.lrow{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f8fafc;font-size:10px}
.lrow:last-of-type{border-bottom:none}
.lname{color:#64748b}.lval{color:#059669;font-weight:600;font-variant-numeric:tabular-nums}
.ltotal{display:flex;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid #dcfce7;font-size:11px;font-weight:700}
.ltlbl{color:#64748b}.ltval{color:#059669;font-variant-numeric:tabular-nums}
.alrt{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:7px;background:#fafafa;border-left:3px solid;margin-bottom:6px;font-size:10px;color:#64748b;line-height:1.5}
.alrt:last-child{margin-bottom:0}
.alrt strong{color:#374151;font-weight:600}
.obs{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.obstitle{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;margin-bottom:6px}
.obstext{font-size:11px;color:#64748b;line-height:1.6}
.footer{display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#cbd5e1;font-variant-numeric:tabular-nums;flex-wrap:wrap;gap:4px}

/* ── CUMPLIMIENTO SSC ── */
.cum-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
@media(max-width:750px){.cum-grid{grid-template-columns:1fr}}
.cum-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.cum-head{padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between}
.cum-name{font-size:12px;font-weight:700;color:#0f172a}
.cum-role{font-size:9px;color:#94a3b8;margin-top:1px}
.cum-body{padding:12px 14px}
.cum-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f8fafc}
.cum-row:last-child{border-bottom:none}
.cum-lbl{font-size:10px;color:#64748b}
.cum-pct{font-size:13px;font-weight:700;padding:2px 10px;border-radius:5px;border:1px solid;font-variant-numeric:tabular-nums}
.cum-bar-wrap{margin-top:10px;height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden}
.cum-bar{height:4px;border-radius:2px;transition:width .3s}
.cum-nodata{font-size:10px;color:#94a3b8;text-align:center;padding:16px 0}
`;

  var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cash Position Report — SSC</title>';
  html += '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">';
  html += '<style>' + css + '</style></head><body><div class="wrap">';

  // HEADER
  html += '<div class="hdr"><div class="logo"><div class="logo-box">P</div><div class="logo-text"><div class="t1">Polchile · M5 · CyS</div><div class="t2">SSC — Cash Position Report · Módulo 1</div></div></div>';
  html += '<div class="hdr-right"><span class="chip chip-live"><span class="dot"></span>En vivo</span><span class="chip chip-date">' + fechaChip + '</span><a class="btn-ref" href="https://script.google.com/a/macros/polchile.cl/s/AKfycby0pnIUuRy8bjn108mc9ly4eET4Aa8_B0qD4qZrkqJZAGOtKmvYIOmq-M_mv3Fjuc0Y/exec?t=' + new Date().getTime() + '">↻ Actualizar</a></div></div>';

  // META
  html += '<div class="meta">Datos del: <strong>' + d.fecha + '</strong> · Ingresado por: <strong>' + d.ingresadoPor + '</strong> · Actualizado: <strong>' + hora + '</strong></div>';

  // KPIs
  html += '<div class="kpi-row">';
  html += '<div class="kcard"><div class="kcard-lbl">Caja total pesos</div><div class="kcard-val" style="color:#0284c7">' + fmtM(totCons) + '</div><div class="kcard-sub">3 empresas · ' + fmt(totCons) + '</div></div>';
  html += '<div class="kcard"><div class="kcard-lbl">USD Comex</div><div class="kcard-val" style="color:#059669">' + fmtU(totUsd) + '</div><div class="kcard-sub">Polchile + M5 · separado</div></div>';
  html += '<div class="kcard"><div class="kcard-lbl">Líneas crédito</div><div class="kcard-val" style="color:#059669">$98,5M</div><div class="kcard-sub">Disponibles · no usar</div></div>';
  html += '<div class="kcard"><div class="kcard-lbl">Compromisos 14 días</div><div class="kcard-val" style="color:#d97706">' + fmtM(compCons) + '</div><div class="kcard-sub">POL ' + fmtM(d.comp.pol) + ' · M5 ' + fmtM(d.comp.m5) + ' · CyS ' + fmtM(d.comp.cys) + '</div></div>';
  html += '<div class="kcard"><div class="kcard-lbl">Caja libre consolidada</div><div class="kcard-val" style="color:#0284c7">' + fmtM(libCons) + '</div><div class="kcard-sub">Sin líneas de crédito · después de compromisos</div></div>';
  html += '</div>';

  // EMPRESAS
  html += '<div class="slbl">Posición por empresa — saldos bancarios reales</div><div class="egrid">';
  var MAX_CUENTAS = 5;
  function empCard(nombre, semK, cuentasPesos, totPesos, usdRows, usdTotal, usdLabel) {
    var out = '<div class="ecard">';
    out += '<div class="ehead"><div class="ename">' + nombre + '</div><span class="ebadge" style="background:' + semBg(sem[semK]) + ';color:' + semColor(sem[semK]) + '">' + sem[semK] + ' · ' + run[semK] + ' sem</span></div>';
    out += '<div class="ebody"><div class="pesos-section">';
    for (var i = 0; i < cuentasPesos.length; i++) {
      out += '<div class="arow"><span class="aname">' + cuentasPesos[i][0] + '</span><span class="aval">' + cuentasPesos[i][1] + '</span></div>';
    }
    for (var j = cuentasPesos.length; j < MAX_CUENTAS; j++) { out += '<div class="arow-empty"></div>'; }
    out += '<div class="atotal"><span class="atlbl">Total pesos</span><span class="atval">' + totPesos + '</span></div>';
    out += '</div></div>';
    out += '<div class="usd-section"><div class="usd-title">Cuentas USD (Comex)</div>';
    var MAX_USD = 4;
    for (var j = 0; j < usdRows.length; j++) {
      out += '<div class="urow"><span class="uname">' + usdRows[j][0] + '</span><span class="uval">' + usdRows[j][1] + '</span></div>';
    }
    for (var k = usdRows.length; k < MAX_USD; k++) { out += '<div class="urow-empty"></div>'; }
    out += '<div class="utotal"><span class="utlbl">' + usdLabel + '</span><span class="utval">' + usdTotal + '</span></div>';
    out += '</div></div>';
    return out;
  }
  html += empCard('Polchile','pol',
    [['Santander 427332-0',fmt(d.pol.santander)],['Itaú 0227803586',fmt(d.pol.itau)],['Security 929733405',fmt(d.pol.security)],['BCI 45409633',fmt(d.pol.bci)],['Bco. Chile 00-881-06973-06',fmt(d.pol.bcoChile)]],
    fmt(totPol),
    [['Santander 0-051-0048805-3',fmtU(d.pol.usdSantander)],['Itaú 1201323427',fmtU(d.pol.usdItau)],['Security 929733817',fmtU(d.pol.usdSecurity)],['BCI 11188588',fmtU(d.pol.usdBci)]],
    fmtU(usdPol),'Total USD Polchile');
  html += empCard('M5 Industrial','m5',
    [['BCI 1 · 89730453',fmt(d.m5.bci1)],['BCI 2 · 32881231',fmt(d.m5.bci2)],['Bco. Chile 00-881-06574-09',fmt(d.m5.bcoChile)],['Itaú 0228001464','<span style="color:#0284c7;font-weight:600">'+fmt(d.m5.itau)+'</span>']],
    fmt(totM5),
    [['Itaú 1201409925',fmtU(d.m5.usd)]],
    fmtU(d.m5.usd),'Total USD M5');
  html += empCard('CyS','cys',
    [['Bco. Chile 1575036410',fmt(d.cys.bcoChile)]],
    fmt(totCys),
    [['Sin cuentas USD','<span style="color:#cbd5e1">USD 0</span>']],
    'USD 0','Total USD CyS');
  html += '</div>';

  // SEMÁFORO
  html += '<div class="slbl">Semáforo de caja — runway por empresa</div>';
  html += '<table class="sem-table"><thead><tr><th>Métrica</th><th>Polchile</th><th>M5 Industrial</th><th>CyS</th><th>Consolidado</th></tr></thead><tbody>';
  html += '<tr><td>Caja libre disponible</td><td>'+fmt(libPol)+'</td><td>'+fmt(libM5)+'</td><td>'+fmt(libCys)+'</td><td style="color:#0f172a;font-weight:600">'+fmt(libCons)+'</td></tr>';
  html += '<tr><td>Gastos fijos / semana</td><td>'+fmt(GF.pol)+'</td><td>'+fmt(GF.m5)+'</td><td>'+fmt(GF.cys)+'</td><td>'+fmt(GF.cons)+'</td></tr>';
  html += '<tr><td>Semanas de runway</td>';
  ['pol','m5','cys','cons'].forEach(function(k){ html += '<td><span class="run-val" style="color:'+semColor(sem[k])+'">'+parseFloat(run[k]).toFixed(1)+' sem</span></td>'; });
  html += '</tr><tr class="hl"><td style="font-weight:600;color:#64748b">Semáforo</td>';
  ['pol','m5','cys','cons'].forEach(function(k){ var s=sem[k]; html += '<td><span class="sem-chip" style="background:'+semBg(s)+';color:'+semColor(s)+';border-color:'+semBorder(s)+'">'+s+'</span></td>'; });
  html += '</tr><tr><td>Compromisos 14 días</td>';
  html += '<td style="color:#d97706">'+fmt(d.comp.pol)+'</td><td style="color:#d97706">'+fmt(d.comp.m5)+'</td><td style="color:#d97706">'+fmt(d.comp.cys)+'</td><td style="color:#d97706;font-weight:600">'+fmt(compCons)+'</td></tr>';
  html += '</tbody></table>';

  // BOTTOM
  html += '<div class="bgrid">';
  html += '<div class="bcard"><div class="btitle">Líneas de crédito disponibles</div>';
  html += '<div class="lrow"><span class="lname">Polchile — Santander + Itaú + BCI</span><span class="lval">$75.000.000</span></div>';
  html += '<div class="lrow"><span class="lname">M5 — BCI + Bco. Chile + Itaú</span><span class="lval">$13.500.000</span></div>';
  html += '<div class="lrow"><span class="lname">CyS — Banco Chile</span><span class="lval">$10.000.000</span></div>';
  html += '<div class="ltotal"><span class="ltlbl">Total líneas disponibles</span><span class="ltval">$98.500.000</span></div></div>';
  html += '<div class="bcard"><div class="btitle">Alertas activas</div>';
  if (sem.cys === 'ROJO') html += '<div class="alrt" style="border-color:#dc2626"><span style="color:#dc2626;font-size:12px">▲</span><div><strong>CyS — caja crítica.</strong> '+run.cys+' semanas de runway.</div></div>';
  if (sem.pol === 'ROJO' || sem.pol === 'AMARILLO') html += '<div class="alrt" style="border-color:#d97706"><span style="color:#d97706;font-size:12px">▲</span><div><strong>Polchile — runway ajustado.</strong> '+run.pol+' semanas.</div></div>';
  if (sem.pol === 'VERDE' && sem.cys === 'VERDE' && sem.m5 === 'VERDE') html += '<div class="alrt" style="border-color:#059669"><span style="color:#059669;font-size:12px">✓</span><div><strong>Sin alertas críticas.</strong> Las 3 empresas en semáforo verde.</div></div>';
  html += '<div class="alrt" style="border-color:#cbd5e1"><span style="color:#94a3b8;font-size:12px">i</span><div><strong>M5 Itaú $167M.</strong> Caja acumulada de utilidades de períodos anteriores.</div></div>';
  html += '</div></div>';

  html += '<div class="obs"><div class="obstitle">Observaciones del día</div><div class="obstext">' + d.obs + '</div></div>';

  // ══ SECCIÓN CUMPLIMIENTO SSC ══
  html += '<div class="slbl">Cumplimiento SSC — checklists diarios</div>';
  html += '<div class="cum-grid">';

  var personas = [
    { nombre: 'Camila', rol: 'Controller SSC' },
    { nombre: 'Ana',    rol: 'Coordinación Operativa' },
    { nombre: 'Karen',  rol: 'People Ops & Payroll' }
  ];

  personas.forEach(function(p) {
    var datos = c && c[p.nombre];
    html += '<div class="cum-card">';
    html += '<div class="cum-head"><div><div class="cum-name">' + p.nombre + '</div><div class="cum-role">' + p.rol + '</div></div></div>';
    html += '<div class="cum-body">';

    if (!datos) {
      html += '<div class="cum-nodata">Sin datos aún — esperando primer checklist</div>';
    } else {
      var periodos = [
        { lbl: 'Ayer',      val: datos.ayer },
        { lbl: 'Esta semana', val: datos.semana },
        { lbl: 'Este mes',  val: datos.mes },
        { lbl: 'Acumulado', val: datos.acumulado }
      ];
      periodos.forEach(function(per) {
        var p2 = per.val;
        html += '<div class="cum-row">';
        html += '<span class="cum-lbl">' + per.lbl + '</span>';
        html += '<span class="cum-pct" style="color:' + pctColor(p2) + ';background:' + pctBg(p2) + ';border-color:' + pctBorder(p2) + '">' + pctStr(p2) + '</span>';
        html += '</div>';
      });
      // Barra visual del acumulado
      var barPct = datos.acumulado !== null ? datos.acumulado : 0;
      html += '<div class="cum-bar-wrap"><div class="cum-bar" style="width:' + barPct + '%;background:' + pctColor(datos.acumulado) + '"></div></div>';
    }

    html += '</div></div>';
  });

  html += '</div>';

  // FOOTER
  html += '<div class="footer"><span>SSC Cash Position Report · Polchile | M5 | CyS · v6.1</span><span>Módulo 1 · Semana 1 de 8 · Actualizado: ' + hora + '</span></div>';
  var refreshUrl = 'https://script.google.com/a/macros/polchile.cl/s/AKfycby0pnIUuRy8bjn108mc9ly4eET4Aa8_B0qD4qZrkqJZAGOtKmvYIOmq-M_mv3Fjuc0Y/exec';
  html += '<script>setTimeout(function(){window.location.href="' + refreshUrl + '?t="+new Date().getTime();},300000);<\/script>';
  html += '</div></body></html>';
  return html;
}

// ============================================================
// DEBUG — ejecutar manualmente para diagnosticar cumplimiento
// ============================================================
function debugCumplimiento() {
  var ss = SpreadsheetApp.openById(CHECKLIST_ID);
  var hoja = ss.getSheetByName('Camila');
  if (!hoja) { Logger.log('ERROR: No se encontró pestaña Camila'); return; }

  var data = hoja.getDataRange().getValues();

  var ahoraChile = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Santiago'}));
  var hoy = new Date(ahoraChile.getFullYear(), ahoraChile.getMonth(), ahoraChile.getDate());
  var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);

  Logger.log('HOY Chile: ' + hoy);
  Logger.log('AYER Chile: ' + ayer);
  Logger.log('Total filas en Camila (incluyendo header): ' + data.length);

  for (var i = 1; i < data.length; i++) {
    var fila = data[i];
    var marca = fila[0];
    if (!marca || marca === '') { Logger.log('Fila ' + i + ' — vacía, ignorada'); continue; }
    Logger.log('Fila ' + i + ' — Marca temporal: ' + marca + ' — isDate: ' + (marca instanceof Date));
    if (marca instanceof Date) {
      var marcaChile = new Date(marca.toLocaleString('en-US', {timeZone: 'America/Santiago'}));
      var fechaFila = new Date(marcaChile.getFullYear(), marcaChile.getMonth(), marcaChile.getDate());
      Logger.log('  → Fecha Chile: ' + fechaFila);
      Logger.log('  → Es hoy: ' + (fechaFila.getTime() === hoy.getTime()));
      Logger.log('  → Es ayer: ' + (fechaFila.getTime() === ayer.getTime()));
      Logger.log('  → Momento: ' + fila[3]);
      // Contar respuestas
      var total = 0; var completas = 0;
      for (var c = 4; c < fila.length; c++) {
        var val = String(fila[c] || '').trim();
        if (val === '' || val.indexOf('No aplica') >= 0 || val === 'N/A') continue;
        total++;
        if ((val.indexOf('Completo') >= 0 || val.indexOf('✅') >= 0) && val.indexOf('⚠️') < 0 && val.indexOf('❌') < 0 && val.indexOf('Parcial') < 0 && val.indexOf('No realizado') < 0) completas++;
      }
      Logger.log('  → Respuestas: ' + completas + '/' + total);
    }
  }
}