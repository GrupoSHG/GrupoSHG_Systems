/**
 * ============================================================
 * POLCHILE — Comercial Cockpit · Apps Script Web App
 * ============================================================
 */

const GHL_BASE    = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ============================================================
// CHIPAX — M5 Industrial
// ============================================================
const CHIPAX_BASE      = 'https://api.chipax.com/v2';
const CHIPAX_CACHE_KEY = 'CHIPAX_DASH_V1';
const CHIPAX_CACHE_TTL = 600; // 10 minutos

function chipaxGetToken_() {
  const props  = PropertiesService.getScriptProperties();
  const appId  = props.getProperty('CHIPAX_APP_ID');
  const secret = props.getProperty('CHIPAX_SECRET');
  if (!appId || !secret) throw new Error('Falta CHIPAX_APP_ID o CHIPAX_SECRET.');

  const res = UrlFetchApp.fetch(CHIPAX_BASE + '/login', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ app_id: appId, secret_key: secret }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('Chipax login ' + code + ': ' + JSON.stringify(body));
  return body.token || body.access_token;
}

/**
 * GET paginado a Chipax.
 * Soporta dos formatos de respuesta:
 *  - { items: [...], paginationAttributes: { count, totalPages, currentPage } }
 *  - { docs: [...], pages, total }
 */
