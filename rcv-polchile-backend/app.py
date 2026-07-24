"""
Backend RCV Polchile
---------------------
Guarda TODAS las credenciales (certificado .pfx, password del certificado,
ApiKey de SimpleAPI, credenciales de Manager) en variables de entorno,
leidas desde un archivo .env que NUNCA se sube a git.

El frontend (carpeta static/) no maneja ningun secreto: solo pide un
periodo y recibe el resultado ya consultado. La carga a Manager tambien
pasa por aqui, para que el ApiKey de Manager tampoco viaje al navegador.
"""
import os
import json
import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()  # lee el archivo .env (no versionado)

app = Flask(__name__, static_folder="areafinanzas", static_url_path="")
CORS(app)  # en producción, restringe origins= a tu dominio real

# ---------------------------------------------------------------
# Credenciales (solo existen en memoria del servidor, nunca en el navegador)
# ---------------------------------------------------------------
SIMPLEAPI_KEY     = os.environ.get("SIMPLEAPI_KEY")
RUT_CERTIFICADO   = os.environ.get("RUT_CERTIFICADO")
RUT_EMPRESA       = os.environ.get("RUT_EMPRESA")
PASSWORD_CERT     = os.environ.get("PASSWORD_CERT")
AMBIENTE          = os.environ.get("AMBIENTE", "1")  # 1=produccion, 0=certificacion
PFX_PATH          = os.environ.get("PFX_PATH")       # ej. ./secrets/certificado.pfx

MANAGER_DOMAIN      = os.environ.get("MANAGER_DOMAIN")
MANAGER_BUSINESS_ID = os.environ.get("MANAGER_BUSINESS_ID")
MANAGER_APIKEY      = os.environ.get("MANAGER_APIKEY")

SIMPLEAPI_HOST = "https://servicios.simpleapi.cl"

REQUIRED_VARS = [
    "SIMPLEAPI_KEY", "RUT_CERTIFICADO", "RUT_EMPRESA", "PASSWORD_CERT", "PFX_PATH",
]


def validar_config():
    faltantes = [v for v in REQUIRED_VARS if not os.environ.get(v)]
    if faltantes:
        raise RuntimeError(
            "Faltan variables de entorno en .env: " + ", ".join(faltantes)
        )
    if not os.path.isfile(PFX_PATH):
        raise RuntimeError(f"No se encuentra el certificado .pfx en: {PFX_PATH}")


# ---------------------------------------------------------------
# SimpleAPI - Registro de Compras y Ventas (RCV)
# ---------------------------------------------------------------
def consultar_rcv(tipo, mes, anio):
    """tipo: 'compras' | 'ventas'. mes/anio: strings, ej '07','2026'."""
    url = f"{SIMPLEAPI_HOST}/api/RCV/{tipo}/{mes}/{anio}"
    payload = {
        "RutCertificado": RUT_CERTIFICADO,
        "RutEmpresa": RUT_EMPRESA,
        "Ambiente": int(AMBIENTE),
        "Password": PASSWORD_CERT,
    }
    with open(PFX_PATH, "rb") as f:
        files = {"files": (os.path.basename(PFX_PATH), f, "application/x-pkcs12")}
        data = {"input": json.dumps(payload)}
        resp = requests.post(
            url,
            headers={"Authorization": SIMPLEAPI_KEY},
            data=data,
            files=files,
            timeout=150,  # el endpoint real demora 40-120s
        )
    resp.raise_for_status()
    return resp.json()


