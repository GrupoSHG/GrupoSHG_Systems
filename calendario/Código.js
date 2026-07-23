/**
 * Dashboard Web App - NV Polchile
 * Lee 'Por Facturar' y cruza con 'Orden de Produccion'
 * Incluye Facturado Neto mes actual desde 'Ventas_Full'
 *
 * v2: agrega router de acciones + soporte JSONP en doGet para poder
 * consumir este backend desde un frontend estático (Netlify) vía el
 * shim de google.script.run.
 */

const SHEET_ID    = '10PvCCTw31gOhvSgcbIy15V3lBNdQZwX7Naa0R-yPO0k';
const NOMBRE_HOJA = 'Por Facturar';
const HOJA_OP     = 'Orden de Produccion';
const HOJA_VENTAS = 'Ventas_Full';

function doGet(e) {
  var action   = e && e.parameter && e.parameter.action;
  var callback = e && e.parameter && e.parameter.callback;

  if (action) {
    var result;
    try {
      switch (action) {
        case 'getDashboardData': result = getDashboardData(); break;
        default: result = { error: 'Acción desconocida: ' + action };
      }
    } catch (err) {
      result = { error: err.message };
    }

    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + JSON.stringify(result) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Modo HTML normal (Apps Script Web App original, sin cambios)
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Dashboard NV — Polchile')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDashboardData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hoja = ss.getSheetByName(NOMBRE_HOJA);
  if (!hoja) throw new Error(`No existe la hoja "${NOMBRE_HOJA}"`);
  
  const ultimaFila = hoja.getLastRow();
  const ultimaCol  = hoja.getLastColumn();
  if (ultimaFila < 2) return { error: 'Sin datos en la hoja' };
  
  const headers = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0]
    .map(h => String(h).toLowerCase().trim().replace(/\s+/g,'_'));
  
  const col = (...nombres) => {
    for (const n of nombres) {
      const i = headers.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  
  const idx = {
    nv:          col('nota_de_venta', 'nota_venta', 'nv', 'numnota'),
    fechaFinal:  col('fecha_entrega_final', 'fecha_final', 'fecha_entrega'),
    fechaOrig:   col('fecha_entrega_original_lineas', 'fecha_entrega_original'),
    fechaModif:  col('fecha_entrega_modificada', 'fecha_modificada'),
    diasModif:   col('dias_modificacion_vs_original', 'dias_modificacion'),
    qtyCambios:  col('cantidad_cambios_fecha_entrega', 'cantidad_cambios'),
    qSol:        col('q_solicitado', 'cantidad_solicitada'),
    qPend:       col('q_por_despachar', 'cantidad_por_despachar'),
    cliente:     col('cliente', 'razsoc'),
    estado:      col('estado'),
    totalNv:     col('total_nv'),
    totalNeto:   col('total_neto_nv', 'total_neto'),
    facturado:   col('pesos_facturados', 'facturado'),
    porFacturar: col('pesos_por_facturar', 'por_facturar'),
    pagado:      col('pagado_nv', 'pagado'),
    pendCobro:   col('total_pendiente_de_cobro', 'totpend', 'pendiente_cobro'),
    entregado:   col('total_entregado_pesos', 'entregado_pesos'),
    porEntregar: col('total_por_entregar_pesos', 'por_entregar_pesos'),
    tieneModif:  col('tiene_modificacion', 'modificacion')
  };
  
  const obligatorias = ['nv','fechaFinal','qSol','qPend','cliente','totalNv',
                        'totalNeto','facturado','porFacturar','pagado',
                        'pendCobro','entregado','porEntregar'];
  const faltan = obligatorias.filter(k => idx[k] === -1);
  if (faltan.length > 0) {
    return { 
      error: 'Columnas obligatorias no encontradas: ' + faltan.join(', ') + 
             '\n\nEncabezados en la hoja: ' + headers.join(' | ')
    };
  }
  
  const resumenOP = cargarResumenOP(ss);
  const facturadoNetoMes = getFacturadoNetoMesActual(ss);
  
  const valores = hoja.getRange(2, 1, ultimaFila - 1, ultimaCol).getValues();
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  
  const datos = valores
    .filter(r => r[idx.nv] !== '' && r[idx.nv] !== null)
    .map(r => {
      const fechaFinal = parsearFecha(r[idx.fechaFinal]);
      const fechaOrig  = idx.fechaOrig >= 0 ? parsearFecha(r[idx.fechaOrig]) : null;
      const diasAtrasoReal = fechaFinal ? Math.floor((hoy - fechaFinal)/(86400000)) : null;
      
      let diffDias = null;
      if (fechaOrig && fechaFinal) {
        diffDias = Math.round((fechaFinal - fechaOrig) / 86400000);
      }
      
      const qSol = num(r[idx.qSol]);
      const qPend = num(r[idx.qPend]);
      const qDesp = qSol - qPend;
      const nvKey = String(r[idx.nv]).trim();
      
      return {
        nv: r[idx.nv],
        fechaOriginal: formatFecha(r[idx.fechaOrig]),
        fechaFinal: formatFecha(r[idx.fechaFinal]),
        diffDias: diffDias,
        qSolicitado: qSol,
        qPorDespachar: qPend,
        qDespachado: qDesp,
        pctAvance: qSol > 0 ? qDesp / qSol : 0,
        cliente: String(r[idx.cliente] || '').trim(),
        estado: String(r[idx.estado] || ''),
        totalNv: num(r[idx.totalNv]),
        totalNeto: num(r[idx.totalNeto]),
        facturado: num(r[idx.facturado]),
        porFacturar: num(r[idx.porFacturar]),
        pagado: num(r[idx.pagado]),
        pendCobro: num(r[idx.pendCobro]),
        entregadoPesos: num(r[idx.entregado]),
        porEntregarPesos: num(r[idx.porEntregar]),
        tieneModif: idx.tieneModif >= 0 
                    ? String(r[idx.tieneModif]||'').toLowerCase().startsWith('s')
                    : (num(r[idx.qtyCambios]) > 0),
        diasAtrasoReal: diasAtrasoReal,
        estaAtrasada: diasAtrasoReal !== null && diasAtrasoReal > 0,
        opPorClase: resumenOP[nvKey] || 'Compra externa / Faltan medidas'
      };
    });
  
  return {
    fecha: Utilities.formatDate(new Date(), 'America/Santiago', 'dd-MM-yyyy HH:mm'),
    datos: datos,
    facturadoNetoMes: facturadoNetoMes
  };
}

function getFacturadoNetoMesActual(ss) {
  try {
    const hoja = ss.getSheetByName(HOJA_VENTAS);
    if (!hoja) {
      Logger.log('⚠️ No existe "' + HOJA_VENTAS + '"');
      return { totalFav: 0, totalNcv: 0, neto: 0, error: 'Hoja no encontrada' };
    }
    
    const hoy = new Date();
    const anioActualNum = hoy.getFullYear();
    const mesActualNum = hoy.getMonth() + 1;
    const txtAnioActual = String(anioActualNum);
    const txtMesActual = String(mesActualNum).padStart(2, '0');
    
    const data = hoja.getDataRange().getValues();
    const encabezados = data[0].map(h => h.toString().trim().toLowerCase());
    
    let colDocto = encabezados.findIndex(h => h === 'docto' || h.includes('docto') || h.includes('tipo'));
    let colFecha = encabezados.findIndex(h => h === 'fecha' || h.includes('fecha') || h.startsWith('fec'));
    let colNeto  = encabezados.findIndex(h => h === 'total_neto' || h.includes('neto'));
    
    if (colDocto === -1) colDocto = 1;
    if (colFecha === -1) colFecha = 2;
    if (colNeto === -1)  colNeto  = 10;
    
    let totalFav = 0, totalNcv = 0;
    
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      if (!fila[0] || fila[0].toString().toLowerCase().includes('total')) continue;
      
      const tipoDocto = fila[colDocto] ? fila[colDocto].toString().trim().toUpperCase() : '';
      const fechaCelda = fila[colFecha];
      const valorNeto = num(fila[colNeto]);
      
      let anioStr = '', mesStr = '';
      if (fechaCelda instanceof Date) {
        anioStr = String(fechaCelda.getFullYear());
        mesStr = String(fechaCelda.getMonth() + 1).padStart(2, '0');
      } else if (fechaCelda) {
        const txt = fechaCelda.toString().trim().split(' ')[0];
        const partesGuion = txt.split('-');
        if (partesGuion.length === 3) {
          anioStr = partesGuion[0].trim();
          mesStr  = partesGuion[1].trim().padStart(2, '0');
        } else {
          const partesBarra = txt.split('/');
          if (partesBarra.length === 3) {
            if (partesBarra[0].length === 4) {
              anioStr = partesBarra[0];
              mesStr  = partesBarra[1].padStart(2, '0');
            } else {
              anioStr = partesBarra[2];
              mesStr  = partesBarra[1].padStart(2, '0');
            }
          }
        }
      }
      
      if (anioStr === txtAnioActual && mesStr === txtMesActual) {
        if (tipoDocto === 'FAV')      totalFav += valorNeto;
        else if (tipoDocto === 'NCV') totalNcv += valorNeto;
      }
    }
    
    const neto = totalFav - totalNcv;
    Logger.log('Facturado neto mes actual: FAV=%s NCV=%s Neto=%s', totalFav, totalNcv, neto);
    
    return { totalFav: totalFav, totalNcv: totalNcv, neto: neto };
  } catch (e) {
    Logger.log('Error en getFacturadoNetoMesActual: ' + e.toString());
    return { totalFav: 0, totalNcv: 0, neto: 0, error: e.toString() };
  }
}

function cargarResumenOP(ss) {
  const hoja = ss.getSheetByName(HOJA_OP);
  if (!hoja || hoja.getLastRow() < 2) {
    Logger.log('⚠️ No existe "' + HOJA_OP + '" o está vacía');
    return {};
  }
  
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]
    .map(h => String(h).toLowerCase().trim().replace(/\s+/g,'_'));
  
  const col = (...nombres) => {
    for (const n of nombres) {
      const i = headers.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  
  const idx = {
    nv:       col('nota_vta', 'nota_de_venta', 'nv', 'prp', 'numnota'),
    cantOp:   col('cantidad_op', 'cantidad', 'cant_op', 'cantidadop'),
    unidad:   col('unidmed', 'unidad', 'unidad_compra', 'unidad_medida', 'um'),
    clase1:   col('clase1', 'clase_1'),
    bodega:   col('bodega_nombre_op', 'bodega_op', 'bodega', 'nombre_bodega_op')
  };
  
  const faltan = ['nv','cantOp','clase1','bodega'].filter(k => idx[k] === -1);
  if (faltan.length > 0) {
    Logger.log('⚠️ Columnas faltantes en ' + HOJA_OP + ': ' + faltan.join(', '));
    return {};
  }
  
  const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
  
  const acum = {};
  valores.forEach(r => {
    const bodegaRaw = String(r[idx.bodega] || '').toUpperCase().trim();
    if (!bodegaRaw.includes('TERMINAD')) return;
    
    const nvRaw = r[idx.nv];
    if (nvRaw === null || nvRaw === undefined || nvRaw === '') return;
    const nv = String(nvRaw).trim();
    
    const clase1 = String(r[idx.clase1] || '').trim();
    const cant = num(r[idx.cantOp]);
    const unidad = idx.unidad >= 0 ? String(r[idx.unidad] || '').trim() : '';
    
    if (!nv || !clase1 || cant <= 0) return;
    
    if (!acum[nv]) acum[nv] = {};
    if (!acum[nv][clase1]) acum[nv][clase1] = { cant: 0, unidad: unidad };
    acum[nv][clase1].cant += cant;
    if (!acum[nv][clase1].unidad && unidad) acum[nv][clase1].unidad = unidad;
  });
  
  const resultado = {};
  Object.entries(acum).forEach(([nv, clases]) => {
    const partes = Object.entries(clases)
      .sort((a, b) => b[1].cant - a[1].cant)
      .map(([clase, info]) => {
        const cantFmt = new Intl.NumberFormat('es-CL', {maximumFractionDigits: 2}).format(info.cant);
        return clase + ': ' + cantFmt + (info.unidad ? ' ' + info.unidad : '');
      });
    resultado[nv] = partes.join(' | ');
  });
  
  return resultado;
}

function num(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim()
    .replace(/\s/g,'')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parsearFecha(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const m = String(val).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function formatFecha(val) {
  const d = parsearFecha(val);
  if (!d) return '';
  return Utilities.formatDate(d, 'America/Santiago', 'dd-MM-yyyy');
}

function testConexion() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  ['Por Facturar', 'Orden de Produccion', 'Ventas_Full'].forEach(nombre => {
    const h = ss.getSheetByName(nombre);
    if (h) Logger.log('✅ Hoja "' + nombre + '" — ' + h.getLastRow() + ' filas');
    else   Logger.log('❌ No encontré hoja "' + nombre + '"');
  });
  
  Logger.log('\n=== Facturado Neto Mes Actual ===');
  const fact = getFacturadoNetoMesActual(ss);
  Logger.log('FAV: $%s', fact.totalFav.toLocaleString('es-CL'));
  Logger.log('NCV: $%s', fact.totalNcv.toLocaleString('es-CL'));
  Logger.log('Neto: $%s', fact.neto.toLocaleString('es-CL'));
}