function getInventarioInsumos() {
  try {
    // Supabase: tablas 'consumos_acero', 'consumos_pol' y
    // 'por_llegar_aceros_proveedor' (esta última, formato largo: una fila
    // por cada combinación acero+proveedor con la cantidad pendiente de
    // ESE proveedor. La lista de proveedores es dinámica — se arma acá
    // según lo que exista en este momento, no está fija en el código).
    const resultado = { acero: [], pol: [] };

    const filasProveedor = supabaseSelect_('por_llegar_aceros_proveedor');
    const porLlegarPorAcero = {};
    const proveedoresSet = {};
    filasProveedor.forEach(function(row) {
      const codigo    = row.codigo_acero || "";
      const proveedor = row.proveedor || "Proveedor sin nombre";
      const cantidad  = parseFloat(row.cantidad_pendiente) || 0;
      if (!codigo || cantidad <= 0) return;
      if (!porLlegarPorAcero[codigo]) porLlegarPorAcero[codigo] = {};
      porLlegarPorAcero[codigo][proveedor] = (porLlegarPorAcero[codigo][proveedor] || 0) + cantidad;
      proveedoresSet[proveedor] = true;
    });
    const proveedoresOrdenados = Object.keys(proveedoresSet).sort();

    const filasAcero = supabaseSelect_('consumos_acero');
    filasAcero.forEach(function(row) {
      if (!row.codigo && !row.descripcion) return;
      const codigo = row.codigo || "";
      resultado.acero.push({
        codigo:       codigo,
        descripcion:  row.descripcion  || "",
        stk_fisico:   parseFloat(row.stk_fisico)   || 0,
        por_entregar: parseFloat(row.por_entregar) || 0,
        disponible:   parseFloat(row.disponible)   || 0,
        por_llegar:   parseFloat(row.por_llegar)   || 0,
        disp_futuro:  parseFloat(row.disp_futuro)  || 0,
        porProveedor: porLlegarPorAcero[codigo] || {},
      });
    });

    const filasPol = supabaseSelect_('consumos_pol');
    filasPol.forEach(function(row) {
      if (!row.codigo && !row.descripcion) return;
      resultado.pol.push({
        codigo:       row.codigo       || "",
        descripcion:  row.descripcion  || "",
        stk_fisico:   parseFloat(row.stk_fisico)   || 0,
        por_entregar: parseFloat(row.por_entregar) || 0,
        disponible:   parseFloat(row.disponible)   || 0,
        por_llegar:   parseFloat(row.por_llegar)   || 0,
        disp_futuro:  parseFloat(row.disp_futuro)  || 0,
      });
    });

    return { acero: resultado.acero, pol: resultado.pol,
             kpiAcero: calcKpi(resultado.acero), kpiPol: calcKpi(resultado.pol),
             proveedoresAcero: proveedoresOrdenados };
  } catch(e) {
    return { error: "Error inventario: " + e.toString() };
  }
}

function calcKpi(rows) {
  return {
    totalItems: rows.length,
    conStock:   rows.filter(r => r.stk_fisico > 0).length,
    sinStock:   rows.filter(r => r.stk_fisico <= 0).length,
    dispNeg:    rows.filter(r => r.disponible < 0).length,
    totalStk:   rows.reduce((a, r) => a + r.stk_fisico,  0),
    totalDisp:  rows.reduce((a, r) => a + r.disponible,   0),
    totalFuturo:rows.reduce((a, r) => a + r.disp_futuro,  0),
  };
}