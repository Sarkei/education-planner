# education-planner

Dateiverwaltung für die Berufsschule im Stil von OneNote: links ein Ordnerbaum, rechts das Dokument
im Office-Editor. Alles liegt als echte Datei auf dem NAS, Änderungen werden automatisch gespeichert.

## Funktionen

- **Ordnerbaum** mit beliebig tiefer Struktur; Dateien und Ordner anlegen, umbenennen, verschieben
  (Drag & Drop im Baum und in der Dateiliste), in den Papierkorb legen und wiederherstellen.
- **Upload** vom Rechner per Knopfdruck oder Drag & Drop, in 8-MB-Teilen — dadurch gehen auch große
  Dateien durch den Cloudflare-Tunnel (100-MB-Grenze pro Request).
- **Office-Editor**: `.docx/.doc/.odt/.rtf`, `.xlsx/.xls/.ods/.csv`, `.pptx/.ppt/.odp` öffnen in
  ONLYOFFICE Docs; Textdateien (`.txt`, `.md`) direkt im Browser mit Strg+S.
- **Automatisches Speichern**: der Dokumentenserver meldet jede Änderung per Callback; der Server
  schreibt atomar, legt eine Version an (die letzten 20 bleiben) und erhöht die Versionsnummer. Ein
  Timer erzwingt alle 60 Sekunden ein Zwischenspeichern, damit ein Browser-Absturz nichts kostet.
- **Gemeinsames Arbeiten**: mehrere Nutzer im selben Dokument sehen sich live (Co-Editing von
  ONLYOFFICE), Freigaben pro Ordner oder Datei mit „ansehen" oder „bearbeiten", vererbt auf alles
  darunter.
- **Download** einzeln oder als ZIP für ganze Ordner.
- Nutzerverwaltung (erster Account wird Administrator), Passwort ändern, Passwort-Reset-Link.

## Technik

Vite + React 19 + Tailwind 4 im Frontend, ein Express-Server, PostgreSQL, ONLYOFFICE Docs
(Community Edition) als separater Container. Die Dateien liegen unter `/data/files` im Container,
im Compose gemountet auf `/volume3/education_planner/files`.

## Endpunkte (Auszug)

- `POST /api/auth/register|login`, `GET /api/auth/me`, `POST /api/auth/password`, `POST /api/auth/forgot|reset`
- `GET /api/auth/users`, `POST /api/auth/users`, `DELETE /api/auth/users/:id` (Administrator)
- `GET /api/nodes/tree`, `POST /api/nodes/folder`, `PATCH /api/nodes/:id`, `DELETE /api/nodes/:id`
- `GET /api/nodes/trash/list`, `POST /api/nodes/:id/restore`, `DELETE /api/nodes/:id/purge`
- `GET /api/nodes/:id/download` (Datei oder ZIP), `GET /api/nodes/:id/versions`
- `POST /api/uploads/init`, `PUT /api/uploads/:id/:index`, `POST /api/uploads/:id/complete`, `PUT /api/uploads/text/:id`
- `GET|POST /api/shares/:id`, `DELETE /api/shares/:id/:userId`, `GET /api/shares` (mit mir geteilt)
- `POST /api/nodes/:id/config` (Editor-Konfiguration), `GET /api/office/file/:id` (für den Dokumentenserver),
  `POST /api/office/callback/:id` (Speichern), `POST /api/office/:id/forcesave`

## Umgebung

| Variable | Bedeutung |
|---|---|
| `POSTGRES_*` | Datenbankverbindung |
| `JWT_SECRET` | Signatur der Anmelde-Token |
| `ONLYOFFICE_URL` | öffentliche Adresse des Dokumentenservers |
| `ONLYOFFICE_JWT_SECRET` | gemeinsames Secret für Editor-Konfiguration und Callback |
| `FILES_ROOT` / `VERSIONS_ROOT` / `TRASH_ROOT` / `TMP_ROOT` | Speicherpfade im Container |
| `INTERNAL_BASE_URL` | Adresse, unter der der Dokumentenserver die Datei abholt |
| `PUBLIC_BASE_URL` | Adresse, unter der der Dokumentenserver den Callback erreicht |
| `ALLOW_DEV_RESET_LINK` | `1` gibt den Reset-Link direkt in der Antwort zurück (ohne SMTP) |

## Start

```bash
cp .env.example .env   # Werte eintragen
docker compose up -d --build
```

App: `http://<nas>:22238` · Dokumentenserver: `http://<nas>:22239`
