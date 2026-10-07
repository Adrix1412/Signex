"""Serve the web app and its shared SQLite workshop. Python 3.11+ stdlib."""
from __future__ import annotations
import argparse
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from community.packages import MAX_BYTES, parse_package

ROOT = Path(__file__).resolve().parent
LOG = logging.getLogger('workshop')

class WorkshopServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address: tuple[str, int], database: Path):
        self.database = database
        self.rate: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(16)
        database.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, password TEXT NOT NULL, salt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS packages(id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
            language TEXT NOT NULL, description TEXT NOT NULL, body TEXT NOT NULL, created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS package_created ON packages(created DESC);
            ''')
        super().__init__(address, Handler)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

class Handler(SimpleHTTPRequestHandler):
    server: WorkshopServer

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'web'), **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, fmt: str, *args: object) -> None:
        LOG.info('%s %s', self.client_address[0], fmt % args)

    def end_headers(self) -> None:
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        super().end_headers()

    def reply(self, status: int, body: object) -> None:
        payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def body(self) -> dict[str, object]:
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= MAX_BYTES or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise ValueError('Envía JSON de hasta 20 MB.')
        raw = json.loads(self.rfile.read(size))
        if not isinstance(raw, dict):
            raise ValueError('Se esperaba un objeto JSON.')
        return raw

    def user(self, db: sqlite3.Connection) -> str | None:
        auth = self.headers.get('Authorization', '')
        token = auth.removeprefix('Bearer ')
        row = db.execute('SELECT user FROM sessions WHERE token=? AND expires>?',
                         (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return row['user'] if row and auth.startswith('Bearer ') else None

    def allowed(self) -> bool:
        now = time.time()
        with self.server.lock:
            for key in list(self.server.rate):
                if not self.server.rate[key] or self.server.rate[key][-1] < now-60:
                    del self.server.rate[key]
            if len(self.server.rate) >= 5000:
                return False
            visits = self.server.rate[self.client_address[0]]
            while visits and visits[0] < now-60:
                visits.popleft()
            if len(visits) >= 12:
                return False
            visits.append(now)
        return True

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if not path.startswith('/api/'):
            if path == '/':
                self.path = '/workshop.html'
            resolved = Path(self.translate_path(self.path)).resolve()
            if not resolved.is_relative_to((ROOT/'web').resolve()) or resolved.is_dir():
                self.send_error(404)
                return
            return super().do_GET()
        try:
            with self.server.connect() as db:
                if path == '/api/packages':
                    from urllib.parse import parse_qs
                    query = parse_qs(urlsplit(self.path).query)
                    offset = max(0, min(int(query.get('offset', ['0'])[0]), 1_000_000))
                    rows = db.execute('SELECT id,owner,name,language,description FROM packages ORDER BY created DESC LIMIT 31 OFFSET ?', (offset,)).fetchall()
                    self.reply(200, {'items': [dict(r) for r in rows[:30]], 'more': len(rows)>30})
                elif path.startswith('/api/packages/'):
                    row = db.execute('SELECT body FROM packages WHERE id=?', (path.rsplit('/',1)[-1],)).fetchone()
                    self.reply(200, json.loads(row['body'])) if row else self.reply(404, {'error':'No encontrado.'})
                else:
                    self.reply(404, {'error':'Ruta no encontrada.'})
        except (ValueError, sqlite3.Error):
            self.reply(400, {'error':'No se pudo consultar el catálogo.'})

    def do_POST(self) -> None:
        if not self.allowed():
            self.reply(429, {'error':'Demasiadas solicitudes. Espera un minuto.'})
            return
        try:
            body = self.body()
            path = urlsplit(self.path).path
            with self.server.connect() as db:
                if path in ('/api/register', '/api/login'):
                    username, password = body.get('username'), body.get('password')
                    if not isinstance(username,str) or not 3 <= len(username) <= 40 or not username.isascii() or not all(c.isalnum() or c in '_-' for c in username):
                        raise ValueError('Usuario: 3–40 letras, números, guion o guion bajo.')
                    if not isinstance(password,str) or not 12 <= len(password) <= 128:
                        raise ValueError('Contraseña: 12–128 caracteres.')
                    username = username.lower()
                    row = db.execute('SELECT * FROM users WHERE id=?',(username,)).fetchone()
                    salt = bytes.fromhex(row['salt']) if row else secrets.token_bytes(16)
                    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600_000).hex()
                    if path == '/api/register':
                        if row:
                            raise ValueError('No se pudo registrar ese usuario.')
                        db.execute('INSERT INTO users VALUES(?,?,?)',(username,digest,salt.hex()))
                    elif not row or not hmac.compare_digest(row['password'],digest):
                        self.reply(401,{'error':'Credenciales inválidas.'})
                        return
                    token = secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<? OR user=?',(time.time(),username))
                    db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),username,time.time()+86400))
                    self.reply(200, {'token':token, 'username':username})
                elif path == '/api/logout':
                    auth = self.headers.get('Authorization', '').removeprefix('Bearer ')
                    db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(auth.encode()).hexdigest(),))
                    self.reply(200, {'logged_out': True})
                elif path == '/api/packages':
                    user = self.user(db)
                    if not user:
                        self.reply(401,{'error':'Inicia sesión para publicar.'})
                        return
                    if body.get('consent') is not True:
                        raise ValueError('Confirma permiso para compartir las muestras.')
                    package = parse_package(body.get('package'))
                    encoded = json.dumps(package.to_dict(), ensure_ascii=False)
                    identity = hashlib.sha256((user+encoded).encode()).hexdigest()
                    if db.execute('SELECT count(*) FROM packages WHERE owner=?',(user,)).fetchone()[0] >= 100:
                        raise ValueError('Máximo 100 paquetes por cuenta.')
                    db.execute('INSERT OR IGNORE INTO packages VALUES(?,?,?,?,?,?,?)',
                               (identity,user,package.name,package.language,package.description,encoded,time.time()))
                    self.reply(201, {'id':identity})
                else:
                    self.reply(404,{'error':'Ruta no encontrada.'})
        except (ValueError, UnicodeError) as exc:
            self.reply(400, {'error':str(exc)})
        except sqlite3.Error:
            LOG.exception('Database operation failed')
            self.reply(503, {'error':'Base de datos ocupada. Intenta de nuevo.'})

    def do_DELETE(self) -> None:
        path = urlsplit(self.path).path
        if not path.startswith('/api/packages/'):
            self.reply(404, {'error':'Ruta no encontrada.'})
            return
        with self.server.connect() as db:
            user = self.user(db)
            if not user:
                self.reply(401, {'error':'Inicia sesión.'})
                return
            result = db.execute('DELETE FROM packages WHERE id=? AND owner=?',(path.rsplit('/',1)[-1],user))
            self.reply(200 if result.rowcount else 404, {'deleted':bool(result.rowcount)})

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default=os.getenv('SIGNEX_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.getenv('PORT', '8000')))
    parser.add_argument('--database', type=Path, default=Path(os.getenv('SIGNEX_DATABASE', str(ROOT/'var/workshop.sqlite3'))))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    server = WorkshopServer((args.host,args.port),args.database)
    print(f'Signex listo en puerto {server.server_port}. Ctrl+C para salir.',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