function chipaxGet_(token, endpoint, params, opts) {
  opts = opts || {};
  const H = { 'Authorization': 'JWT ' + token };
  let all = [], page = 1;
  const maxPages = opts.maxPages || 200;
  let totalPages = null;

  while (page <= maxPages) {
    const p  = Object.assign({ page: page, limit: 200 }, params || {});
    const qs = Object.keys(p).map(function(k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    const res  = UrlFetchApp.fetch(CHIPAX_BASE + '/' + endpoint + '?' + qs,
                   { method:'get', headers:H, muteHttpExceptions:true });
    const code = res.getResponseCode();
    if (code === 404) break;
    if (code !== 200) { Logger.log('Chipax ' + code + ' en ' + endpoint); break; }

    const body  = JSON.parse(res.getContentText());
    const items = Array.isArray(body)       ? body       :
                  Array.isArray(body.items) ? body.items :
                  Array.isArray(body.docs)  ? body.docs  :
                  Array.isArray(body.data)  ? body.data  : [];

    if (!items.length) break;
    all = all.concat(items);

    // Detectar paginación
    if (totalPages === null) {
      const pa = body.paginationAttributes || body.pagination || null;
      if (pa) totalPages = Number(pa.totalPages || pa.total_pages || 0);
      else if (body.pages) totalPages = Number(body.pages);
    }

    // Si el caller pidió "early stop" cuando todos los items cumplan condición, evaluamos
    if (opts.earlyStop && opts.earlyStop(all, items)) break;

    if (totalPages && page >= totalPages) break;
    if (items.length < 50) break; // safeguard
    page++;
    Utilities.sleep(150);
  }
  Logger.log('  ' + endpoint + ': ' + all.length + ' items en ' + page + ' páginas');
  return all;
}

function chipaxInicioMes_() {
  const h = new Date();
  return Utilities.formatDate(new Date(h.getFullYear(), h.getMonth(), 1),
    Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ── Helpers DTE ──────────────────────────────────────────────
function dteSaldoDeudor_(d) {
  return (d.Saldo && typeof d.Saldo === 'object') ? Number(d.Saldo.saldoDeudor || 0) : 0;
}
function dteMontoTotal_(d) { return Number(d.montoTotal || 0); }
function dteMontoNeto_(d)  { return Number(d.montoNeto  || 0); }
function dteCliente_(d) {
  return (d.ClienteNormalizado && d.ClienteNormalizado.nombre) || d.razonSocial || ('ID:' + d.idCliente);
}
function dteAnulado_(d)    { return d.anulado === true || d.anulado === 1; }
function dteEsFactura_(d)  { return d.tipo === 33 || d.tipo === 34; }
function dteEsNotaCred_(d) { return d.tipo === 61; }

// ── Helpers Compras ──────────────────────────────────────────
function cmpSaldoDeudor_(f) {
  if (f.Saldo && typeof f.Saldo === 'object') return Number(f.Saldo.saldoDeudor || 0);
  return Number(f.montoPorPagar || 0);
}
function cmpAnulada_(f)   { return f.anulado === true || f.anulado === 1; }
function cmpMontoNeto_(f) { return Number(f.montoNeto || 0); }
function cuentaSaldo_(c)  { return Number(c.saldo || 0); }

// ── Función principal Chipax (con caché) ─────────────────────
function getChipaxDashboard() {
  // Intentar caché primero
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CHIPAX_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      Logger.log('✓ Chipax: usando caché (TTL ' + CHIPAX_CACHE_TTL + 's)');
      return parsed;
    } catch(e) {}
  }

  try {
    const t0     = Date.now();
    const token  = chipaxGetToken_();
    const desde  = chipaxInicioMes_();
    const mesAct = desde.substring(0, 7);

    // DTEs: ~137 docs en 3 páginas, rápido
    const dtesTodos = chipaxGet_(token, 'dtes', {});

    // Compras: 6,409 totales — solo traer las que tengan saldo pendiente
    // No hay parámetro server-side para filtrar, así que paramos cuando ya llegamos a páginas viejas pagadas
    // En la práctica las primeras páginas son las más recientes (pendientes)
    // Limitamos a 30 páginas (= 1500 docs) para evitar timeout
    const comprasTodas = chipaxGet_(token, 'compras', {}, { maxPages: 30 });

    // Datos del mes
    const gastosMes   = chipaxGet_(token, 'gastos', { fecha_desde: desde }, { maxPages: 5 });
    const cuentasCtes = chipaxGet_(token, 'cuentas-corrientes');
    const movimientos = chipaxGet_(token, 'movimientos', { fecha_desde: desde }, { maxPages: 5 });
    const clientes    = chipaxGet_(token, 'clientes', {}, { maxPages: 10 });

    const saldoBancos = cuentasCtes.reduce(function(a,c) { return a + cuentaSaldo_(c); }, 0);

    // Ventas MTD: facturas tipo 33/34 emitidas este mes - notas crédito del mes
    const facturasMes = dtesTodos.filter(function(d) {
      return dteEsFactura_(d) && !dteAnulado_(d) &&
             String(d.fechaEmision || '').startsWith(mesAct);
    });
    const ventasBrutas = facturasMes.reduce(function(a,d) { return a + dteMontoNeto_(d); }, 0);

    const ncMes = dtesTodos.filter(function(d) {
      return dteEsNotaCred_(d) && !dteAnulado_(d) &&
             String(d.fechaEmision || '').startsWith(mesAct);
    });
    const ncMonto   = ncMes.reduce(function(a,d) { return a + dteMontoNeto_(d); }, 0);
    const ventasMTD = ventasBrutas - ncMonto;

    // CxC: facturas con saldoDeudor > 0 (Saldo.saldoDeudor ya descuenta cartolas)
    const facturasPendientes = dtesTodos.filter(function(d) {
      return dteEsFactura_(d) && !dteAnulado_(d) && dteSaldoDeudor_(d) > 0;
    });
    const totalCXC = facturasPendientes.reduce(function(a,d) { return a + dteSaldoDeudor_(d); }, 0);

    // Compras MTD
    const cmpMes = comprasTodas.filter(function(f) {
      return !cmpAnulada_(f) && String(f.fechaEmision || '').startsWith(mesAct);
    });
    const comprasMTD = cmpMes.reduce(function(a,f) { return a + cmpMontoNeto_(f); }, 0);

    // Gastos MTD
    const gastosMTD = gastosMes.reduce(function(a,g) { return a + Number(g.monto || 0); }, 0);

    // CxP: todas las compras con saldoDeudor > 0
    const pendientesC = comprasTodas.filter(function(f) {
      return !cmpAnulada_(f) && cmpSaldoDeudor_(f) > 0;
    });
    const totalCXP = pendientesC.reduce(function(a,f) { return a + cmpSaldoDeudor_(f); }, 0);

    const movsOrdenados = movimientos
      .sort(function(a,b) { return new Date(b.fecha||0) - new Date(a.fecha||0); })
      .slice(0, 20);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    Logger.log('Chipax completo en ' + elapsed + 's');
    Logger.log('saldoBancos: $' + Math.round(saldoBancos/1e6) + 'M');
    Logger.log('ventasMTD:   $' + Math.round(ventasMTD/1e6)   + 'M (' + facturasMes.length + ' fact - ' + ncMes.length + ' NC)');
    Logger.log('comprasMTD:  $' + Math.round(comprasMTD/1e6)  + 'M (' + cmpMes.length + ' docs mes)');
    Logger.log('gastosMTD:   $' + Math.round(gastosMTD/1e6)   + 'M');
    Logger.log('totalCXC:    $' + Math.round(totalCXC/1e6)    + 'M (' + facturasPendientes.length + ' facturas)');
    Logger.log('totalCXP:    $' + Math.round(totalCXP/1e6)    + 'M (' + pendientesC.length + ' compras)');

    const facturasVentaFmt = facturasPendientes
      .sort(function(a,b) { return new Date(b.fechaEmision||0) - new Date(a.fechaEmision||0); })
      .slice(0, 30)
      .map(function(d) {
        return {
          number      : d.folio,
          contact_name: dteCliente_(d),
          date        : d.fechaEmision,
          due_date    : d.fechaVencimiento,
          total       : dteSaldoDeudor_(d),
          amount      : dteSaldoDeudor_(d),
          montoTotal  : dteMontoTotal_(d),
          status      : 'Pendiente',
        };
      });

    const facturasCompraFmt = pendientesC
      .sort(function(a,b) { return new Date(b.fechaEmision||0) - new Date(a.fechaEmision||0); })
      .slice(0, 30)
      .map(function(f) {
        return {
          number      : f.folio,
          contact_name: f.razonSocial || '—',
          date        : f.fechaEmision,
          due_date    : f.fechaVencimiento,
          total       : cmpSaldoDeudor_(f),
          amount      : cmpSaldoDeudor_(f),
          status      : f.estado || 'Pendiente',
        };
      });

    const cuentasFmt = cuentasCtes.map(function(c) {
      return {
        name          : c.banco || '—',
        bank_name     : c.banco || '—',
        account_number: c.numeroCuenta || '—',
        account_type  : (c.TipoCuentaCorriente && c.TipoCuentaCorriente.nombreCorto) || '—',
        balance       : cuentaSaldo_(c),
      };
    });

    const movsFmt = movsOrdenados.map(function(m) {
      return {
        date       : m.fecha,
        description: m.detalle || '—',
        amount     : Number(m.montoNeto || 0),
      };
    });

    const result = {
      saldoBancos              : saldoBancos,
      ventasMTD                : ventasMTD,
      comprasMTD               : comprasMTD + gastosMTD,
      totalCXC                 : totalCXC,
      totalCXP                 : totalCXP,
      cxcCount                 : facturasPendientes.length,
      cxpCount                 : pendientesC.length,
      clientesCount            : clientes.length,
      proveedoresCount         : 0,
      facturasPendientesVenta  : facturasVentaFmt,
      facturasPendientesCompra : facturasCompraFmt,
      cuentasBancarias         : cuentasFmt,
      movimientosRecientes     : movsFmt,
    };

    // Guardar en caché
    try {
      cache.put(CHIPAX_CACHE_KEY, JSON.stringify(result), CHIPAX_CACHE_TTL);
    } catch(e) {
      Logger.log('Cache put falló (probablemente >100KB): ' + e.message);
    }

    return result;

  } catch(e) {
    Logger.log('getChipaxDashboard ERROR: ' + e.message + '\n' + e.stack);
    return { error: e.message };
  }
}

function chipaxLimpiarCache() {
  CacheService.getScriptCache().remove(CHIPAX_CACHE_KEY);
  Logger.log('Caché Chipax limpiado.');
}

function getResumenM5Chipax() {
  try {
    const d = getChipaxDashboard();
    if (d.error) return { error: d.error };
    return {
      facturadoMTD   : d.ventasMTD,
      totalCXC       : d.totalCXC,
      totalCXP       : d.totalCXP,
      saldoBancos    : d.saldoBancos,
      ventasMTD      : d.ventasMTD,
      comprasMTD     : d.comprasMTD,
      forecastFact   : 0,
      forecastCierre : 0,
      presupuestoMes : 0,
    };
  } catch(e) { return { error: e.message }; }
}

function getResumenPolchile() {
  try {
    const payload = buildDashboardPayload();
    if (payload.error) return {};
    const k = payload.kpis || {};
    return {
      presupuestoMes : (k.presupuestoMes  || 0) * 1e6,
      facturadoMTD   : k.facturadoMTD     || 0,
      ventasMTD      : k.nvEmitidasMTD    || 0,
      cotizadoMTD    : k.cotizadoMTD      || 0,
      forecastFact   : k.porFacturar       || 0,
      forecastVentas : k.nvEmitidasYTD    || 0,
      totalCXC       : k.nvPendientesYTD  || 0,
    };
  } catch(e) {
    return {};
  }
}

function testChipax() {
  chipaxLimpiarCache(); // forzar refresh
  const data = getChipaxDashboard();
  if (data.error) { Logger.log('❌ ' + data.error); return; }
  Logger.log('✓ Chipax OK');
  Logger.log('  saldoBancos: $' + Math.round(data.saldoBancos/1e6) + 'M');
  Logger.log('  ventasMTD:   $' + Math.round(data.ventasMTD/1e6)   + 'M');
  Logger.log('  comprasMTD:  $' + Math.round(data.comprasMTD/1e6)  + 'M');
  Logger.log('  totalCXC:    $' + Math.round(data.totalCXC/1e6)    + 'M (' + data.cxcCount + ' facturas)');
  Logger.log('  totalCXP:    $' + Math.round(data.totalCXP/1e6)    + 'M (' + data.cxpCount + ')');
  Logger.log('  cuentas:     '  + data.cuentasBancarias.length);
}

// ======================================================================
// WEB APP
// ======================================================================
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  if (action && action !== 'html') {
    var result;
    try {
      switch (action) {
        case 'data':               result = buildDashboardPayload(); break;
        case 'getResumenPolchile': result = getResumenPolchile();    break;
        case 'getResumenM5Chipax': result = getResumenM5Chipax();    break;
        case 'getChipaxDashboard': result = getChipaxDashboard();    break;
        default: result = { error: 'Acción desconocida: ' + action };
      }
    } catch (err) {
      result = { error: err.message };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const t = HtmlService.createTemplateFromFile('Index');
  t.scriptUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle('Polchile · Dashboard Comercial')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ======================================================================
// CONFIG GHL
// ======================================================================
function getConfig_() {
  const props      = PropertiesService.getScriptProperties();
  const token      = props.getProperty('GHL_TOKEN');
  const locationId = props.getProperty('GHL_LOCATION');
  if (!token || !locationId) throw new Error('Falta configurar GHL_TOKEN y GHL_LOCATION en Script Properties.');
  return { token, locationId };
}

function ghlFetch_(path, params) {
  const { token } = getConfig_();
  let url = GHL_BASE + path;
  if (params) {
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    url += (path.indexOf('?') >= 0 ? '&' : '?') + qs;
  }
  Utilities.sleep(2000);
  const res  = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + token, 'Version': GHL_VERSION, 'Accept': 'application/json' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) throw new Error('GHL ' + code + ' en ' + path + ': ' + body.substring(0, 500));
  return JSON.parse(body);
}

// ======================================================================
// SYNC GHL → Sheet
// ======================================================================
function writeSheet_(name, headers, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh   = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, headers.length + 2).setValue('Última sync:');
  sh.getRange(1, headers.length + 3).setValue(new Date());
}

function syncPipelines() {
  const { locationId } = getConfig_();
  const data      = ghlFetch_('/opportunities/pipelines', { locationId });
  const pipelines = data.pipelines || [];
  const rows      = [];
  pipelines.forEach(p => {
    (p.stages || []).forEach((s, i) => rows.push([p.id, p.name, i + 1, s.id, s.name, s.position || i]));
  });
  writeSheet_('GHL_Pipelines',
    ['pipeline_id','pipeline_name','stage_order','stage_id','stage_name','position'], rows);
  return pipelines;
}

function toEpoch_(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

function syncOpportunities() {
  const { locationId } = getConfig_();
  const data = ghlFetch_('/opportunities/pipelines', { locationId });

  const pipelineTeleventa = (data.pipelines || []).find(p => /televenta/i.test(p.name));
  const pipelinePostVenta = (data.pipelines || []).find(p => /post[\s-]?venta/i.test(p.name));

  const encabezados = [
    'opp_id','opp_name','contact_id','contact_name','stage_id','stage_name','stage_order',
    'status','monetary_value','assigned_to','source','date_added','last_stage_change_at','updated_at'
  ];

  if (pipelineTeleventa) {
    writeSheet_('GHL_Opportunities', encabezados, fetchOppData_(locationId, pipelineTeleventa));
  } else {
    Logger.log('Aviso: No se encontró el pipeline "Televenta"');
  }
  if (pipelinePostVenta) {
    writeSheet_('GHL_PostVenta', encabezados, fetchOppData_(locationId, pipelinePostVenta));
  } else {
    Logger.log('Aviso: No se encontró el pipeline "Post-venta"');
  }
}

function fetchOppData_(locationId, pipeline) {
  const stageMap = {};
  pipeline.stages.forEach((s, i) => stageMap[s.id] = { name: s.name, order: i + 1 });
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const params = { location_id: locationId, pipeline_id: pipeline.id, limit: 100, page: i + 1 };
    let res;
    try { res = ghlFetch_('/opportunities/search', params); }
    catch (err) { Logger.log('Error en ' + pipeline.name + ': ' + err.message); break; }
    const opps = res.opportunities || [];
    if (!opps.length) break;
    opps.forEach(o => {
      const stage = stageMap[o.pipelineStageId] || {};
      rows.push([
        o.id, o.name || '', o.contactId || '', (o.contact && o.contact.name) || '',
        o.pipelineStageId || '', stage.name || '', stage.order || '',
        o.status || '', Number(o.monetaryValue || 0),
        o.assignedTo || '', o.source || '',
        o.dateAdded || '', o.lastStageChangeAt || '', o.updatedAt || ''
      ]);
    });
    if (opps.length < 100) break;
  }
  return rows;
}

function syncContacts() {
  const { locationId } = getConfig_();
  const rows = [];
  let startAfter = null, startAfterId = null;
  for (let i = 0; i < 100; i++) {
    const params = { locationId: locationId, limit: 100 };
    if (startAfter !== null) { params.startAfter = startAfter; params.startAfterId = startAfterId; }
    let res;
    try { res = ghlFetch_('/contacts/', params); }
    catch (err) { Logger.log('syncContacts: ' + err.message); break; }
    const cts = res.contacts || [];
    if (!cts.length) break;
    cts.forEach(c => {
      rows.push([
        c.id,
        c.contactName || ((c.firstName || '') + ' ' + (c.lastName || '')).trim(),
        c.email || '', c.phone || '', (c.tags || []).join('|'),
        c.dateAdded || '', c.lastActivity || ''
      ]);
    });
    if (cts.length < 100) break;
    const last   = cts[cts.length - 1];
    startAfter   = toEpoch_(last.dateAdded);
    startAfterId = last.id;
  }
  writeSheet_('GHL_Contacts',
    ['contact_id','name','email','phone','tags','date_added','last_activity'], rows);
}

// ======================================================================
// BUILD PIPELINE SUMMARY
// ======================================================================
function buildPipelineSummary() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shOpp = ss.getSheetByName('GHL_Opportunities');
  if (!shOpp) { Logger.log('No existe GHL_Opportunities'); return; }

  const data    = shOpp.getDataRange().getValues();
  const head    = data[0].map(h => h.toString().toLowerCase().trim());
  const iStage  = head.indexOf('stage_name');
  const iStatus = head.indexOf('status');
  const iMonto  = head.indexOf('monetary_value');
  const iOrder  = head.indexOf('stage_order');

  const resumen = {};
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const etapa  = String(row[iStage]  || '').trim();
    const status = String(row[iStatus] || '').trim().toLowerCase();
    const monto  = parseFloat(row[iMonto]) || 0;
    const order  = parseInt(row[iOrder])   || 99;
    if (!etapa || status === 'lost') continue;
    if (!resumen[etapa]) resumen[etapa] = { order, n: 0, monto: 0 };
    resumen[etapa].n     += 1;
    resumen[etapa].monto += monto;
  }

  const PROB = {
    'lead no atendido':    5,
    'lead atendido':      10,
    'cotizacion enviada': 40,
    'cotizaciones gana':  40,
    'negociacion cierre': 70,
    'nv emitida':         90,
    'nv ingresada':       90,
    'compromiso de comp': 95,
    'ganado':            100
  };
  const getProb = (etapa) => {
    const key = etapa.toLowerCase();
    for (const k of Object.keys(PROB)) { if (key.includes(k)) return PROB[k]; }
    return 20;
  };

  const rows = [['stage_order','stage_name','opps','monto_bruto_clp','prob_pct','monto_ponderado_clp']];
  Object.keys(resumen)
    .sort((a,b) => resumen[a].order - resumen[b].order)
    .forEach(etapa => {
      const r    = resumen[etapa];
      const prob = getProb(etapa);
      rows.push([r.order, etapa, r.n, Math.round(r.monto), prob, Math.round(r.monto * prob / 100)]);
    });

  let sh = ss.getSheetByName('GHL_PipelineSummary');
  if (!sh) sh = ss.insertSheet('GHL_PipelineSummary');
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
}

