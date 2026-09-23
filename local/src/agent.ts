import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
/**
 * Types and variables
 */
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

const CLOUD_URL = "ws://localhost:3000/tunnel";
let TARGET_URL = ""; //

console.log(`🎯 Local target: ${TARGET_URL}`);
const NO_REACTION_ID = "0";
const HEART_BEAT_INTERVAL = 10000; // 10 seconds
const CONFIG_FILE = path.join(process.cwd(), "agent-config.json");
let SET_INTERVAL_VAR: NodeJS.Timeout | undefined;
let TUNNEL_ID: string | undefined;
/**
 * Fucntions
 */
const SET_INTERVAL_FUNCTION = () => {
  return setInterval(() => {
    socket.send(
      returnSocketMessage(
        MESSAGE_TYPES.PING,
        NO_REACTION_ID,
        `Ping from local agent at ${new Date().toISOString()}`
      )
    );
  }, HEART_BEAT_INTERVAL);
};

const getAgentId = (): string => {
  if (fs.existsSync(CONFIG_FILE)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));

    return config.agentId;
  }

  const agentId = uuidv4();

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      {
        agentId,
      },
      null,
      2
    )
  );

  return agentId;
};

console.log("🚀 Starting local agent...");
const AGENT_ID = getAgentId();
console.log(`🆔 Agent ID: ${AGENT_ID}`);

const socket = new WebSocket(CLOUD_URL, {
  headers: {
    uuid: AGENT_ID,
  },
});

const returnSocketMessage: (
  type: MessageTypes,
  id: string,
  message: string
) => string = (type, id, message) => {
  return JSON.stringify({
    type,
    id,
    message,
  });
};

socket.on("open", () => {
  console.log("✅ Connected to cloud!");

  socket.send(
    JSON.stringify({
      type: MESSAGE_TYPES.REGISTER,
      id: NO_REACTION_ID,
      agentId: AGENT_ID,
    })
  );

  SET_INTERVAL_VAR = SET_INTERVAL_FUNCTION();
});

socket.on("message", async (message) => {
  const data = JSON.parse(message.toString());

  console.log("📩 Message from cloud:", data);

  switch (data.type) {
    case MESSAGE_TYPES.TUNNEL_CREATED:
      if (data.error) {
        console.error(`❌ Tunnel creation failed: ${data.error}`);
        break;
      }

      TUNNEL_ID = data.tunnelId;
      TARGET_URL = data.target;
      console.log("🚀 Tunnel created!");
      console.log(`🌐 Tunnel ID: ${TUNNEL_ID}`);
      console.log(`🎯 Target: ${TARGET_URL}`);
      break;

    case MESSAGE_TYPES.TARGET_UPDATED:
      TARGET_URL = data.target;
      console.log("🎯 Target updated from cloud!");
      console.log(`🌐 Tunnel ID: ${data.tunnelId}`);
      console.log(`🎯 New target: ${TARGET_URL}`);
      break;

    case MESSAGE_TYPES.PONG:
      console.log("🏓 Pong from cloud");
      break;

    case MESSAGE_TYPES.REQUEST:
      console.log("🌐 Request from cloud:", data);

      try {
        console.log("🎯 Current TARGET_URL:", TARGET_URL);

        const target = new URL(data.path, TARGET_URL).toString();
        console.log(`📤 Forwarding request to local target: ${target}`);

        const {
          host,
          connection,
          "content-length": contentLength,
          ...forwardHeaders
        } = data.headers || {};

        const targetOrigin = new URL(TARGET_URL).origin;

        forwardHeaders.origin = targetOrigin;
        forwardHeaders.referer = `${targetOrigin}${data.path}`;

        console.log("📨 Forwarding headers:", forwardHeaders);

        console.log("🍪 Browser cookie present:", !!forwardHeaders.cookie);

        const requestBody = data.body
          ? Buffer.from(data.body, "base64")
          : undefined;

        const response = await axios({
          method: data.method,
          url: target,
          headers: forwardHeaders,
          data: requestBody,
          responseType: "arraybuffer",
          maxRedirects: 0,
          validateStatus: () => true,
        });

        if (data.path === "/users/sign_in" && data.method === "GET") {
          console.log("========================================");
          console.log("🔎 LOGIN GET COOKIE DEBUG");
          console.log("Status:", response.status);
          console.log("Has Set-Cookie:", !!response.headers["set-cookie"]);
          console.log(
            "Cookie count:",
            response.headers["set-cookie"]?.length ?? 0
          );
          console.log("========================================");
        }

        socket.send(
          JSON.stringify({
            type: MESSAGE_TYPES.RESPONSE,
            id: data.id,
            tunnelId: TUNNEL_ID,
            status: response.status,
            headers: response.headers,
            data: Buffer.from(response.data).toString("base64"),
          })
        );
      } catch (error) {
        console.error("❌ Error forwarding request:", error);

        if (axios.isAxiosError(error)) {
          const errorData = error.response?.data;

          let errorBuffer: Buffer;

          if (Buffer.isBuffer(errorData)) {
            errorBuffer = errorData;
          } else if (errorData !== undefined) {
            errorBuffer = Buffer.from(
              typeof errorData === "string"
                ? errorData
                : JSON.stringify(errorData)
            );
          } else {
            errorBuffer = Buffer.from(
              JSON.stringify({
                message: error.message,
              })
            );
          }

          socket.send(
            JSON.stringify({
              type: MESSAGE_TYPES.RESPONSE,
              id: data.id,
              status: error.response?.status || 500,
              headers: error.response?.headers || {},
              data: errorBuffer.toString("base64"),
            })
          );
        } else {
          const errorBuffer = Buffer.from(
            JSON.stringify({
              message: "Internal agent error",
            })
          );

          socket.send(
            JSON.stringify({
              type: MESSAGE_TYPES.RESPONSE,
              id: data.id,
              status: 500,
              data: errorBuffer.toString("base64"),
            })
          );
        }
      }

      break;

    case MESSAGE_TYPES.RESPONSE:
      // Later:
      // Handle response from cloud
      break;

    case MESSAGE_TYPES.ABORT:
      // Later:
      // Abort a request
      break;

    default:
      console.log("⚠️ Unknown message type:", data.type);
  }
});

socket.on("close", () => {
  console.log("❌ Connection closed");

  if (SET_INTERVAL_VAR) {
    clearInterval(SET_INTERVAL_VAR);
  }
});

socket.on("error", (error) => {
  console.error("❌ WebSocket error:", error);
});
