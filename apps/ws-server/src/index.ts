import { WebSocket , WebSocketServer } from "ws";

import jwt from "jsonwebtoken";

import {config} from "@repo/config/config";

import {prismaClient} from "@repo/db/client";

import { pub , sub } from "./redis.js";

const wss = new WebSocketServer({port : config.WS_PORT}) 
type User = {
    ws : WebSocket,
    rooms : string[],
    userId : string
}

const users : User[] = [];

const checkUser = (token : string) : string | null => {
    try{
        const decoded = jwt.verify(token , config.SECRET_KEY);
        if(typeof decoded == "string" || !decoded.userId) return null;
        return decoded.userId
    }
    catch(e){
        return null;
    }
};

sub.subscribe("chat_message", (err , count) => {
    if(err){
        console.error("Failed to subscribe" , err.message);
    }
    else{
        console.log(`Subscribed to ${count} channel(s).`);
    }
})

sub.on("message" , (channel , message) => {
    if(channel === "chat_message"){
        const data = JSON.parse(message);

        users.forEach((user) => {
            if(user.rooms.includes(data.roomId)){
                user.ws.send(JSON.stringify(data));
            }
        })
    }
});

wss.on('connection' , function connection(ws,req){
    const url = req.url;
    if(!url) return;
    const queryParams = new URLSearchParams(url.split("?")[1])
    const token = queryParams.get("token") || "";
    const userId = checkUser(token);

    if(userId == null){
        ws.close();
        return;
    }

    users.push({
        userId , 
        rooms : [],
        ws
    })

    ws.on('message' , async function message(data) {
        let parsedData;
        if(typeof data !== "string"){
            parsedData = JSON.parse(data.toString());
        }
        else{
            parsedData = JSON.parse(data);
        }

        if(parsedData.type === 'join_room'){
            const user = users.find(x => x.ws === ws)
            user?.rooms.push(parsedData.roomId);
        }
        if(parsedData.type === 'leave_room'){
            const user = users.find(x=>x.ws === ws)
            if(!user) return;
            user.rooms = user.rooms.filter(room=>room!==parsedData.roomId);
        }
        if(parsedData.type === "chat"){
            const roomId = parsedData.roomId;
            const message = parsedData.message;
            await prismaClient.chat.create({
                data : {
                    roomId,
                    message,
                    userId
                }
            });

            await pub.publish(
                "chat_messages",
                JSON.stringify({
                    type: "chat",
                    message ,
                    userId,
                    roomId
                })
            )
        }
    } )
})