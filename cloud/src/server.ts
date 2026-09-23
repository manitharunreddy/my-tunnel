import express, { Request, Response } from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
type MessageTypes =
  | "register"
  | "tunnel-created"
  | "request"
  | "response"
  | "ping"
  | "pong"
  | "abort"
  | "target-updated";

const MESSAGE_TYPES: { [key: string]: MessageTypes } = {
  REGISTER: "register",
  TUNNEL_CREATED: "tunnel-created",
  TARGET_UPDATED: "target-updated",

  REQUEST: "request",
  RESPONSE: "response",

  PING: "ping",
  PONG: "pong",

  ABORT: "abort",
};

const NO_REACTION_ID = "0";

const app = express();

const PORT = 3000;

// Express routes
app.get("/cloud", (req: Request, res: Response) => {
  res.send("My Tunnel Cloud Server is running 🚀");
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({
  server,
  path: "/tunnel",
});

const tunnels = new Map<
  string,
  {
    agentId: string;
    socket: WebSocket;
    target: string;
  }
>();

const pendingRequests = new Map<
  string,
  {
    res: Response;
    tunnelId: string;
  }
>();

// When a local agent connects
wss.on("connection", (socket: WebSocket, request) => {
  const agentId = request.headers.uuid;

  if (typeof agentId !== "string") {
    console.log("❌ Agent ID missing");
    socket.close();
    return;
  }

  console.log(`🔌 Local agent ${agentId} connected!`);

  socket.on("message", (message) => {
    console.log("📩 Message from local:", message.toString());
    const data = JSON.parse(message.toString());
    switch (data.type) {
      case MESSAGE_TYPES.PING:
        socket.send(
          JSON.stringify({
            type: MESSAGE_TYPES.PONG,
            id: NO_REACTION_ID,
          })
        );
        break;
      case MESSAGE_TYPES.REGISTER: {
        console.log("📝 Agent registration:", data);

        const tunnelId = crypto.randomBytes(4).toString("hex");

        tunnels.set(tunnelId, {
          agentId: data.agentId,
          socket,
          target: "",
        });

        console.log(`🚀 Tunnel created: ${tunnelId}`);

        socket.send(
          JSON.stringify({
            type: MESSAGE_TYPES.TUNNEL_CREATED,
            id: NO_REACTION_ID,
            tunnelId,
            target: "",
          })
        );

        break;
      }
      case MESSAGE_TYPES.REQUEST:
        // We will implement this in the next step
        break;

      case MESSAGE_TYPES.RESPONSE: {
        console.log("📦 Response from local agent:", data);

        const pendingRequest = pendingRequests.get(data.id);

        if (!pendingRequest) {
          console.log(`⚠️ No pending request found for ID: ${data.id}`);
          break;
        }

        const { res, tunnelId } = pendingRequest;

        pendingRequests.delete(data.id);

        res.status(data.status);
        if (data.headers) {
          console.log("🍪 Response Set-Cookie:", data.headers["set-cookie"]);

          for (const [key, value] of Object.entries(data.headers)) {
            if (value === undefined) continue;

            const lowerKey = key.toLowerCase();

            // These belong to the original HTTP connection.
            // The Cloud server must create its own response framing.
            if (
              lowerKey === "content-length" ||
              lowerKey === "transfer-encoding" ||
              lowerKey === "connection"
            ) {
              continue;
            }

            // Rewrite redirects from local target → public tunnel URL
            if (lowerKey === "location" && typeof value === "string") {
              const tunnel = tunnels.get(tunnelId);

              if (tunnel) {
                try {
                  const targetUrl = new URL(tunnel.target);
                  const locationUrl = new URL(value);

                  if (locationUrl.host === targetUrl.host) {
                    locationUrl.protocol = "http:";
                    locationUrl.host = `${tunnelId}.localhost:3000`;

                    res.setHeader("Location", locationUrl.toString());

                    console.log("↪️ Rewritten redirect:");
                    console.log(`   From: ${value}`);
                    console.log(`   To:   ${locationUrl.toString()}`);

                    continue;
                  }
                } catch {
                  // If Location is not a valid absolute URL,
                  // leave it unchanged.
                }
              }
            }

            res.setHeader(key, value as string | string[]);
          }
        }

        if (data.data) {
          const responseBody = Buffer.from(data.data, "base64");

          res.end(responseBody);
        } else {
          res.end();
        }

        console.log(`📤 Response sent to browser, requestId=${data.id}`);

        break;
      }
      case MESSAGE_TYPES.ABORT:
        // Handle abort message
        break;
      default:
        console.log("⚠️ Unknown message type:", data.type);
    }
  });
  socket.on("close", () => {
    console.log(`❌ Local agent ${agentId} disconnected`);

    // Remove all tunnels belonging to this agent
    for (const [tunnelId, tunnel] of tunnels.entries()) {
      if (tunnel.agentId === agentId && tunnel.socket === socket) {
        tunnels.delete(tunnelId);

        console.log(`🗑️ Tunnel removed: ${tunnelId}`);
      }
    }
  });
});

app.get("/tunnels", (req: Request, res: Response) => {
  const tunnelList = Array.from(tunnels.entries()).map(
    ([tunnelId, tunnel]) => ({
      tunnelId,
      agentId: tunnel.agentId,
      target: tunnel.target,
    })
  );

  const rows = tunnelList
    .map(
      (tunnel) => `
        <tr>
          <td>${tunnel.tunnelId}</td>

          <td>${tunnel.agentId}</td>

          <td>
            <input
              id="target-${tunnel.tunnelId}"
              type="text"
              value="${tunnel.target}"
              style="
                width: 300px;
                padding: 8px;
                border: 1px solid #ccc;
                border-radius: 4px;
              "
            />

            <button
              onclick="updateTarget('${tunnel.tunnelId}')"
              style="
                margin-left: 8px;
                padding: 8px 12px;
                cursor: pointer;
              "
            >
              Update
            </button>
          </td>

          <td>
            <a
              href="http://${tunnel.tunnelId}.localhost:3000/"
              target="_blank"
            >
              Open Tunnel
            </a>
          </td>
        </tr>
      `
    )
    .join("");

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>My Tunnel - Tunnels</title>

        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 30px;
            background: #f5f5f5;
          }

          h1 {
            margin-bottom: 20px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            background: white;
          }

          th,
          td {
            padding: 12px;
            border: 1px solid #ddd;
            text-align: left;
          }

          th {
            background: #222;
            color: white;
          }

          tr:hover {
            background: #f1f1f1;
          }

          a {
            color: #0066cc;
            text-decoration: none;
            font-weight: bold;
          }

          a:hover {
            text-decoration: underline;
          }

          button {
            background: #222;
            color: white;
            border: none;
            border-radius: 4px;
          }

          button:hover {
            opacity: 0.8;
          }
        </style>
      </head>

      <body>
        <h1>🚀 My Tunnel</h1>

        <table>
          <thead>
            <tr>
              <th>Tunnel ID</th>
              <th>Agent ID</th>
              <th>Target</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${
              rows ||
              `
                <tr>
                  <td colspan="4">No active tunnels</td>
                </tr>
              `
            }
          </tbody>
        </table>

        <script>
          async function updateTarget(tunnelId) {
            const input = document.getElementById(
              "target-" + tunnelId
            );

            const target = input.value.trim();

            if (!target) {
              alert("Target URL is required");
              return;
            }

            try {
              const response = await fetch(
                "/tunnels/" + tunnelId + "/target",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    target: target
                  })
                }
              );

              const result = await response.json();

              if (!response.ok) {
                alert(result.message || "Failed to update target");
                return;
              }

              alert("Target updated successfully");

            } catch (error) {
              console.error(error);
              alert("Failed to update target");
            }
          }
        </script>
      </body>
    </html>
  `);
});

app.post(
  "/tunnels/:tunnelId/target",
  express.json(),
  (req: Request, res: Response) => {
    const { tunnelId } = req.params as {
      tunnelId: string;
    };
    const { target } = req.body;

    const tunnel = tunnels.get(tunnelId);

    if (!tunnel) {
      res.status(404).json({
        message: "Tunnel not found",
      });
      return;
    }

    if (!target) {
      res.status(400).json({
        message: "Target is required",
      });
      return;
    }

    try {
      const targetUrl = new URL(target);

      if (!["http:", "https:"].includes(targetUrl.protocol)) {
        res.status(400).json({
          message: "Target must use http:// or https://",
        });
        return;
      }

      // Update target for THIS tunnel
      tunnel.target = target;

      console.log(`🎯 Target updated`);
      console.log(`Tunnel: ${tunnelId}`);
      console.log(`Target: ${target}`);

      // Send updated target to the agent
      tunnel.socket.send(
        JSON.stringify({
          type: "target-updated",
          id: "0",
          tunnelId,
          target,
        })
      );

      res.json({
        message: "Target updated successfully",
        tunnelId,
        target,
      });
    } catch {
      res.status(400).json({
        message: "Invalid target URL",
      });
    }
  }
);

app.use((req: Request, res: Response) => {
  const requestId = crypto.randomUUID();

  const chunks: Buffer[] = [];

  req.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on("end", () => {
    const body = Buffer.concat(chunks);

    const host = req.hostname;
    const tunnelId = host.split(".")[0];

    console.log("🌐 Incoming request");
    console.log("Host:", host);
    console.log("Path:", req.originalUrl);
    console.log("Method:", req.method);
    console.log("Body size:", body.length);

    const tunnel = tunnels.get(tunnelId);

    if (!tunnel) {
      res.status(404).json({
        message: "Tunnel not found",
      });
      return;
    }

    pendingRequests.set(requestId, {
      res,
      tunnelId,
    });

    tunnel.socket.send(
      JSON.stringify({
        type: MESSAGE_TYPES.REQUEST,
        id: requestId,
        method: req.method,
        path: req.originalUrl,
        headers: req.headers,

        // Convert raw bytes to base64
        body: body.length > 0 ? body.toString("base64") : null,
      })
    );

    console.log("📤 Request sent to agent:", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      bodySize: body.length,
    });
  });

  req.on("error", (error) => {
    console.error("❌ Request stream error:");

    if (!res.headersSent) {
      res.status(500).json({
        message: "Failed to read request",
      });
    }
  });
});
// Start HTTP + WebSocket server
server.listen(PORT, () => {
  console.log(`Cloud server running on port ${PORT}`);
});
