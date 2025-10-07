import { WebSocket, WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { config } from "@repo/config/config";
import { pub, sub } from "./redis.js";
import { sendMessageToKafka, KafkaConsumer } from "./kafka.js";
import { prismaClient } from "@repo/db/client";

// Types
interface User {
  id: string;
  ws: WebSocket;
  rooms: Set<string>;
}

interface ChatMessage {
  type: "chat";
  roomId: string;
  message: string;
  userId: string;
  timestamp: number;
}

interface JoinRoomMessage {
  type: "join_room";
  roomId: string;
}

interface LeaveRoomMessage {
  type: "leave_room";
  roomId: string;
}

interface TypingMessage {
  type: "typing";
  roomId: string;
  isTyping: boolean;
}

interface ReactionMessage {
  type: "reaction";
  messageId: number;
  emoji: string;
  roomId: string;
}

interface EditMessage {
  type: "edit_message";
  messageId: number;
  newMessage: string;
  roomId: string;
}

interface DeleteMessage {
  type: "delete_message";
  messageId: number;
  roomId: string;
}

type WebSocketMessage = ChatMessage | JoinRoomMessage | LeaveRoomMessage | TypingMessage | ReactionMessage | EditMessage | DeleteMessage;

// State Management
const connectedUsers = new Map<string, User>();
const roomSubscriptions = new Map<string, number>();
const typingUsers = new Map<string, Map<string, { userId: string; name: string; timestamp: number }>>();

// WebSocket Server
const wss = new WebSocketServer({ port: config.WS_PORT });

// Authentication
const authenticateUser = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, config.SECRET_KEY) as any;
    return decoded?.userId || null;
  } catch {
    return null;
  }
};

// Redis Message Handler
sub.on("message", (channel: string, message: string) => {
  try {
    const data = JSON.parse(message);
    broadcastToRoom(channel, data);
  } catch (error) {
    console.error("Redis message parsing failed:", error);
  }
});

// Helper Functions
const getRoomChannel = (roomId: string) => `room:${roomId}`;

const broadcastToRoom = (channel: string, data: any) => {
  connectedUsers.forEach(user => {
    if (user.rooms.has(channel) && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(JSON.stringify(data));
    }
  });
};

const joinRoom = async (user: User, roomId: string) => {
  const channel = getRoomChannel(roomId);
  
  if (user.rooms.has(channel)) return;
  
  user.rooms.add(channel);
  
  // Subscribe to Redis channel
  const currentSubs = roomSubscriptions.get(channel) || 0;
  if (currentSubs === 0) {
    await sub.subscribe(channel);
  }
  roomSubscriptions.set(channel, currentSubs + 1);
  
  user.ws.send(JSON.stringify({ 
    type: "joined", 
    roomId, 
    message: `Joined room ${roomId}` 
  }));
};

const leaveRoom = async (user: User, roomId: string) => {
  const channel = getRoomChannel(roomId);
  
  if (!user.rooms.has(channel)) return;
  
  user.rooms.delete(channel);
  
  // Unsubscribe from Redis if no more local users
  const currentSubs = roomSubscriptions.get(channel) || 0;
  if (currentSubs <= 1) {
    await sub.unsubscribe(channel);
    roomSubscriptions.delete(channel);
  } else {
    roomSubscriptions.set(channel, currentSubs - 1);
  }
  
  user.ws.send(JSON.stringify({ 
    type: "left", 
    roomId, 
    message: `Left room ${roomId}` 
  }));
};

const handleChatMessage = async (user: User, message: ChatMessage) => {
  const channel = getRoomChannel(message.roomId);
  
  if (!user.rooms.has(channel)) {
    user.ws.send(JSON.stringify({ 
      type: "error", 
      message: "Not in room" 
    }));
    return;
  }
  
  const chatData = {
    ...message,
    userId: user.id,
    timestamp: Date.now()
  };
  
  // Send to Kafka for persistence
  try {
    await sendMessageToKafka(chatData, "messages");
  } catch (error) {
    console.error("Failed to send to Kafka:", error);
  }
  
  // Broadcast to Redis
  try {
    await pub.publish(channel, JSON.stringify(chatData));
  } catch (error) {
    console.error("Failed to publish to Redis:", error);
  }
};

const handleTyping = (user: User, message: TypingMessage) => {
  const channel = getRoomChannel(message.roomId);
  
  if (!user.rooms.has(channel)) return;
  
  const roomTyping = typingUsers.get(message.roomId) || new Map();
  
  if (message.isTyping) {
    roomTyping.set(user.id, {
      userId: user.id,
      name: user.id, // You might want to fetch actual name from DB
      timestamp: Date.now()
    });
  } else {
    roomTyping.delete(user.id);
  }
  
  typingUsers.set(message.roomId, roomTyping);
  
  // Broadcast typing status to room
  const typingData = {
    type: "typing_update",
    roomId: message.roomId,
    typingUsers: Array.from(roomTyping.values()).filter(t => 
      Date.now() - t.timestamp < 3000 // Remove old typing indicators
    )
  };
  
  connectedUsers.forEach(u => {
    if (u.rooms.has(channel) && u.ws.readyState === WebSocket.OPEN) {
      u.ws.send(JSON.stringify(typingData));
    }
  });
};

