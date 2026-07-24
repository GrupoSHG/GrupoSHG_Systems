/* ---------------------------------------------------------
   Estado de la app (en memoria, no persiste entre sesiones)
--------------------------------------------------------- */
let state = {
  mode: 'demo',           // 'demo' | 'live'
  tipoActivo: 'compra',   // 'compra' | 'venta'
  documentos: { compra: [], venta: [] },
  seleccionados: new Set(),
  cargando: false,
};

/* ---------------------------------------------------------
   Generador de datos de ejemplo (modo Demo)
--------------------------------------------------------- */
function generarDemo(periodo){
  const tiposDoc = ['Factura Electr\u00f3nica','Nota de Cr\u00e9dito','Nota de D\u00e9bito','Factura Exenta'];
  const empresas = [
    'Aceros del Pac\u00edfico Ltda.','Comercial Rioblanco SpA','Distribuidora Andes S.A.',
    'Poliuretanos del Sur Ltda.','Transportes Cordillera SpA','Insumos Industriales Maule',
    'Metalmec\u00e1nica Bio Bio S.A.','Constructora Los Alerces Ltda.'
  ];
  const estados = ['pendiente','aceptado','reclamado'];
  const out = { compra: [], venta: [] };
  ['compra','venta'].forEach(tipo=>{
    const n = 9 + Math.floor(Math.random()*6);
    for(let i=0;i<n;i++){
      const neto = Math.round((80000 + Math.random()*1800000)/10)*10;
      const iva = Math.round(neto*0.19);
      out[tipo].push({
        id: tipo+'-'+i,
        origen: tipo,
        subido: false,
        folio: 100000 + Math.floor(Math.random()*899999),
        tipoDoc: tiposDoc[Math.floor(Math.random()*tiposDoc.length)],
        rut: (Math.floor(Math.random()*90000000)+9000000)+'-'+Math.floor(Math.random()*9),
        razonSocial: empresas[Math.floor(Math.random()*empresas.length)],
        fecha: periodo+'-'+String(1+Math.floor(Math.random()*27)).padStart(2,'0'),
        neto, iva, total: neto+iva,
        estado: estados[Math.floor(Math.random()*estados.length)]
      });
    }
  });
  return out;
}

/* ---------------------------------------------------------
   Llamada real a SimpleAPI (modo API real)
   Ver notas de integraci\u00f3n al final del archivo / respuesta.
--------------------------------------------------------- */
async function consultarSimpleAPI({apikey, rut, clave, periodo}){
  // 1) Obtener Bearer Token
  const tokenResp = await fetch('https://api.simpleapi.cl/auth/token', {
    method:'POST',
    headers:{ 'Authorization': apikey, 'Content-Type':'application/json' }
  });
  if(!tokenResp.ok) throw new Error('No se pudo obtener el Bearer Token ('+tokenResp.status+')');
  const { token } = await tokenResp.json();

  // 2) Consultar RCV (compras y ventas) - confirmar path exacto en la colecci\u00f3n Postman de SimpleAPI
  async function pedir(tipo){
    const resp = await fetch('https://api.simpleapi.cl/rcv/'+tipo, {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
      body: JSON.stringify({ rut, clave, periodo })
    });
    if(!resp.ok) throw new Error('Error consultando '+tipo+' ('+resp.status+')');
    return resp.json();
  }
  const [compra, venta] = await Promise.all([pedir('compra'), pedir('venta')]);
  return { compra, venta };
}

/* ---------------------------------------------------------
   Render
--------------------------------------------------------- */
function fmt(n){ return '$'+n.toLocaleString('es-CL'); }

function docsVista(){
  if(state.tipoActivo === 'subidas'){
    return [...state.documentos.compra, ...state.documentos.venta].filter(d=>d.subido);
  }
  return (state.documentos[state.tipoActivo] || []).filter(d=>!d.subido);
}

function renderSummary(){
  const docs = docsVista();
  const neto = docs.reduce((a,d)=>a+d.neto,0);
  const iva = docs.reduce((a,d)=>a+d.iva,0);
  const total = docs.reduce((a,d)=>a+d.total,0);
  document.getElementById('summary').innerHTML = `
    <div class="card"><div class="label">Documentos</div><div class="value">${docs.length}</div></div>
    <div class="card"><div class="label">Monto neto</div><div class="value">${fmt(neto)}</div></div>
    <div class="card azul"><div class="label">IVA</div><div class="value">${fmt(iva)}</div></div>
    <div class="card celeste"><div class="label">Total</div><div class="value">${fmt(total)}</div></div>
  `;
}

