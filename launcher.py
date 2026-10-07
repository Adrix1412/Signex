"""Start the local web interface without installing ML dependencies."""
from __future__ import annotations
import threading
import webbrowser
from pathlib import Path
from serve import WorkshopServer

def main() -> None:
    root=Path(__file__).resolve().parent
    try:
        server=WorkshopServer(('127.0.0.1',8000),root/'var/workshop.sqlite3')
    except OSError as exc:
        raise SystemExit('El puerto 8000 está ocupado. Cierra la instancia anterior o usa serve.py --port OTRO_PUERTO.') from exc
    url=f'http://127.0.0.1:{server.server_port}/workshop.html'
    print(f'Abre {url}\nCtrl+C para cerrar. Descarga tus paquetes para conservar una copia.',flush=True)
    threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__=='__main__':
    main()
