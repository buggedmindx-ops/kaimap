import os
import socket
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DB_FILE = "scans.db"
MAX_PORTS_PER_SCAN = 1024
MAX_THREADS = 100

ALLOWLIST_ONLY = os.environ.get("ALLOWLIST_ONLY", "0") == "1"
ALLOWED_TARGETS = {"scanme.nmap.org", "testphp.vulnweb.com"}


def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS scans (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   target TEXT, ip TEXT, scan_type TEXT,
                   ports_label TEXT,
                   open_count INTEGER, seconds REAL,
                   scanned_at TEXT
               )"""
        )


def grab_banner(host, port, timeout):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))
            try:
                data = sock.recv(80)
                text = data.decode(errors="ignore").strip()
                return text if text else ""
            except socket.timeout:
                return ""
    except OSError:
        return ""


def check_port(host, port, timeout, detect_service):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        is_open = sock.connect_ex((host, port)) == 0
    except OSError:
        is_open = False
    finally:
        sock.close()

    if not is_open:
        return {"port": port, "open": False}

    name = service_name(port)
    banner = grab_banner(host, port, timeout) if detect_service else ""
    return {"port": port, "open": True, "service": name, "banner": banner}


def service_name(port):
    try:
        return socket.getservbyport(port, "tcp")
    except OSError:
        return "unknown"


def parse_ports(mode, start, end, custom_list):
    if mode == "custom":
        ports = set()
        for chunk in custom_list.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if not chunk.isdigit():
                raise ValueError(f"'{chunk}' is not a valid port number.")
            p = int(chunk)
            if not (1 <= p <= 65535):
                raise ValueError(f"Port {p} is out of range (1-65535).")
            ports.add(p)
        if not ports:
            raise ValueError("Enter at least one port, e.g. 22,80,443.")
        return sorted(ports)

    if not (1 <= start <= end <= 65535):
        raise ValueError("Ports must be between 1 and 65535, and start must not exceed end.")
    return list(range(start, end + 1))


def scan(host, ports, timeout, detect_service):
    with ThreadPoolExecutor(max_workers=MAX_THREADS) as pool:
        results = list(pool.map(lambda p: check_port(host, p, timeout, detect_service), ports))
    return [r for r in results if r["open"]]


@app.route("/")
def home():
    return render_template("index.html", allowlist_only=ALLOWLIST_ONLY,
                            allowed_targets=sorted(ALLOWED_TARGETS))


@app.route("/api/scan", methods=["POST"])
def api_scan():
    data = request.get_json(silent=True) or {}

    target = str(data.get("target", "")).strip()
    port_mode = data.get("port_mode", "range")
    scan_type = data.get("scan_type", "connect")
    custom_list = str(data.get("custom_ports", ""))

    try:
        start = int(data.get("start", 1))
        end = int(data.get("end", 100))
        timeout = float(data.get("timeout", 0.5))
    except (TypeError, ValueError):
        return jsonify(error="Ports and timeout must be numbers."), 400

    if not target:
        return jsonify(error="Enter a target, e.g. scanme.nmap.org or 127.0.0.1."), 400
    if not (0.1 <= timeout <= 5):
        return jsonify(error="Timeout must be between 0.1 and 5 seconds."), 400
    if scan_type not in ("connect", "service"):
        return jsonify(error="Unknown scan type."), 400

    if ALLOWLIST_ONLY and target.lower() not in ALLOWED_TARGETS:
        allowed = ", ".join(sorted(ALLOWED_TARGETS))
        return jsonify(error=f"This public demo only scans: {allowed}."), 403

    try:
        ports = parse_ports(port_mode, start, end, custom_list)
    except ValueError as e:
        return jsonify(error=str(e)), 400

    if len(ports) > MAX_PORTS_PER_SCAN:
        return jsonify(error=f"Scan at most {MAX_PORTS_PER_SCAN} ports at a time."), 400

    try:
        ip = socket.gethostbyname(target)
    except socket.gaierror:
        return jsonify(error=f"Could not find '{target}'. Check the spelling."), 400

    began = time.time()
    open_ports = scan(ip, ports, timeout, detect_service=(scan_type == "service"))
    seconds = round(time.time() - began, 2)

    ports_label = (f"{min(ports)}-{max(ports)}" if port_mode == "range"
                   else f"{len(ports)} custom port(s)")

    with get_db() as db:
        db.execute(
            "INSERT INTO scans (target, ip, scan_type, ports_label, open_count, seconds, scanned_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (target, ip, scan_type, ports_label, len(open_ports), seconds,
             datetime.now().strftime("%d %b %Y, %H:%M")),
        )

    return jsonify(
        target=target, ip=ip, scan_type=scan_type,
        start=min(ports), end=max(ports), total_checked=len(ports),
        seconds=seconds, open_ports=open_ports,
    )


@app.route("/api/history")
def api_history():
    with get_db() as db:
        rows = db.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 8").fetchall()
    return jsonify([dict(r) for r in rows])


if __name__ == "__main__":
    init_db()
    debug_mode = os.environ.get("FLASK_DEBUG", "1") == "1"
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
else:
    init_db()
