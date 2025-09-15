// src/index.ts
import { WebSocket, WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { config } from "@repo/config/config";
import { prismaClient } from "@repo/db/client";
import { pub, sub } from "./redis.js"; // your redis helper

const wss = new WebSocketServer({ port: config.WS_PORT });

type User = {
  ws: WebSocket;
  rooms: string[];        // will store channel names like "room:5"
  userId: string;
};

const users: User[] = [];

// Local map to track how many local sockets subscribed to a channel.
// This prevents subscribing multiple times from the same server process.
const localRoomSubs = new Map<string, number>();

const checkUser = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, config.SECRET_KEY) as any;
    if (typeof decoded === "string" || !decoded.userId) return null;
    return decoded.userId;
  } catch (e) {
    return null;
  }
};

/**
 * When Redis publishes to any room channel, forward message
 * to sockets that have that room in their local `user.rooms`.
 */
sub.on("message", (channel: string, message: string) => {
  try {
    const data = JSON.parse(message);
    // forward to local connected users who are in this channel
    users.forEach((user) => {
      if (user.rooms.includes(channel) && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(data));
      }
    });
  } catch (err) {
    console.error("Failed to handle redis message", err);
  }
});

wss.on("connection", function connection(ws, req) {
  const url = req.url;
  if (!url) {
    ws.close();
    return;
  }
  const queryParams = new URLSearchParams(url.split("?")[1]);
  const token = queryParams.get("token") || "";
  const userId = checkUser(token);

  if (userId == null) {
    ws.close();
    return;
  }

  const user: User = { userId, rooms: [], ws };
  users.push(user);

  // handle incoming messages
  ws.on("message", async function message(raw) {
    let parsedData: any;
    try {
      parsedData = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", reason: "invalid_json" }));
      return;
    }

    // normalize room id
    if (parsedData.type === "join_room") {
      const roomId = String(parsedData.roomId);
      const channelName = `room:${roomId}`;        // channel for pub/sub
      const membersKey = `room:${roomId}:members`; // Redis set key

      // local tracking
      if (!user.rooms.includes(channelName)) user.rooms.push(channelName);

      // Add to Redis members set (use sAdd for node-redis v4, or sadd for ioredis)
      try {
        // If using node-redis v4: await pub.sAdd(membersKey, userId)
        // If using ioredis: await pub.sadd(membersKey, userId)
        // Try both fallback style:
        if (typeof (pub as any).sAdd === "function") await (pub as any).sAdd(membersKey, userId);
        else await (pub as any).sadd(membersKey, userId);
      } catch (err) {
        console.error("Failed to add member to redis set:", err);
      }

      // Subscribe on this server to the channel only once
      const current = localRoomSubs.get(channelName) || 0;
      if (current === 0) {
        try {
          // If your redis client uses callback style, adapt accordingly.
          await (sub as any).subscribe(channelName); // subscribe to the room channel
          localRoomSubs.set(channelName, 1);
        } catch (err) {
          console.error("Failed to subscribe to channel:", channelName, err);
        }
      } else {
        localRoomSubs.set(channelName, current + 1);
      }

      ws.send(JSON.stringify({ type: "system", message: `joined ${channelName}` }));
      return;
    }

    if (parsedData.type === "leave_room") {
      const roomId = String(parsedData.roomId);
      const channelName = `room:${roomId}`;
      const membersKey = `room:${roomId}:members`;

      // remove from local list
      user.rooms = user.rooms.filter((r) => r !== channelName);

      // remove from Redis members set
      try {
        if (typeof (pub as any).sRem === "function") await (pub as any).sRem(membersKey, userId);
        else await (pub as any).srem(membersKey, userId);
      } catch (err) {
        console.error("Failed to remove member from redis set:", err);
      }

      // update local subscription count and unsubscribe if no local sockets remaining
      const current = localRoomSubs.get(channelName) || 0;
      if (current <= 1) {
        try {
          await (sub as any).unsubscribe(channelName);
        } catch (err) {
          console.error("Failed to unsubscribe channel:", channelName, err);
        }
        localRoomSubs.delete(channelName);
      } else {
        localRoomSubs.set(channelName, current - 1);
      }

      ws.send(JSON.stringify({ type: "system", message: `left ${channelName}` }));
      return;
    }

    if (parsedData.type === "chat") {
      const roomId = parsedData.roomId;
      const channelName = `room:${roomId}`;
      const message = parsedData.message;

      // persist message in DB (ensure types match Prisma schema)
      try {
        // if prisma expects int roomId, cast accordingly
        const dbRoomId = isNaN(Number(roomId)) ? roomId : Number(roomId);

        await prismaClient.chat.create({
          data: {
            roomId: dbRoomId,
            message,
            userId,
          },
        });
      } catch (err) {
        console.error("DB save failed:", err);
      }

      // publish to redis channel (other servers will pick it up)
      try {
        await pub.publish(channelName, JSON.stringify({
          type: "chat",
          roomId,
          message,
          userId
        }));
      } catch (err) {
        console.error("Failed to publish to redis:", err);
      }

      return;
    }

    // add more event types (history, typing, ack) later
  });

  // Cleanup on disconnect
  ws.on("close", async () => {
    // remove user from in-memory list
    const idx = users.findIndex((u) => u.ws === ws);
    if (idx !== -1) users.splice(idx, 1);

    // remove from all Redis room member sets and update local subscription counters
    for (const channelName of user.rooms) {
      try {
        const roomId = channelName.replace(/^room:/, "");
        const membersKey = `room:${roomId}:members`;

        if (typeof (pub as any).sRem === "function") await (pub as any).sRem(membersKey, user.userId);
        else await (pub as any).srem(membersKey, user.userId);
      } catch (err) {
        console.error("Error removing user from members set on disconnect:", err);
      }

      const current = localRoomSubs.get(channelName) || 0;
      if (current <= 1) {
        try {
          await (sub as any).unsubscribe(channelName);
        } catch (err) {
          console.error("Failed to unsubscribe on close:", channelName, err);
        }
        localRoomSubs.delete(channelName);
      } else {
        localRoomSubs.set(channelName, current - 1);
      }
    }
  });
});

console.log(`WebSocket server running on ws://localhost:${config.WS_PORT}`);