// ======================================================================
// HELPERS FECHAS GHL
// ======================================================================
function parsearFechaISO_(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function esMismodia_(fecha, referencia) {
  return fecha.getFullYear() === referencia.getFullYear() &&
         fecha.getMonth()    === referencia.getMonth()    &&
         fecha.getDate()     === referencia.getDate();
}
function diasDesde_(fecha, referencia) {
  return Math.floor((referencia - fecha) / (1000 * 60 * 60 * 24));
}

// ======================================================================
// PAYLOAD PRINCIPAL DEL DASHBOARD POLCHILE
// ======================================================================
function buildDashboardPayload() {
  try {
    const SS_ID = "1sIoLlGRhmgPAny9rAatUBpw7ojTidjVuJppLMCzi8W8";
    const ss    = SpreadsheetApp.openById(SS_ID);

    const leerNumero = (val) => {
      if (typeof val === 'number') return val;
      if (!val) return 0;
      const str    = String(val).trim();
      const esNeg  = str.includes('-');
      const limpio = str.replace(/[$]/g,'').replace(/\./g,'').replace(/,/g,'.').replace(/[^0-9.]/g,'');
      const num    = parseFloat(limpio) || 0;
      return esNeg ? -Math.abs(num) : Math.abs(num);
    };

    const normalizarTexto = (str) =>
      String(str || '').normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();

    const parsearFecha = (celda) => {
      if (celda == null || celda === '') return null;
      if (Object.prototype.toString.call(celda) === '[object Date]') {
        if (isNaN(celda.getTime())) return null;
        return { y: celda.getFullYear(), m0: celda.getMonth(), d: celda.getDate() };
      }
      if (typeof celda === 'number') {
        const d = new Date(Math.round((celda - 25569) * 86400 * 1000));
        return { y: d.getUTCFullYear(), m0: d.getUTCMonth(), d: d.getUTCDate() };
      }
      const txt = String(celda).trim().split(' ')[0];
      const sep = txt.indexOf('-') !== -1 ? '-' : '/';
      const p   = txt.split(sep);
      if (p.length !== 3) return null;
      const p0 = p[0].trim(), p1 = p[1].trim(), p2 = p[2].trim();
      if (p0.length === 4) return { y: parseInt(p0,10), m0: parseInt(p1,10)-1, d: parseInt(p2,10) };
      if (p2.length === 4) return { y: parseInt(p2,10), m0: parseInt(p1,10)-1, d: parseInt(p0,10) };
      return null;
    };

    const now          = new Date();
    const currentMonth = now.getMonth();
    const currentDay   = now.getDate();
    const currentYear  = now.getFullYear();
    const hace7dias    = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const PRESUPUESTO_MENSUAL = [383.4,421.2,437.4,367.2,448.2,502.2,459.0,469.8,459.0,415.8,534.6,502.2];
    const totalDiasMes        = new Date(currentYear, currentMonth + 1, 0).getDate();
    const pptoDiario          = PRESUPUESTO_MENSUAL[currentMonth] / totalDiasMes;

    const semanasDelMes = [
      { sem:"S1", presup: pptoDiario * 7,                 vendido: 0, isFuture: false },
      { sem:"S2", presup: pptoDiario * 7,                 vendido: 0, isFuture: false },
      { sem:"S3", presup: pptoDiario * 7,                 vendido: 0, isFuture: false },
      { sem:"S4", presup: pptoDiario * 7,                 vendido: 0, isFuture: false },
      { sem:"S5", presup: pptoDiario * (totalDiasMes-28), vendido: 0, isFuture: false }
    ];
    const currentWeekIdx = Math.min(Math.floor((currentDay-1)/7), 4);
    for (let w = 0; w < 5; w++) {
      if (w > currentWeekIdx) { semanasDelMes[w].isFuture = true; semanasDelMes[w].proy = semanasDelMes[w].presup; }
    }

    const graficoDiarioData = Array.from({ length: totalDiasMes }, (_,i) => ({ d: i+1, fact: 0 }));
    const graficoDiarioNV   = Array.from({ length: totalDiasMes }, (_,i) => ({ d: i+1, nv: 0 }));

    let totalFavMes       = 0;
    let totalNcvMes       = 0;
    let totalFacturadoYTD = 0;
    let totalNetoYTD      = 0;
    let totalCtoYTD       = 0;
    const clientesData    = {};
    const familiasData    = {};
    const COD_VDDOR_MAP = {
      'CBI': 'cb', 'MAJ': 'mj', 'OP':  'op',
      'OAO': 'oa', 'HP':  'hp', 'LB':  'lb',
      'LBA': 'lb', 'LBY': 'lb'
    };
    const vendedorStats = {
      'cb':    { facturado:0, nv:0, cotizado:0 },
      'mj':    { facturado:0, nv:0, cotizado:0 },
      'op':    { facturado:0, nv:0, cotizado:0 },
      'oa':    { facturado:0, nv:0, cotizado:0 },
      'hp':    { facturado:0, nv:0, cotizado:0 },
      'lb':    { facturado:0, nv:0, cotizado:0 },
      'otros': { facturado:0, nv:0, cotizado:0 },
    };
    const managerStats    = { facturacion: 0, pendientes: 0, margen: 0, facturacionMensual: Array(12).fill(0) };
    let pipelineData      = [];

    const MARGEN_PRESUP_MAP = {};
    const shSupuestos = ss.getSheetByName("Supuestos y Parámetros");
    if (shSupuestos) {
      const dataSup = shSupuestos.getDataRange().getValues();
      for (let i = 5; i < dataSup.length; i++) {
        const row    = dataSup[i];
        const origen = String(row[26] || '').trim();
        const cat    = String(row[27] || '').trim();
        const clase  = String(row[28] || '').trim();
        const proy   = parseFloat(row[31]) || 0;
        if (origen && cat && proy > 0) {
          const keyFull   = (origen + '|' + cat + '|' + clase).toLowerCase().trim();
          const keySimple = (cat + '|' + clase).toLowerCase().trim();
          MARGEN_PRESUP_MAP[keyFull]   = proy * 100;
          if (!MARGEN_PRESUP_MAP[keySimple] || origen.toLowerCase().includes('fabricac')) {
            MARGEN_PRESUP_MAP[keySimple] = proy * 100;
          }
        }
      }
    }

    const getMargenPresup = (nomClase1) => {
      const n = nomClase1.toLowerCase();
      if (n.includes('poliestireno') || (n.includes('pa ') && n.includes('pol'))) {
        return MARGEN_PRESUP_MAP['fabricación|paneles |pol'] || MARGEN_PRESUP_MAP['paneles|pol'] || 45;
      }
      if (n.includes('poliuretano') || (n.includes('pa ') && n.includes('pur'))) {
        return MARGEN_PRESUP_MAP['fabricación|paneles |pur'] || MARGEN_PRESUP_MAP['paneles|pur'] || 10;
      }
      if (n.includes('pa fabricado') && n.includes('industrial')) {
        return MARGEN_PRESUP_MAP['fabricación|planchas|industrial'] || 22;
      }
      if (n.includes('pa fabricado') && (n.includes('arquitect') || n.includes('arquitectonico'))) {
        return MARGEN_PRESUP_MAP['fabricación|planchas|arquitectónico'] || MARGEN_PRESUP_MAP['fabricación|planchas|arquitectonico'] || 8;
      }
      if (n.includes('hojalat')) {
        return MARGEN_PRESUP_MAP['fabricación|hojalatería|'] || MARGEN_PRESUP_MAP['fabricación|hojalateria|'] || 3.9;
      }
      if (n.includes('lana')) {
        return MARGEN_PRESUP_MAP['comercialización|paneles|lana'] || MARGEN_PRESUP_MAP['paneles|lana'] || 1;
      }
      if (n.includes('pir')) {
        return MARGEN_PRESUP_MAP['comercialización|paneles|pir'] || MARGEN_PRESUP_MAP['paneles|pir'] || 0.5;
      }
      if (n.includes('psa') && n.includes('masivo')) {
        return MARGEN_PRESUP_MAP['comercialización|planchas|masivo'] || 0.5;
      }
      if (n.includes('psa') && n.includes('industrial')) {
        return MARGEN_PRESUP_MAP['comercialización|planchas|industrial'] || 0.5;
      }
      if (n.includes('psa comercializada') || (n.includes('psa') && !n.includes('masivo') && !n.includes('industrial'))) {
        return MARGEN_PRESUP_MAP['comercialización|planchas|masivo'] || 0.5;
      }
      if (n.includes('accesor')) {
        return MARGEN_PRESUP_MAP['comercialización|accesorios|'] || 3.6;
      }
      if (n.includes('despacho') || n.includes('transport')) {
        return MARGEN_PRESUP_MAP['despachos|transportes|'] || 3;
      }
      if (n.includes('servicio')) {
        return MARGEN_PRESUP_MAP['servicios|servicios - otros|'] || 2;
      }
      return 0;
    };

    // 1. PIPELINE CRM
    const sheetCRM = ss.getSheets().find(s => normalizarTexto(s.getName()).includes('pipelinesummary'));
    if (sheetCRM) {
      const rawCRM   = sheetCRM.getDataRange().getValues();
      const head     = rawCRM[0].map(h => normalizarTexto(h));
      const colEtapa = head.indexOf('stage_name')          !== -1 ? head.indexOf('stage_name')          : 1;
      const colOpps  = head.indexOf('opps')                !== -1 ? head.indexOf('opps')                : 2;
      const colMonto = head.indexOf('monto_bruto_clp')     !== -1 ? head.indexOf('monto_bruto_clp')     :
                       head.indexOf('monto_bruto_c')       !== -1 ? head.indexOf('monto_bruto_c')       : 3;
      const colProb  = head.indexOf('prob_pct')            !== -1 ? head.indexOf('prob_pct')            : 4;
      const colPond  = head.indexOf('monto_ponderado_clp') !== -1 ? head.indexOf('monto_ponderado_clp') : 5;

      for (let i = 1; i < rawCRM.length; i++) {
        const row   = rawCRM[i];
        const etapa = String(row[colEtapa] || '').trim();
        if (!etapa || etapa.toLowerCase() === 'stage_name') continue;
        if (typeof row[colOpps] !== 'number' && isNaN(parseInt(row[colOpps]))) continue;
        pipelineData.push({
          etapa:     etapa,
          n:         parseInt(row[colOpps]) || 0,
          monto:     Math.abs(leerNumero(row[colMonto])) / 1000000,
          prob:      Math.round(parseFloat(row[colProb]) || 0),
          ponderado: Math.abs(leerNumero(row[colPond]))  / 1000000
        });
      }
    }

    // 2. COTIZADO MTD
    let cotizadoMTD = 0;
    const sheetCot = ss.getSheets().find(s => normalizarTexto(s.getName()) === 'cotizaciones');
    if (sheetCot) {
      const rawTxt = sheetCot.getDataRange().getDisplayValues();
      const rawNum = sheetCot.getDataRange().getValues();
      for (let i = 1; i < rawTxt.length; i++) {
        const docStr  = String(rawTxt[i][0] || '').toLowerCase().trim();
        const probStr = String(rawTxt[i][3] || '').toLowerCase().trim();
        const total   = rawNum[i][6];
        if (!docStr || docStr.includes('total') || docStr.includes('documento')) continue;
        if (probStr.includes('rechazad')) continue;
        const p = String(rawTxt[i][1]).trim().split(/[-/]/);
        if (p.length === 3) {
          let y, m, d;
          if (p[0].length === 4) { y = parseInt(p[0]); m = parseInt(p[1]); d = parseInt(p[2]); }
          else                   { y = parseInt(p[2]); m = parseInt(p[1]); d = parseInt(p[0]); }
          if (y === currentYear && m === (currentMonth + 1) && d <= currentDay) {
            cotizadoMTD += Math.abs(leerNumero(total));
          }
        }
      }
    }

    // 3. VENTAS FULL MANAGER
    const hojaVentas = ss.getSheetByName("Ventas Full Manager") || ss.getSheetByName("Ventas_Full");
    if (hojaVentas) {
      const dataV = hojaVentas.getDataRange().getValues();
      if (dataV && dataV.length > 1) {
        const enc = dataV[0].map(h => h.toString().trim().toLowerCase());

        const _docto   = enc.findIndex(h => h === 'docto');
        const _fechaV  = enc.findIndex(h => h === 'fecha_emision');
        const _mesText = enc.findIndex(h => h === 'mes');
        const _neto    = enc.findIndex(h => h === 'total_neto');
        const _cliente = enc.findIndex(h => h === 'cliente');
        const _familia = enc.findIndex(h => h === 'clase1');
        const _cto     = enc.findIndex(h => h === 'cto_promedio_total');
        const _codvdd  = enc.findIndex(h => h === 'cod_vddor') !== -1 ? enc.findIndex(h => h === 'cod_vddor') : 5;

        const iDoc = _docto   !== -1 ? _docto   : 0;
        const iFec = _fechaV  !== -1 ? _fechaV  : 3;
        const iMes = _mesText !== -1 ? _mesText : 8;
        const iNet = _neto    !== -1 ? _neto    : 30;
        const iCli = _cliente !== -1 ? _cliente : 10;
        const iFam = _familia !== -1 ? _familia : 15;
        const iCto = _cto     !== -1 ? _cto     : 31;

        const MESES_ENG = ["january","february","march","april","may","june","july","august","september","october","november","december"];
        const MESES_ESP = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

        let fact7dTotal = 0;
        let fact7dN     = 0;

        for (let i = 1; i < dataV.length; i++) {
          const fila = dataV[i];
          if (!fila || fila.length <= iNet || !fila[iDoc]) continue;
          if (String(fila[0]).toLowerCase().includes('total')) continue;

          const tipo  = String(fila[iDoc]).trim().toUpperCase();
          const esFav = tipo === 'FAV' || tipo === 'FA' || tipo.includes('FAV');
          const esNcv = tipo === 'NCV' || tipo === 'NC';
          if (!esFav && !esNcv) continue;

          let f    = parsearFecha(fila[iFec]);
          let fYTD = f;

          if (!fYTD && fila[iMes]) {
            const txt = String(fila[iMes]).toLowerCase().trim();
            let idx   = MESES_ENG.findIndex(m => txt.includes(m));
            if (idx === -1) idx = MESES_ESP.findIndex(m => txt.includes(m));
            if (idx !== -1) fYTD = { y: currentYear, m0: idx, d: 1 };
          }

          const valorAbs  = Math.abs(leerNumero(fila[iNet]));
          const netoSigno = esNcv ? -valorAbs : valorAbs;

          if (fYTD && fYTD.m0 >= 0 && fYTD.m0 <= 11) {
            managerStats.facturacionMensual[fYTD.m0] += netoSigno;
            totalFacturadoYTD += netoSigno;
            totalNetoYTD += netoSigno;
            const ctoFila = Math.abs(leerNumero(fila[iCto]));
            totalCtoYTD  += esNcv ? -ctoFila : ctoFila;
          }

          const nomCli = fila[iCli] ? String(fila[iCli]).trim() : '';
          if (nomCli) clientesData[nomCli] = (clientesData[nomCli] || 0) + netoSigno;

          const codVdd = String(fila[_codvdd] || '').trim().toUpperCase();
          const vddKey = COD_VDDOR_MAP[codVdd] || 'otros';
          vendedorStats[vddKey].facturado += netoSigno;

          if (f && f.y === currentYear && f.m0 === currentMonth && f.d <= currentDay) {
            if (!vendedorStats[vddKey].facturadoMTD) vendedorStats[vddKey].facturadoMTD = 0;
            vendedorStats[vddKey].facturadoMTD += esNcv ? -valorAbs : valorAbs;
          }

          const nomFam = fila[iFam] ? String(fila[iFam]).trim() : '';
          if (nomFam) {
            if (!familiasData[nomFam]) familiasData[nomFam] = { neto: 0, cto: 0 };
            familiasData[nomFam].neto += netoSigno;
            const ctoFilaFam = Math.abs(leerNumero(fila[iCto]));
            familiasData[nomFam].cto += esNcv ? -ctoFilaFam : ctoFilaFam;
          }

          if (f && f.y === currentYear && f.m0 === currentMonth && f.d <= currentDay) {
            if (esFav) totalFavMes += valorAbs;
            if (esNcv) totalNcvMes += valorAbs;
            const wk = Math.min(Math.floor((f.d-1)/7), 4);
            semanasDelMes[wk].vendido += netoSigno / 1000000;
            if (f.d >= 1 && f.d <= totalDiasMes) graficoDiarioData[f.d-1].fact += netoSigno / 1000000;
          }

          if (f) {
            const fechaReal = new Date(f.y, f.m0, f.d);
            if (fechaReal >= hace7dias) {
              fact7dTotal += netoSigno;
              if (esFav) fact7dN++;
            }
          }
        }

        managerStats._fact7dTotal = fact7dTotal;
        managerStats._fact7dN     = fact7dN;
      }
    }

    const facturadoMTD       = totalFavMes - totalNcvMes;
    managerStats.facturacion = totalFacturadoYTD;
    managerStats.margen      = totalNetoYTD - totalCtoYTD;

    // 4. BACKLOG NV→FACT
    let porFacturar = 0;
    const hojaCalendario = ss.getSheetByName("Calendario");
    if (hojaCalendario) {
      const dataCal = hojaCalendario.getDataRange().getValues();
      const headCal = dataCal[0].map(h => normalizarTexto(h));

      let colPesos = headCal.findIndex(h => h.includes('pesos') && h.includes('facturar'));
      if (colPesos === -1) colPesos = headCal.findIndex(h => h.includes('monto') || h.includes('total') || h.includes('pesos'));

      let colFechaCal = headCal.findIndex(h => h.includes('fecha_entrega_final'));
      if (colFechaCal === -1) colFechaCal = headCal.findIndex(h => h.includes('fecha_entrega'));
      if (colFechaCal === -1) colFechaCal = headCal.findIndex(h => h === 'fecha' || h.includes('fecha'));

      if (colPesos !== -1) {
        for (let i = 1; i < dataCal.length; i++) {
          if (!dataCal[i] || !dataCal[i][0]) continue;
          if (String(dataCal[i][0]).toLowerCase().includes('total')) continue;

          let esMesActual = false;
          if (colFechaCal !== -1) {
            const fCal = parsearFecha(dataCal[i][colFechaCal]);
            if (fCal && fCal.y === currentYear && fCal.m0 === currentMonth) esMesActual = true;
          }
          if (!esMesActual && colFechaCal === -1) esMesActual = true;
          if (esMesActual) porFacturar += Math.abs(leerNumero(dataCal[i][colPesos]));
        }
      }
    }

    // 5. NV EMITIDAS
    let nvEmitidasMTD = 0;
    let nvEmitidasYTD = 0;
    const sheetNV = ss.getSheets().find(s => normalizarTexto(s.getName()).includes('notas de venta'));
    if (sheetNV) {
      const rawNV   = sheetNV.getDataRange().getValues();
      const headNV  = rawNV[0].map(h => normalizarTexto(h));
      const colNeto = headNV.findIndex(h => h === 'total_neto' || h === 'totneto');
      const colFNV  = headNV.indexOf('fecha') !== -1 ? headNV.indexOf('fecha') : 1;
      const iNeto   = colNeto !== -1 ? colNeto : 3;
      const colCodVddNV = headNV.findIndex(h => h === 'codvend' || h === 'cod_vddor' || h.includes('codvend'));
      for (let i = 1; i < rawNV.length; i++) {
        if (String(rawNV[i][0] || '').toLowerCase().includes('total')) continue;
        const val = Math.abs(leerNumero(rawNV[i][iNeto]));
        if (!val) continue;
        const fNV = parsearFecha(rawNV[i][colFNV]);
        if (colCodVddNV !== -1 && fNV && fNV.y === currentYear && fNV.m0 === currentMonth) {
          const codVddNV = String(rawNV[i][colCodVddNV] || '').trim().toUpperCase();
          const vddKeyNV = COD_VDDOR_MAP[codVddNV] || 'otros';
          vendedorStats[vddKeyNV].nv += val / 1000000;
        }
        if (fNV && fNV.y === currentYear) nvEmitidasYTD += val;
        if (fNV && fNV.y === currentYear && fNV.m0 === currentMonth) {
          nvEmitidasMTD += val;
          if (fNV.d >= 1 && fNV.d <= totalDiasMes) graficoDiarioNV[fNV.d - 1].nv += val / 1000000;
        }
      }
    }

    // 6. GHL_OPPORTUNITIES
    const movimientosHoy    = [];
    const sinMovimiento     = [];
    const cierresPendientes = [];
    let cot7dTotal = 0, cot7dN = 0;
    let nv7dTotal  = 0, nv7dN  = 0;

    const shOpp = ss.getSheetByName('GHL_Opportunities');
    if (shOpp) {
      const dataOpp  = shOpp.getDataRange().getValues();
      const headOpp  = dataOpp[0].map(h => h.toString().toLowerCase().trim());
      const iOppName = headOpp.indexOf('opp_name');
      const iStage   = headOpp.indexOf('stage_name');
      const iStatus  = headOpp.indexOf('status');
      const iMonto   = headOpp.indexOf('monetary_value');
      const iAsig    = headOpp.indexOf('assigned_to');
      const iSource  = headOpp.indexOf('source');
      const iAdded   = headOpp.indexOf('date_added');
      const iUpdated = headOpp.indexOf('updated_at');
      const iLastChg = headOpp.indexOf('last_stage_change_at');

      const VENDEDOR_MAP = {
        'AT9FlSAzYdfFv25XUTud': 'Hernán Paulsen',
        'N6wSTyArAKAvJDNUg3sU': 'Linda Bayle',
        'BItUC1IlynS23tomySTZ': 'Melysa Jiménez',
        'j5eauWMbRxPmusoGabGJ': 'Orlando Armas',
        'T46RpOBhAQqJCayE0dO5': 'Oscar Paredes',
      };

      const nombrarVendedor = (id) => VENDEDOR_MAP[id] || (id ? id.substring(0,8) + '...' : 'Sin asignar');
      const esEtapaCot = (etapa) => {
        const e = etapa.toLowerCase();
        return e.includes('cotiz') || e.includes('cot ') || e.includes('enviada');
      };
      const esEtapaNV = (etapa) => {
        const e = etapa.toLowerCase();
        return e.includes('nv ') || e.includes('nota de venta') || e.includes('compromiso') || e.includes('nv emitida') || e.includes('nv ingresada');
      };

      for (let i = 1; i < dataOpp.length; i++) {
        const row    = dataOpp[i];
        const status = String(row[iStatus] || '').trim().toLowerCase();
        if (status !== 'open') continue;

        const etapa    = String(row[iStage]   || '').trim();
        const negocio  = String(row[iOppName] || '').trim();
        const monto    = (parseFloat(row[iMonto]) || 0) / 1000000;
        const vendedor = nombrarVendedor(String(row[iAsig] || '').trim());
        const origen   = String(row[iSource]  || '').trim();

        const fechaUpdated = parsearFechaISO_(String(row[iUpdated] || ''));
        const fechaAdded   = parsearFechaISO_(String(row[iAdded]   || ''));
        const fechaChg     = parsearFechaISO_(String(row[iLastChg] || ''));

        if (fechaUpdated && esMismodia_(fechaUpdated, now)) {
          movimientosHoy.push({ negocio: negocio || 'Sin nombre', etapa, vendedor, monto, origen });
        }

        const fechaRef = fechaChg || fechaAdded;
        if (fechaRef && fechaRef >= hace7dias) {
          if (esEtapaCot(etapa)) { cot7dTotal += monto; cot7dN++; }
          if (esEtapaNV(etapa))  { nv7dTotal  += monto; nv7dN++;  }
        }

        const refSinMov = fechaChg || fechaAdded;
        if (refSinMov) {
          const diasSinMov = diasDesde_(refSinMov, now);
          if (diasSinMov >= 7 && status === 'open') {
            sinMovimiento.push({ negocio: negocio || 'Sin nombre', etapa, vendedor, monto, dias: diasSinMov });
          }

          const esAvanzada = esEtapaNV(etapa) ||
            etapa.toLowerCase().includes('negociacion') ||
            etapa.toLowerCase().includes('compromiso') ||
            etapa.toLowerCase().includes('cotizacion enviada');
          if (esAvanzada && monto > 0 && status === 'open') {
            cierresPendientes.push({
              negocio: negocio || 'Sin nombre', etapa, vendedor, monto,
              dias: refSinMov ? diasDesde_(refSinMov, now) : 0,
            });
          }
        }
      }

      const shCot = ss.getSheetByName("Cotizaciones");
      if (shCot) {
        const rawCot = shCot.getDataRange().getValues();
        for (let i = 1; i < rawCot.length; i++) {
          const prob = String(rawCot[i][3] || '').trim().toLowerCase();
          if (prob === 'rechazada') continue;
          const codVdd = String(rawCot[i][4] || '').trim().toUpperCase();
          const total  = Math.abs(leerNumero(rawCot[i][6]));
          if (!total) continue;
          const fCot = parsearFecha(rawCot[i][1]);
          if (!fCot || fCot.y !== currentYear || fCot.m0 !== currentMonth) continue;
          const vKey = COD_VDDOR_MAP[codVdd] || 'otros';
          vendedorStats[vKey].cotizado += total / 1000000;
        }
      }

      movimientosHoy.sort((a,b) => b.monto - a.monto);
      sinMovimiento.sort((a,b) => b.dias - a.dias);
      cierresPendientes.sort((a,b) => b.monto - a.monto);
    }

    // 7. TOP 10 CLIENTES
    const topClientes = Object.keys(clientesData)
      .map(k => ({
        n:    k,
        val:  clientesData[k] / 1000000,
        pct:  totalFacturadoYTD > 0 ? (clientesData[k] / totalFacturadoYTD) * 100 : 0,
        type: 'REC'
      }))
      .sort((a,b) => b.val - a.val)
      .slice(0, 10)
      .map((item, idx) => { item.rank = idx + 1; return item; });

    // 8. MIX DE FAMILIAS
    const mixFamilias = Object.keys(familiasData)
      .map(k => ({
        fam:    k,
        p_pct:  0,
        r_pct:  totalFacturadoYTD > 0 ? (familiasData[k].neto / totalFacturadoYTD) * 100 : 0,
        d_pp:   0,
        m_real: 43.5,
        m_pre:  43.5,
        m_d:    0,
        _orden: familiasData[k].neto
      }))
      .sort((a,b) => b._orden - a._orden);

    Object.keys(vendedorStats).forEach(k => {
      const s = vendedorStats[k];
      s.facturadoYTD = s.facturado / 1000000;
      s.facturado    = (s.facturadoMTD || 0) / 1000000;
      delete s.facturadoMTD;
    });

    // 9. KPIs
    const NOMBRES_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                         'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    const familiasMontoYTD = Object.keys(familiasData)
      .map(k => ({
        fam:          k,
        monto:        familiasData[k].neto / 1000000,
        cto:          familiasData[k].cto  / 1000000,
        margen:       familiasData[k].neto > 0
                        ? ((familiasData[k].neto - familiasData[k].cto) / familiasData[k].neto * 100)
                        : 0,
        margenPresup: getMargenPresup(k)
      }))
      .filter(f => f.monto > 0)
      .sort((a,b) => b.monto - a.monto);

    const kpis = {
      facturadoMTD:     facturadoMTD,
      cotizadoMTD:      cotizadoMTD,
      nvEmitidasMTD:    nvEmitidasMTD,
      nvEmitidasYTD:    nvEmitidasYTD,
      nvPendientesYTD:  porFacturar,
      porFacturar:      porFacturar,
      presupuestoMes:   PRESUPUESTO_MENSUAL[currentMonth],
      presupuestoArray: PRESUPUESTO_MENSUAL,
      mesActual:        NOMBRES_MES[currentMonth],
      fechaHoy:         String(currentDay).padStart(2,'0') + '/' + String(currentMonth+1).padStart(2,'0') + '/' + currentYear
    };

    return JSON.parse(JSON.stringify({
      pipeline:  pipelineData,
      manager:   managerStats,
      kpis:      kpis,
      equipo:        vendedorStats,
      diarias: {
        movimientosHoy:    movimientosHoy.slice(0, 50),
        sinMovimiento:     sinMovimiento.slice(0, 30),
        cierresPendientes: cierresPendientes.slice(0, 20),
      },
      flow7d: {
        cotizaciones: { total: cot7dTotal * 1000000, n: cot7dN },
        nv:           { total: nv7dTotal  * 1000000, n: nv7dN  },
        facturacion:  { total: (managerStats._fact7dTotal || 0), n: (managerStats._fact7dN || 0) },
      },
      graficoDiario:    graficoDiarioData,
      graficoDiarioNV:  graficoDiarioNV,
      SEMANAS:          semanasDelMes,
      topClientes:      topClientes,
      mixFamilias:      mixFamilias,
      familiasMontoYTD: familiasMontoYTD,
    }));

  } catch(e) {
    Logger.log('buildDashboardPayload ERROR: ' + e.toString() + ' | Stack: ' + e.stack);
    return { error: e.toString() };
  }
}

// ======================================================================
// SYNC + TRIGGER
// ======================================================================
function syncAll() {
  const t0 = Date.now();
  try { syncPipelines();        Logger.log('✓ Pipelines');       } catch(e) { Logger.log('✗ Pipelines: '       + e.message); }
  try { syncOpportunities();    Logger.log('✓ Opportunities');   } catch(e) { Logger.log('✗ Opportunities: '   + e.message); }
  try { syncContacts();         Logger.log('✓ Contacts');        } catch(e) { Logger.log('✗ Contacts: '        + e.message); }
  try { buildPipelineSummary(); Logger.log('✓ PipelineSummary'); } catch(e) { Logger.log('✗ PipelineSummary: ' + e.message); }
  Logger.log('Sync completo en ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
}

function setup() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  UrlFetchApp.fetch('https://services.leadconnectorhq.com', { muteHttpExceptions: true });
  Logger.log('Autorización completa.');
}

function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAll').timeBased().everyHours(1).create();
  Logger.log('Trigger horario instalado.');
}

function testDebug() {
  const payload = buildDashboardPayload();
  Logger.log('facturadoMTD:        ' + payload.kpis.facturadoMTD);
  Logger.log('cotizadoMTD:         ' + payload.kpis.cotizadoMTD);
  Logger.log('nvEmitidasMTD:       ' + payload.kpis.nvEmitidasMTD);
}