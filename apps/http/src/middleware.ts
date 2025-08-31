import jwt from "jsonwebtoken"
import {config} from "@repo/config/config"
import { NextFunction , Response , Request} from "express"

export interface CustomRequest extends Request{
    userId? : string
}

export const middleware=(req : CustomRequest , res : Response , next : NextFunction) => {
    const token = req.headers.authorization;
    if(!token){
        res.status(401).json({
            message : "Unauthorized"
        })
        return;
    }
    const decoded = jwt.verify(token , config.SECRET_KEY) as CustomRequest;
    if(decoded){
        req.userId = decoded.userId;
        next();
    }
    else{
        res.status(403).json({
            message : "Unauthorized"
        })
    }
}

