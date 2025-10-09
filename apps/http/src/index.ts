import express from "express";
import {CreateRoomSchema, CreateUserSchema, SigninSchema} from "@repo/zod/types"

import {prismaClient} from "@repo/db/client"
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "@repo/config/config";
import { CustomRequest, middleware } from "./middleware";




const app = express();
app.use(express.json());



app.post("/signup" , async(req , res) => {
    const parsedData = CreateUserSchema.safeParse(req.body);
    if(!parsedData.success){
        res.json({
            message : "Incorrect Inputs"
        })

        return;
    }
    try{
        const hashedPassword = await bcrypt.hash(parsedData.data.password , 10);
        const user = await prismaClient.user.create({
            data : {
                email : parsedData.data.username,
                password : hashedPassword,
                name : parsedData.data.name
            }
        })

        res.json({
            userId : user.id
        })
        
    } catch(e){
        res.status(411).json({
            message : "Error while signing up"
        })
    }

})

app.post("/signin" , async (req , res) => {
    const parsedData = SigninSchema.safeParse(req.body);
    if(!parsedData.success){
        res.json({
            message : "Invalid Inputs"
        })
        return;
    }
    try{
        const user = await prismaClient.user.findFirst({
            where : {
                email : parsedData.data.username
             
            }
        })
        if(!user || !user.password){
            res.status(401).json({
                message : "user not found , invalid"
            })
            return;
        }
        const isValidPassword = await bcrypt.compare( parsedData.data.password , user?.password);
        if(isValidPassword){
            const token = jwt.sign({
                userId : user?.id
            } , config.SECRET_KEY)

            res.json({
                token : token
            })
            
        }
        else{
            res.status(401).json({
                message : "Invalid credentials"
            })
        }
    }
    catch(e){
        res.status(411).json({
            message : "Error while signing in"
        })
    }
})

app.post("/rooms" , middleware ,  async (req : CustomRequest , res) => {
    const parsedData = CreateRoomSchema.safeParse(req.body);
    if(!parsedData.success){
        res.json({
            message : "Incorrect data"
        })
        return;
    }
    const userId = req.userId;
    if(!userId){
        res.status(403).json({
            message : "Unauthorized"
        })
        return;
    }
    try{
        const room = await prismaClient.room.create({
            data : {
                slug : parsedData.data.name,
                adminId : userId
            }
        })
        res.json({
            roomId : room.id
        })
    }
    catch(e){
        res.status(411).json({
            message : "Room already exists or Error creating room"
        })
    }


})

app.get("/chats/:roomId" , middleware , async(req: CustomRequest , res) => {
    try{
        const roomId = Number(req.params.roomId);
    const messages = await prismaClient.chat.findMany({
        where : {
            roomId : roomId
        },
        orderBy : {
            id : "desc"
        },
        take : 50
    })

    res.json({
        messages : messages
    })
    }
    catch(e){
        res.status(411).json({
            message : []
        })
    }
}
)

app.get("/room/:slug", middleware, async(req: CustomRequest, res)=>{
    const slug=req.params.slug;
    try{
        const room= await prismaClient.room.findFirst({
            where: {slug}
        });
        res.json({
            message: room
        })
    }catch(e){
        res.status(411).json({
            message: "Error getting slug"
        })
    }
})

// Get online users in a room
app.get("/rooms/:roomId/users", middleware, async(req: CustomRequest, res)=>{
    const roomId = Number(req.params.roomId);
    try{
        const onlineUsers = await prismaClient.user.findMany({
            where: {
                isOnline: true,
                chats: {
                    some: {
                        roomId: roomId
                    }
                }
            },
            select: {
                id: true,
                name: true,
                lastSeen: true
            }
        });
        res.json({
            onlineUsers
        })
    }catch(e){
        res.status(411).json({
            message: "Error getting online users"
        })
    }
})

// Edit message
app.put("/messages/:messageId", middleware, async(req: CustomRequest, res)=>{
    const messageId = Number(req.params.messageId);
    const userId = req.userId;
    const { newMessage } = req.body;
    
    try{
        const message = await prismaClient.chat.findFirst({
            where: { id: messageId }
        });
        
        if(!message || message.userId !== userId){
            return res.status(403).json({
                message: "Unauthorized to edit this message"
            });
        }
        
        const updatedMessage = await prismaClient.chat.update({
            where: { id: messageId },
            data: {
                message: newMessage,
                edited: true
            }
        });
        
        res.json({
            message: updatedMessage
        });
    }catch(e){
        res.status(411).json({
            message: "Error editing message"
        })
    }
})

// Delete message
app.delete("/messages/:messageId", middleware, async(req: CustomRequest, res)=>{
    const messageId = Number(req.params.messageId);
    const userId = req.userId;
    
    try{
        const message = await prismaClient.chat.findFirst({
            where: { id: messageId }
        });
        
        if(!message || message.userId !== userId){
            return res.status(403).json({
                message: "Unauthorized to delete this message"
            });
        }
        
        await prismaClient.chat.delete({
            where: { id: messageId }
        });
        
        res.json({
            message: "Message deleted successfully"
        });
    }catch(e){
        res.status(411).json({
            message: "Error deleting message"
        })
    }
})

// Add reaction to message
app.post("/messages/:messageId/reactions", middleware, async(req: CustomRequest, res)=>{
    const messageId = Number(req.params.messageId);
    const userId = req.userId;
    const { emoji } = req.body;
    
    try{
        const reaction = await prismaClient.reaction.upsert({
            where: {
                messageId_userId_emoji: {
                    messageId,
                    userId,
                    emoji
                }
            },
            update: {
                createdAt: new Date()
            },
            create: {
                messageId,
                userId,
                emoji
            }
        });
        
        res.json({
            reaction
        });
    }catch(e){
        res.status(411).json({
            message: "Error adding reaction"
        })
    }
})

// Remove reaction from message
app.delete("/messages/:messageId/reactions", middleware, async(req: CustomRequest, res)=>{
    const messageId = Number(req.params.messageId);
    const userId = req.userId;
    const { emoji } = req.body;
    
    try{
        await prismaClient.reaction.deleteMany({
            where: {
                messageId,
                userId,
                emoji
            }
        });
        
        res.json({
            message: "Reaction removed successfully"
        });
    }catch(e){
        res.status(411).json({
            message: "Error removing reaction"
        })
    }
})






app.listen(3000);

