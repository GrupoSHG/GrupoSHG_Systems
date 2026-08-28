import { supabase } from "./supabaseClient";

// Todas las tablas de esta app viven en el esquema app_cys del proyecto
// Supabase compartido (ffxopvzxyeacpbtxuagu) — no en "public".
const db = supabase.schema("app_cys");

export async function fetchCentros() {
  const { data, error } = await db
    .from("centros_costo")
    .select("*")
    .eq("activo", true)
    .order("codigo");
  if (error) throw error;
  return data;
}

export async function agregarCentroCosto({ codigo, nombre, facturaA, presupuestoMensual }) {
  const { data, error } = await db
    .from("centros_costo")
    .insert({
      codigo,
      nombre,
      factura_a: facturaA || null,
      presupuesto_mensual: presupuestoMensual || null,
      activo: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPersonas() {
  const { data, error } = await db
    .from("personas")
    .select("*")
    .eq("activo", true)
    .order("nombre");
  if (error) throw error;
  return data;
}

export async function agregarPersona({ nombre, cargo, tarifaDiaria }) {
  const { data, error } = await db
    .from("personas")
    .insert({ nombre, cargo, tarifa_diaria: tarifaDiaria, activo: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchIniciativas(centroCostoId) {
  const { data, error } = await db
    .from("iniciativas")
    .select("*")
    .eq("centro_costo_id", centroCostoId);
  if (error) throw error;
  return data;
}

export async function fetchAsistenciaDelDia(centroCostoId, fecha) {
  const { data, error } = await db
    .from("asistencia")
    .select("*")
    .eq("centro_costo_id", centroCostoId)
    .eq("fecha", fecha);
  if (error) throw error;
  return data;
}

export async function marcarAsistencia(centroCostoId, personaId, fecha, presente) {
  const { error } = await db.from("asistencia").upsert(
    {
      centro_costo_id: centroCostoId,
      persona_id: personaId,
      fecha,
      presente,
    },
    { onConflict: "centro_costo_id,persona_id,fecha" }
  );
  if (error) throw error;
}

export async function fetchGastosDelDia(centroCostoId, fecha) {
  const { data, error } = await db
    .from("gastos")
    .select("*")
    .eq("centro_costo_id", centroCostoId)
    .eq("fecha", fecha)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function agregarGasto({ centroCostoId, fecha, descripcion, monto, categoria, facturaId }) {
  const { error } = await db.from("gastos").insert({
    centro_costo_id: centroCostoId,
    fecha,
    descripcion,
    monto,
    categoria,
    factura_id: facturaId ?? null,
  });
  if (error) throw error;
}

// Sube la foto a Storage y crea el registro de factura en estado 'pendiente'.
// El OCR (Google Cloud Vision) se llama desde una Edge Function de Supabase
export async function subirFactura(centroCostoId, file) {
  const path = `facturas/${centroCostoId}/${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabase.storage.from("facturas").upload(path, file);
  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage.from("facturas").getPublicUrl(path);

  const { data, error } = await db
    .from("facturas")
    .insert({
      centro_costo_id: centroCostoId,
      foto_url: publicUrl.publicUrl,
      estado_ocr: "confirmada", // ya no se procesa con OCR, queda guardada directamente
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchFacturasCentro(centroCostoId, soloHoy = true) {
  let query = db
    .from("facturas")
    .select("*")
    .eq("centro_costo_id", centroCostoId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (soloHoy) {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    query = query.gte("created_at", inicio.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchFacturaPorId(id) {
  const { data, error } = await db.from("facturas").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function fetchFacturacion(centroCostoId) {
  const { data, error } = await db
    .from("facturacion")
    .select("*")
    .eq("centro_costo_id", centroCostoId)
    .order("periodo_inicio", { ascending: false });
  if (error) throw error;
  return data;
}

// ---- Dashboard general (todos los centros de costo) ----

export async function fetchResumenGeneral() {
  const [{ data: centros, error: e1 }, { data: fact, error: e2 }, { data: gastos, error: e3 }] = await Promise.all([
    db.from("centros_costo").select("*").eq("activo", true).order("nombre"),
    db.from("facturacion").select("*"),
    db.from("gastos").select("centro_costo_id, monto, fecha, categoria"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  return { centros, facturacion: fact, gastos };
}

export async function eliminarFactura(id, fotoUrl) {
  // Borra el archivo de Storage también, usando la ruta dentro del bucket
  if (fotoUrl) {
    const path = fotoUrl.split("/storage/v1/object/public/facturas/")[1];
    if (path) {
      await supabase.storage.from("facturas").remove([path]);
    }
  }
  const { error } = await db.from("facturas").delete().eq("id", id);
  if (error) throw error;
}
export async function fetchDetalleAsistenciaCentro(centroCostoId) {
  // 1. Traemos a todas las personas para poder cruzar los nombres
  const { data: personasData, error: errPersonas } = await db
    .from("personas")
    .select("id, nombre");

  if (errPersonas) throw errPersonas;

  // Creamos un diccionario para buscar rápido el nombre por ID
  const personasMap = {};
  if (personasData) {
    personasData.forEach(p => {
      personasMap[p.id] = p.nombre;
    });
  }

  // 2. Traemos la asistencia de este centro sin pedirle el JOIN a Supabase
  const { data: asistenciaData, error: errAsistencia } = await db
    .from("asistencia")
    .select("fecha, persona_id")
    .eq("centro_costo_id", centroCostoId)
    .eq("presente", true)
    .order("fecha", { ascending: false });

  if (errAsistencia) throw errAsistencia;

  // 3. Agrupamos por fecha y cruzamos el nombre en memoria
  const agrupado = asistenciaData.reduce((acc, row) => {
    const fecha = row.fecha;
    const nombrePersona = personasMap[row.persona_id] || 'Trabajador desconocido';
    
    if (!acc[fecha]) acc[fecha] = [];
    acc[fecha].push(nombrePersona);
    return acc;
  }, {});

  // 4. Convertimos el objeto en un arreglo para que React lo pueda renderizar
  return Object.keys(agrupado).map((fecha) => ({
    fecha,
    trabajadores: agrupado[fecha],
  }));
}
export async function fetchAsistenciaPorPersona() {
  // 1. Traemos a todas las personas activas
  const { data: personasData, error: errPersonas } = await db
    .from("personas")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");
    
  if (errPersonas) throw errPersonas;

  // 2. Traemos todos los centros de costo para cruzar los nombres
  const { data: centrosData, error: errCentros } = await db
    .from("centros_costo")
    .select("id, nombre");
    
  if (errCentros) throw errCentros;

  // Creamos un diccionario (mapa) para buscar rápido el nombre del centro por su ID
  const centrosMap = {};
  if (centrosData) {
    centrosData.forEach(c => {
      centrosMap[c.id] = c.nombre;
    });
  }

  // 3. Traemos la asistencia (esta vez sin pedir que Supabase haga el cruce con centros_costo)
  const { data: asistenciaData, error: errAsistencia } = await db
    .from("asistencia")
    .select("persona_id, centro_costo_id")
    .eq("presente", true);
    
  if (errAsistencia) throw errAsistencia;

  // 4. Agrupamos y contamos cruzando los datos en memoria
  const resultado = personasData.map((persona) => {
    // Filtramos solo la asistencia de esta persona en específico
    const susAsistencias = asistenciaData.filter(a => a.persona_id === persona.id);
    
    // Contamos por proyecto/centro
    const conteoPorCentro = {};
    susAsistencias.forEach(a => {
      // Usamos el ID para buscar el nombre en nuestro diccionario
      const nombreCentro = centrosMap[a.centro_costo_id] || 'Desconocido';
      if (!conteoPorCentro[nombreCentro]) conteoPorCentro[nombreCentro] = 0;
      conteoPorCentro[nombreCentro]++;
    });

    // Convertimos el objeto en un array para que React lo pueda renderizar
    const centrosFormateados = Object.keys(conteoPorCentro).map(nombre => ({
      centro: nombre,
      dias: conteoPorCentro[nombre]
    }));

    return {
      personaId: persona.id,
      nombre: persona.nombre,
      totalDias: susAsistencias.length,
      centros: centrosFormateados
    };
  });

  return resultado;
}