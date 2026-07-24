# RCV Polchile — Backend

Guarda todas las credenciales sensibles (certificado digital, passwords,
ApiKeys) en el servidor. El frontend (carpeta `areafinanzas/`) nunca las ve.

## Estructura

```
(carpeta del proyecto)/
├── app.py
├── requirements.txt
├── .env.example
├── .gitignore
├── secrets/
│   └── certificado.pfx   ← tu certificado digital va aquí
└── areafinanzas/
    ├── index.html
    ├── app.js
    └── styles.css
```

## Instalación

```bash
python -m venv venv
venv\Scripts\activate        # Windows (PowerShell: venv\Scripts\Activate.ps1)
pip install -r requirements.txt
```

## Configuración

1. Copia `.env.example` a `.env`
2. Completa tus datos reales en `.env`
3. Coloca tu certificado digital en `secrets/certificado.pfx` (o la ruta que definas en `PFX_PATH`)

`secrets/` y `.env` están en `.gitignore` — **nunca se suben a GitHub.**

## Ejecutar

```bash
python app.py
```

Abre `http://127.0.0.1:5000` — ahí se sirve `areafinanzas/index.html`, ya conectado al backend.

## Endpoints

- `GET /api/rcv?periodo=2026-07` → consulta compras y ventas del SII para ese período (demora 40-120s, es scraping real)
- `POST /api/manager/upload` → recibe `{ tipo: "compra"|"venta", documentos: [...] }` y los carga a Manager
- `GET /api/manager/status` → indica si la conexión a Manager está configurada

## Notas

- El parseo de la respuesta de SimpleAPI (`extraer_documentos` en `app.py`) es defensivo porque la documentación pública no mostraba la forma completa del JSON. Si al probar con datos reales no calzan los campos, revisa la respuesta cruda (agrega un `print(raw_compras)` temporal) y ajusta las llaves.
- El path exacto y los campos de Manager (`purchase-invoice-form` / `sales-invoice-form`) también conviene confirmarlos contra tu instancia real.