def extraer_documentos(data, tipo):
    """Parseo defensivo: la forma exacta de la respuesta se debe confirmar
    con una llamada real. Ajustar las llaves candidatas segun corresponda."""
    candidatos = [data.get(tipo), data.get("detalle"), data.get("registros"),
                  data.get("documentos"), data.get("data")]
    arr = next((c for c in candidatos if isinstance(c, list)), None)
    if arr is None:
        return []
    origen = "compra" if tipo == "compras" else "venta"
    out = []
    for i, d in enumerate(arr):
        out.append({
            "id": f"{origen}-{i}",
            "origen": origen,
            "subido": False,
            "folio": d.get("folio") or d.get("Folio") or "",
            "tipoDoc": d.get("tipoDte") or d.get("TipoDTE") or d.get("tipoDoc") or "",
            "rut": d.get("rutProveedor") or d.get("rutCliente") or d.get("rut") or "",
            "razonSocial": d.get("razonSocial") or d.get("RazonSocial") or "",
            "fecha": d.get("fechaEmision") or d.get("FchEmis") or "",
            "neto": float(d.get("montoNeto") or d.get("MntNeto") or 0),
            "iva": float(d.get("montoIVA") or d.get("IVA") or 0),
            "total": float(d.get("montoTotal") or d.get("MntTotal") or 0),
            "estado": str(d.get("estado") or d.get("Estado") or "pendiente").lower(),
        })
    return out


@app.route("/api/rcv")
def api_rcv():
    periodo = request.args.get("periodo")  # "YYYY-MM"
    if not periodo or "-" not in periodo:
        return jsonify({"error": "Falta o es inválido el parámetro periodo (YYYY-MM)"}), 400
    anio, mes = periodo.split("-")
    try:
        raw_compras = consultar_rcv("compras", mes, anio)
        raw_ventas = consultar_rcv("ventas", mes, anio)
    except requests.HTTPError as e:
        return jsonify({"error": f"SimpleAPI respondió con error: {e}"}), 502
    except requests.Timeout:
        return jsonify({"error": "SimpleAPI no respondió a tiempo (timeout)"}), 504

    return jsonify({
        "compra": extraer_documentos(raw_compras, "compras"),
        "venta": extraer_documentos(raw_ventas, "ventas"),
    })


# ---------------------------------------------------------------
# Manager ERP (api2) - carga de facturas
# ---------------------------------------------------------------
def mapear_a_manager(doc, tipo):
    base = {
        "issueDate": doc.get("fecha"),
        "reference": str(doc.get("folio")),
        "description": doc.get("tipoDoc"),
        "Lines": [{
            "lineDescription": f"{doc.get('tipoDoc')} {doc.get('folio')}",
            "UnitPrice": {"value": doc.get("neto"), "currency": ""},
            "qty": 1,
        }],
    }
    if tipo == "compra":
        base["supplier"] = doc.get("razonSocial")
    else:
        base["customer"] = doc.get("razonSocial")
    return base


@app.route("/api/manager/upload", methods=["POST"])
def api_manager_upload():
    if not (MANAGER_DOMAIN and MANAGER_BUSINESS_ID and MANAGER_APIKEY):
        return jsonify({"error": "Conexión a Manager no configurada en .env"}), 500

    body = request.get_json(force=True)
    tipo = body.get("tipo")  # 'compra' | 'venta'
    documentos = body.get("documentos", [])
    form_path = "purchase-invoice-form" if tipo == "compra" else "sales-invoice-form"
    url = f"{MANAGER_DOMAIN.rstrip('/')}/api2/{MANAGER_BUSINESS_ID}/{form_path}"

    resultados = []
    for doc in documentos:
        try:
            resp = requests.post(
                url,
                headers={"X-Api-Key": MANAGER_APIKEY, "Content-Type": "application/json"},
                json=mapear_a_manager(doc, tipo),
                timeout=30,
            )
            resultados.append({"id": doc.get("id"), "ok": resp.ok, "status": resp.status_code})
        except requests.RequestException as e:
            resultados.append({"id": doc.get("id"), "ok": False, "error": str(e)})

    return jsonify({"resultados": resultados})


@app.route("/api/manager/status")
def api_manager_status():
    configurado = bool(MANAGER_DOMAIN and MANAGER_BUSINESS_ID and MANAGER_APIKEY)
    return jsonify({"configurado": configurado})


# ---------------------------------------------------------------
# Servir el frontend estático
# ---------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    try:
        validar_config()
    except RuntimeError as e:
        print(f"\n⚠️  Configuración incompleta: {e}")
        print("Copia .env.example a .env y completa tus credenciales.\n")
    app.run(host="127.0.0.1", port=5000, debug=True)