function renderTable(){
  const docs = docsVista();
  const esSubidas = state.tipoActivo === 'subidas';
  const wrap = document.getElementById('table-wrap');
  if(!docs.length){
    const vacioTexto = esSubidas
      ? 'A\u00fan no hay facturas cargadas a Manager. Las que subas desde Compras o Ventas aparecer\u00e1n aqu\u00ed.'
      : `A\u00fan no hay ${state.tipoActivo === 'compra' ? 'facturas de compra' : 'facturas de venta'} pendientes. Ingresa el per\u00edodo y presiona <strong>Consultar RCV</strong>.`;
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="glyph">&sect;</div>
        <p>${vacioTexto}</p>
      </div>`;
    return;
  }
  const rows = docs.map(d => `
    <tr>
      ${esSubidas ? '' : `<td class="checkbox-cell"><input type="checkbox" data-id="${d.id}" ${state.seleccionados.has(d.id)?'checked':''}></td>`}
      ${esSubidas ? `<td><span class="tipo-badge ${d.origen}">${d.origen === 'compra' ? 'Compra' : 'Venta'}</span></td>` : ''}
      <td class="mono">${d.folio}</td>
      <td>${d.tipoDoc}</td>
      <td class="mono">${d.rut}</td>
      <td>${d.razonSocial}</td>
      <td class="mono">${d.fecha}</td>
      <td class="num">${fmt(d.neto)}</td>
      <td class="num">${fmt(d.iva)}</td>
      <td class="num">${fmt(d.total)}</td>
      <td><span class="stamp ${d.estado}">${d.estado}</span></td>
    </tr>
  `).join('');
  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          ${esSubidas ? '<th>Tipo</th>' : '<th></th>'}
          <th>Folio</th><th>Tipo Doc.</th><th>RUT</th><th>Raz&oacute;n social</th>
          <th>Fecha</th><th>Neto</th><th>IVA</th><th>Total</th><th>Estado</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const id = e.target.dataset.id;
      if(e.target.checked) state.seleccionados.add(id);
      else state.seleccionados.delete(id);
      renderActionBar();
    });
  });
}

function renderActionBar(){
  const slot = document.getElementById('action-bar-slot');
  if(state.tipoActivo === 'subidas'){ slot.innerHTML=''; return; }
  const docs = docsVista();
  const sel = docs.filter(d=>state.seleccionados.has(d.id));
  if(!sel.length){ slot.innerHTML=''; return; }
  const total = sel.reduce((a,d)=>a+d.total,0);
  const etiquetaModulo = state.tipoActivo === 'compra' ? 'Facturas de Compra' : 'Facturas de Venta';
  slot.innerHTML = `
    <div class="action-bar">
      <div class="sel-info"><b>${sel.length}</b> seleccionados <span class="amounts">&middot; ${fmt(total)}</span></div>
      <div class="action-bar-btns">
        <button class="btn secondary" id="btn-limpiar">Limpiar selecci\u00f3n</button>
        <button class="btn" id="btn-enviar">Cargar ${etiquetaModulo} a Manager</button>
      </div>
    </div>
  `;
  document.getElementById('btn-limpiar').addEventListener('click', ()=>{
    state.seleccionados.clear(); renderTable(); renderActionBar();
  });
  document.getElementById('btn-enviar').addEventListener('click', ()=>cargarAManager(sel));
}

/* ---------------------------------------------------------
   Carga a Manager (api2) - un mapeo por componente
   Confirmar el path exacto (purchase-invoice-form / sales-invoice-form)
   y los campos disponibles en tu instancia (son autodocumentados).
--------------------------------------------------------- */
function mapDocARFormularioManager(doc, tipo){
  const base = {
    issueDate: doc.fecha,
    reference: String(doc.folio),
    description: doc.tipoDoc,
    Lines: [{
      lineDescription: doc.tipoDoc + ' ' + doc.folio,
      UnitPrice: { value: doc.neto, currency: '' },
      qty: 1
    }]
  };
  return tipo === 'compra'
    ? { ...base, supplier: doc.razonSocial }
    : { ...base, customer: doc.razonSocial };
}

async function cargarAManager(documentos){
  const statusEl = document.getElementById('mp-status');

  if(state.mode === 'demo'){
    await new Promise(r=>setTimeout(r, 400));
    documentos.forEach(d=>{ d.subido = true; state.seleccionados.delete(d.id); });
    statusEl.textContent = 'simulado (demo)';
    statusEl.classList.remove('ok');
    mostrarToast(`Manager (demo): ${documentos.length} documento(s) marcados como subidos.`);
    renderSummary(); renderTable(); renderActionBar();
    return;
  }

  const domain = document.getElementById('m-domain').value.trim().replace(/\/$/,'');
  const businessId = document.getElementById('m-business').value.trim();
  const apikey = document.getElementById('m-apikey').value.trim();

  if(!domain || !businessId || !apikey){
    mostrarToast('Completa URL del servidor, Business ID y API Key de Manager.');
    return;
  }
  const formPath = state.tipoActivo === 'compra' ? 'purchase-invoice-form' : 'sales-invoice-form';
  const url = `${domain}/api2/${businessId}/${formPath}`;

  let ok = 0, fallidos = 0;
  for(const doc of documentos){
    try{
      const resp = await fetch(url, {
        method:'POST',
        headers:{ 'X-Api-Key': apikey, 'Content-Type':'application/json' },
        body: JSON.stringify(mapDocARFormularioManager(doc, state.tipoActivo))
      });
      if(resp.ok){ ok++; doc.subido = true; } else fallidos++;
    } catch(err){ fallidos++; }
  }
  statusEl.textContent = fallidos === 0 ? 'conectado' : `${ok} ok / ${fallidos} error`;
  statusEl.classList.toggle('ok', fallidos === 0);
  mostrarToast(`Manager: ${ok} documento(s) cargados, ${fallidos} con error.`);
  if(ok){
    documentos.forEach(d=>{ if(d.subido) state.seleccionados.delete(d.id); });
    renderSummary(); renderTable(); renderActionBar();
  }
}

function mostrarToast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3600);
}

function renderAll(){ renderSummary(); renderTable(); renderActionBar(); }

/* ---------------------------------------------------------
   Eventos
--------------------------------------------------------- */
const MODULOS = {
  compra: {
    titulo: 'Facturas de Compra',
    subtitulo: 'Documentos recibidos de proveedores, seg\u00fan el Registro de Compras y Ventas del SII.'
  },
  venta: {
    titulo: 'Facturas de Venta',
    subtitulo: 'Documentos emitidos a clientes, seg\u00fan el Registro de Compras y Ventas del SII.'
  },
  subidas: {
    titulo: 'Facturas Subidas',
    subtitulo: 'Documentos de compra y venta ya cargados a Manager.'
  }
};

document.querySelectorAll('.navitem').forEach(item=>{
  item.addEventListener('click', ()=>{
    document.querySelectorAll('.navitem').forEach(i=>i.classList.remove('active'));
    item.classList.add('active');
    state.tipoActivo = item.dataset.tipo;
    const m = MODULOS[state.tipoActivo];
    document.getElementById('titulo').textContent = m.titulo;
    document.getElementById('subtitulo').textContent = m.subtitulo;
    state.seleccionados.clear();
    const esSubidas = state.tipoActivo === 'subidas';
    document.querySelector('.config').style.display = esSubidas ? 'none' : 'flex';
    document.getElementById('notice').style.display = esSubidas ? 'none' : 'block';
    document.querySelector('.manager-panel').style.display = esSubidas ? 'none' : 'block';
    renderAll();
  });
});

document.getElementById('mode-demo').addEventListener('click', ()=>{
  state.mode='demo';
  document.getElementById('mode-demo').classList.add('active');
  document.getElementById('mode-live').classList.remove('active');
  document.getElementById('notice').innerHTML = '<strong>Modo Demo activo.</strong> Se muestran datos de ejemplo para revisar el dise\u00f1o y el flujo. Cambia a <strong>API real</strong> e ingresa tu ApiKey, RUT y Clave SII para traer datos reales \u2014 ver notas de integraci\u00f3n al final de esta p\u00e1gina.';
});
document.getElementById('mode-live').addEventListener('click', ()=>{
  state.mode='live';
  document.getElementById('mode-live').classList.add('active');
  document.getElementById('mode-demo').classList.remove('active');
  document.getElementById('notice').innerHTML = '<strong>Modo API real.</strong> Esta llamada se hace directo desde el navegador. Si tu navegador bloquea la petici\u00f3n por CORS, necesitar\u00e1s un peque\u00f1o backend intermedio (ver notas de integraci\u00f3n al final).';
});

document.getElementById('btn-consultar').addEventListener('click', async ()=>{
  const periodo = document.getElementById('f-periodo').value; // YYYY-MM
  const btn = document.getElementById('btn-consultar');
  btn.disabled = true; btn.textContent = 'Consultando...';
  state.seleccionados.clear();
  try{
    if(state.mode === 'demo'){
      await new Promise(r=>setTimeout(r, 500));
      state.documentos = generarDemo(periodo || '2026-07');
    } else {
      const apikey = document.getElementById('f-apikey').value.trim();
      const rut = document.getElementById('f-rut').value.trim();
      const clave = document.getElementById('f-clave').value;
      if(!apikey || !rut || !clave){ mostrarToast('Completa ApiKey, RUT y Clave SII.'); return; }
      const { compra, venta } = await consultarSimpleAPI({ apikey, rut, clave, periodo });
      state.documentos = { compra: compra.documentos || compra, venta: venta.documentos || venta };
    }
    renderAll();
  } catch(err){
    mostrarToast('Error: '+err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Consultar RCV';
  }
});

/* Render inicial con datos demo */
state.documentos = generarDemo('2026-07');
renderAll();