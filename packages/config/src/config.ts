import dotenv from "dotenv";
dotenv.config();

type Config ={
    WS_PORT : number,
    HTTP_PORT: number,
    SECRET_KEY : string,
    DATABASE_URL : string,


}

if(!process.env.WS_PORT || !process.env.HTTP_PORT || !process.env.SECRET_KEY || !process.env.DATABASE_URL ){
    throw new Error("Environment variable empty");
}

export const config : Config = {
    WS_PORT : Number(process.env.WS_PORT),
    HTTP_PORT : Number(process.env.HTTP_PORT),
    SECRET_KEY: (process.env.SECRET_KEY),
    DATABASE_URL : (process.env.DATABASE_URL)
}