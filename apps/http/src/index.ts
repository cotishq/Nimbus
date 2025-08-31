import express from "express";
import {CreateUserSchema} from "@repo/zod/types"

import {prismaClient} from "@repo/db/client"
import bcrypt from "bcrypt";




const app = express();
app.use(express.json());



app.get("/signup" , async(req , res) => {
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
                name : parsedData.data.username
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

app.listen(3000);