const handleReaction = async (user: User, message: ReactionMessage) => {
  const channel = getRoomChannel(message.roomId);
  
  if (!user.rooms.has(channel)) return;
  
  const reactionData = {
    ...message,
    userId: user.id,
    timestamp: Date.now()
  };
  
  // Send to Kafka for persistence
  try {
    await sendMessageToKafka(reactionData, "reactions");
  } catch (error) {
    console.error("Failed to send reaction to Kafka:", error);
  }
  
  // Broadcast to Redis
  try {
    await pub.publish(channel, JSON.stringify(reactionData));
  } catch (error) {
    console.error("Failed to publish reaction to Redis:", error);
  }
};

const handleEditMessage = async (user: User, message: EditMessage) => {
  const channel = getRoomChannel(message.roomId);
  
  if (!user.rooms.has(channel)) return;
  
  const editData = {
    ...message,
    userId: user.id,
    timestamp: Date.now()
  };
  
  // Send to Kafka for persistence
  try {
    await sendMessageToKafka(editData, "message_edits");
  } catch (error) {
    console.error("Failed to send edit to Kafka:", error);
  }
  
  // Broadcast to Redis
  try {
    await pub.publish(channel, JSON.stringify(editData));
  } catch (error) {
    console.error("Failed to publish edit to Redis:", error);
  }
};

const handleDeleteMessage = async (user: User, message: DeleteMessage) => {
  const channel = getRoomChannel(message.roomId);
  
  if (!user.rooms.has(channel)) return;
  
  const deleteData = {
    ...message,
    userId: user.id,
    timestamp: Date.now()
  };
  
  // Send to Kafka for persistence
  try {
    await sendMessageToKafka(deleteData, "message_deletes");
  } catch (error) {
    console.error("Failed to send delete to Kafka:", error);
  }
  
  // Broadcast to Redis
  try {
    await pub.publish(channel, JSON.stringify(deleteData));
  } catch (error) {
    console.error("Failed to publish delete to Redis:", error);
  }
};

// Connection Handler
wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  
  if (!token) {
    ws.close(1008, "Missing token");
    return;
  }
  
  const userId = authenticateUser(token);
  if (!userId) {
    ws.close(1008, "Invalid token");
    return;
  }
  
  // Create user
  const user: User = {
    id: userId,
    ws,
    rooms: new Set()
  };
  
  connectedUsers.set(userId, user);
  console.log(`User ${userId} connected`);
  
  // Update online status
  try {
    await prismaClient.user.update({
      where: { id: userId },
      data: { isOnline: true, lastSeen: new Date() }
    });
  } catch (error) {
    console.error("Failed to update user online status:", error);
  }
  
  // Message Handler
  ws.on("message", async (data) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      
      switch (message.type) {
        case "join_room":
          await joinRoom(user, message.roomId);
          break;
          
        case "leave_room":
          await leaveRoom(user, message.roomId);
          break;
          
        case "chat":
          await handleChatMessage(user, message);
          break;
          
        case "typing":
          handleTyping(user, message);
          break;
          
        case "reaction":
          await handleReaction(user, message);
          break;
          
        case "edit_message":
          await handleEditMessage(user, message);
          break;
          
        case "delete_message":
          await handleDeleteMessage(user, message);
          break;
          
        default:
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Unknown message type" 
          }));
      }
    } catch (error) {
      console.error("Message handling error:", error);
      ws.send(JSON.stringify({ 
        type: "error", 
        message: "Invalid message format" 
      }));
    }
  });
  
  // Cleanup on disconnect
  ws.on("close", async () => {
    console.log(`User ${userId} disconnected`);
    
    // Update offline status
    try {
      await prismaClient.user.update({
        where: { id: userId },
        data: { isOnline: false, lastSeen: new Date() }
      });
    } catch (error) {
      console.error("Failed to update user offline status:", error);
    }
    
    // Leave all rooms
    for (const channel of user.rooms) {
      const roomId = channel.replace("room:", "");
      await leaveRoom(user, roomId);
    }
    
    // Clean up typing indicators
    typingUsers.forEach((roomTyping, roomId) => {
      roomTyping.delete(userId);
      if (roomTyping.size === 0) {
        typingUsers.delete(roomId);
      }
      console.log(`Typing user ${userId} left room ${roomId}`);
    });
    
    connectedUsers.delete(userId);
    console.log(`User ${userId} disconnected`);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({ 
    type: "connected", 
    message: "Connected to chat server",
    userId: userId

  }));
});

// Initialize Kafka Consumer
KafkaConsumer().catch(console.error);

// Server startup
console.log(`🚀 WebSocket server running on ws://localhost:${config.WS_PORT}`);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  wss.close();
  await sub.disconnect();
  await pub.disconnect();
  process.exit(0);
});