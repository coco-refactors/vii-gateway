H# Vii Gateway

A Node.js API gateway for integrating **Canvas LMS** with **VAuLT (Virtual/Augmented Learning Tool)** using LTI 1.3.

This gateway is being developed by BCIT Group 6 as part of the COMP 4800 project in collaboration with CoCo Refactoring Agency.

## Project Overview

The API gateway acts as an intermediary between Canvas LMS and the existing VAuLT backend.

The intended integration will allow instructors to assign VAuLT quests through Canvas, students to access those quests using the VAuLT iOS application, and completed quest results to be reported back to the Canvas gradebook.

### Planned Integration

1. Canvas launches the gateway using LTI 1.3.
2. The gateway authenticates the Canvas user and identifies the assigned quest.
3. A QR code is displayed within a Canvas iframe.
4. Students scan the QR code using the VAuLT iOS application.
5. Quest completion results are sent back to Canvas through the gateway.

## Technology Stack

- **Node.js** — Gateway runtime
- **Express.js** — Web server and API routing
- **HTML/JavaScript** — Embedded frontend
- **Cloudflare Tunnel** — Temporary HTTPS access for development
- **Canvas LMS** — Learning management platform
- **VAuLT** — Existing PHP backend and iOS application (future integration)

## Current Implementation

**Milestone 1: Gateway Hello World — Completed**

- Initialized the Node.js/Express gateway.
- Configured a basic HTTP server.
- Implemented a `/health` endpoint.
- Served a static HTML page.
- Exposed the local gateway through Cloudflare Tunnel.
- Successfully displayed the gateway webpage inside the Canvas LMS test instance.

**Not yet implemented:**
- LTI 1.3 authentication
- Canvas user identity verification
- VAuLT backend communication
- Quest assignment mapping
- QR code generation and handoff
- Canvas grade passback

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm
- Git
- Cloudflare Tunnel (`cloudflared`) for Canvas iframe testing

### 1. Clone the Repository

```bash
git clone <repository-url>
cd vii-gateway
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Development Server

```bash
npm run dev
```

Expected output:

```text
Gateway running on port 3000
```

The server will run at:

http://localhost:3000

### 4. Test the Gateway

Open the following URLs:

| Endpoint | Description |
|---|---|
| `GET /` | Displays the Gateway Hello World webpage |
| `GET /health` | Returns gateway health status |

Expected health response:

```json
{
  "status": "ok",
  "message": "VAuLT Gateway is running!"
}
```

## Testing with Canvas LMS

The gateway currently runs locally. To make it accessible through the Canvas test instance, we use Cloudflare Quick Tunnel.

### 1. Start the Gateway

```bash
npm run dev
```

### 2. Start Cloudflare Tunnel

Open a second terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare generates a temporary public HTTPS URL:

```text
https://<generated-name>.trycloudflare.com
```

Open the generated URL in a browser to verify the gateway is accessible.

### 3. Embed the Gateway in Canvas

1. Log into the CoCo Canvas test instance.
2. Open **Course 1 — VAuLT Integration Sandbox**.
3. Navigate to **Pages** and create a new page.
4. Switch to the HTML editor.
5. Insert the following code, replacing the placeholder URL with the generated Cloudflare URL:

```html
<h2>VAuLT Gateway Integration Test</h2>

<p>Testing our Node.js API Gateway inside Canvas LMS.</p>

<iframe
  src="https://<generated-name>.trycloudflare.com/"
  width="100%"
  height="450"
  title="VAuLT Gateway Hello World">
</iframe>
```

6. Save the Canvas page and verify the gateway webpage is displayed.

**Result:** The Gateway Hello World page was successfully rendered inside the Canvas test instance.

### Important Notes

- Both the Node.js server and Cloudflare Tunnel must remain running.
- Cloudflare Quick Tunnel URLs are temporary and may change after restarting.
- The tunnel is intended for development and testing, not production.
- This test only verifies iframe embedding and HTTP connectivity. It does not perform an authenticated LTI launch.
- Do not expose real student data, credentials, or sensitive endpoints through the temporary tunnel.

## Next Milestones

### Milestone 2 — LTI 1.3 Integration

- Register an LTI 1.3 Developer Key in Canvas.
- Implement LTI login and launch endpoints.
- Validate Canvas-issued JWT tokens.
- Identify authenticated Canvas users and course context.

### Milestone 3 — VAuLT Integration

- Establish communication with the existing VAuLT backend.
- Investigate Canvas-to-VAuLT user mapping and login handling.
- Map Canvas assignments to VAuLT quests.
- Implement a secure QR code handoff.

### Milestone 4 — Grade Passback

- Retrieve quest completion results.
- Calculate quest-level completion scores.
- Return grades to Canvas using LTI Assignment and Grade Services (AGS).

## Development Status

The project is currently in early development.

The initial gateway and Canvas iframe proof of concept are complete. LTI authentication, VAuLT integration, and grade passback remain future development milestones.

## Project Team

BCIT COMP 4800 — Group 6

