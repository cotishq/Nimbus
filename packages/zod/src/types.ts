import {z} from "zod";

export const CreateUserSchema = z.object({
    username : z.string().min(2).max(50),
    password : z.string().min(4).max(8),
    name : z.string()
})

export const SigninSchema=z.object({
    username:z.string().min(2).max(50),
    password: z.string().min(4),    
})

export const CreateRoomSchema=z.object({
    name: z.string().min(3).max(25)
})

