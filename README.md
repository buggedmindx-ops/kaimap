# PortMap

A TCP port scanner with a web UI, built for a college cybersecurity mini project.

## What it does
- Connect scan: full TCP handshake on each port (open/closed), like `nmap -sT`
- Service detection: connect scan + reads each open port's banner (e.g. SSH version string)
- Scan a port range or a custom comma-separated port list
- Scan history saved in SQLite

## Run locally
```
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000

## Note on scope
This uses Python's built-in `socket` module for a full TCP connect scan.
A true SYN "stealth" scan (`nmap -sS`) needs raw sockets and admin/root
access, so it isn't included — a deliberate scope decision for a
teaching-sized project.

## Legal/ethical use
Only scan systems you own or have explicit permission to test, e.g.
`scanme.nmap.org` (a host nmap's authors set up for practice), or your own
localhost / TryHackMe / HackTheBox machines.
