import WebSocket, { WebSocketServer } from "ws";


const wss = new WebSocketServer({port:8080})
type User = {
    ws : WebSocket,
    rooms : string[],
    userId : string
}

const users : User[] = [];


