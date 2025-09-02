import express from "express";
import {CreateRoomSchema, CreateUserSchema, SigninSchema} from "@repo/zod/types"

import {prismaClient} from "@repo/db/client"
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "@repo/config/config";
import { CustomRequest, middleware } from "./middleware.js";




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

app.get("/chats/:roomId" , middleware , async(req , res) => {
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

app.get("/room/:slug", middleware, async(req, res)=>{
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






app.listen(3000);

